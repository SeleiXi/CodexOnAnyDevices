const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { URL } = require("url");

const STARTUP_TIMEOUT_MS = 30_000;
const HEALTHCHECK_INTERVAL_MS = 500;
const MIN_PAIRING_TTL_MS = 30_000;

function createBridgeRuntimeManager({
  repoDir,
  pairingFile,
  stateDir,
  defaultHostname = "",
  defaultPort = 9100,
  healthHost = "127.0.0.1",
} = {}) {
  if (!repoDir || !pairingFile || !stateDir) {
    throw new Error("createBridgeRuntimeManager requires repoDir, pairingFile, and stateDir");
  }

  const scriptPath = path.join(repoDir, "run-local-remodex.sh");
  const logFile = path.join(stateDir, "bridge-runtime.log");
  let startPromise = null;

  async function ensureFreshPairing({
    forceRefresh = false,
    allowStale = false,
  } = {}) {
    const existing = readPairingFile(pairingFile);
    if (!forceRefresh && existing && (!pairingNeedsRefresh(existing) || allowStale)) {
      return existing;
    }

    if (startPromise) {
      return startPromise;
    }

    startPromise = startFreshRuntime().finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  async function startFreshRuntime() {
    const runtimeConfig = resolveRuntimeConfig({
      pairingFile,
      defaultHostname,
      defaultPort,
    });

    stopRuntimeOnPort(runtimeConfig.port);

    const logStartOffset = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    const logFd = fs.openSync(logFile, "a", 0o600);
    const child = spawn(
      scriptPath,
      ["--hostname", runtimeConfig.hostname, "--port", String(runtimeConfig.port)],
      {
        cwd: repoDir,
        detached: true,
        stdio: ["ignore", logFd, logFd],
      }
    );

    child.unref();

    return new Promise((resolve, reject) => {
      const parsed = {
        sessionId: "",
        macDeviceId: "",
        expiresAt: 0,
      };
      let settled = false;
      let stdoutBuffer = "";
      let stderrBuffer = "";

      const finish = (error, pairingPayload = null) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        resolve(pairingPayload);
      };

      const cleanup = () => {
        clearInterval(healthTimer);
        clearTimeout(startTimeout);
        child.off("exit", onExit);
        try {
          fs.closeSync(logFd);
        } catch {
          // best effort
        }
      };

      const onExit = (code, signal) => {
        finish(new Error(`Bridge runtime exited before pairing was ready (${code || 0}/${signal || "no-signal"})`));
      };

      const tryResolve = async () => {
        const latestOutput = readLogSinceOffset(logFile, logStartOffset);
        if (latestOutput) {
          stdoutBuffer = latestOutput;
          parseOutput(parsed, latestOutput);
        }
        const payload = buildPairingPayload({
          parsed,
          hostname: runtimeConfig.hostname,
          port: runtimeConfig.port,
        });
        if (!payload) {
          return;
        }

        const healthy = await checkRelayHealth(runtimeConfig.port, healthHost);
        if (!healthy) {
          return;
        }

        fs.writeFileSync(pairingFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
        finish(null, payload);
      };

      const healthTimer = setInterval(() => {
        void tryResolve();
      }, HEALTHCHECK_INTERVAL_MS);
      healthTimer.unref?.();

      const startTimeout = setTimeout(() => {
        const detail = [stdoutBuffer.trim(), stderrBuffer.trim()].filter(Boolean).join("\n");
        finish(new Error(detail || "Timed out while waiting for bridge pairing output."));
      }, STARTUP_TIMEOUT_MS);
      startTimeout.unref?.();

      child.on("exit", onExit);

      void tryResolve();
    });
  }

  return {
    ensureFreshPairing,
  };
}

function resolveRuntimeConfig({
  pairingFile,
  defaultHostname,
  defaultPort,
}) {
  const existing = readPairingFile(pairingFile);
  const relayUrl = parseUrl(existing?.relay || "");
  const hostname = String(
    process.env.REMODEX_WEB_BRIDGE_HOSTNAME
      || relayUrl?.hostname
      || defaultHostname
      || ""
  ).trim();
  const port = Number.parseInt(
    process.env.REMODEX_WEB_BRIDGE_PORT
      || relayUrl?.port
      || String(defaultPort),
    10
  );

  if (!hostname) {
    throw new Error("Bridge hostname is not configured.");
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Bridge port is invalid.");
  }

  return {
    hostname,
    port,
  };
}

function parseOutput(parsed, buffer) {
  const sessionId = buffer.match(/Session ID:\s*([^\s]+)/);
  if (sessionId) {
    parsed.sessionId = sessionId[1].trim();
  }

  const macDeviceId = buffer.match(/Device ID:\s*([^\s]+)/);
  if (macDeviceId) {
    parsed.macDeviceId = macDeviceId[1].trim();
  }

  const expires = buffer.match(/Expires:\s*([^\n\r]+)/);
  if (expires) {
    const expiresAt = Date.parse(expires[1].trim());
    if (Number.isFinite(expiresAt)) {
      parsed.expiresAt = expiresAt;
    }
  }
}

function buildPairingPayload({
  parsed,
  hostname,
  port,
}) {
  if (!parsed.sessionId || !parsed.expiresAt) {
    return null;
  }

  const deviceState = readBridgeDeviceState();
  const macDeviceId = parsed.macDeviceId || deviceState?.macDeviceId || "";
  const macIdentityPublicKey = deviceState?.macIdentityPublicKey || "";
  if (!macDeviceId || !macIdentityPublicKey) {
    return null;
  }

  return {
    v: 2,
    relay: `ws://${hostname}:${port}/relay`,
    sessionId: parsed.sessionId,
    macDeviceId,
    macIdentityPublicKey,
    expiresAt: parsed.expiresAt,
  };
}

function readBridgeDeviceState() {
  const stateDir = process.env.REMODEX_DEVICE_STATE_DIR || path.join(os.homedir(), ".remodex");
  const stateFile = process.env.REMODEX_DEVICE_STATE_FILE || path.join(stateDir, "device-state.json");
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function readPairingFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function pairingNeedsRefresh(pairingPayload, now = Date.now()) {
  return !pairingPayload
    || !Number.isFinite(Number(pairingPayload.expiresAt))
    || Number(pairingPayload.expiresAt) <= (now + MIN_PAIRING_TTL_MS);
}

function stopRuntimeOnPort(port) {
  if (!Number.isFinite(port) || port <= 0) {
    return;
  }
  spawnSync("bash", ["-lc", `fuser -k ${Math.floor(port)}/tcp >/dev/null 2>&1 || true`], {
    stdio: "ignore",
  });
}

function checkRelayHealth(port, host) {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: host,
      port,
      path: "/health",
      timeout: 1000,
    }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

function readLogSinceOffset(filePath, offset) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return content.slice(offset);
  } catch {
    return "";
  }
}

function parseUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

module.exports = {
  createBridgeRuntimeManager,
};
