const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { URL } = require("url");

const ROOT_DIR = __dirname;
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
  const windowsLauncherPath = path.join(ROOT_DIR, "windows-runtime-launcher.js");
  const logFile = path.join(stateDir, "bridge-runtime.log");
  const runtimeProcessFile = path.join(stateDir, "bridge-runtime-process.json");
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

    stopExistingRuntime({
      runtimeProcessFile,
    });
    stopRuntimeOnPort(runtimeConfig.port);

    const logStartOffset = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    const logFd = fs.openSync(logFile, "a", 0o600);
    const launcher = runtimeLauncherCommand(process.platform, {
      scriptPath,
      windowsLauncherPath,
    });
    const child = spawn(
      launcher.command,
      launcher.args.concat(["--hostname", runtimeConfig.hostname, "--port", String(runtimeConfig.port)]),
      {
        cwd: repoDir,
        detached: true,
        stdio: ["ignore", logFd, logFd],
      }
    );

    if (process.platform === "win32" && Number.isFinite(child.pid) && child.pid > 0) {
      fs.writeFileSync(runtimeProcessFile, JSON.stringify({
        pid: child.pid,
        port: runtimeConfig.port,
        startedAt: Date.now(),
      }, null, 2));
    }

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
      || inferPlatformDefaultHostname()
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

function inferPlatformDefaultHostname() {
  if (process.platform !== "win32") {
    return "";
  }
  // On Windows the browser client talks to the bridge through the local web
  // server, so loopback is the safest default unless the user explicitly
  // provides a LAN hostname for phone pairing.
  return "127.0.0.1";
}

function runtimeLauncherCommand(platform, {
  scriptPath,
  windowsLauncherPath,
}) {
  if (platform === "win32") {
    return {
      command: process.execPath,
      args: [windowsLauncherPath],
    };
  }

  return {
    command: scriptPath,
    args: [],
  };
}

function stopExistingRuntime({
  runtimeProcessFile,
}) {
  if (process.platform !== "win32") {
    return;
  }

  const runtimeState = readJsonFileSafe(runtimeProcessFile);
  const pid = Number(runtimeState?.pid || 0);
  if (Number.isFinite(pid) && pid > 0) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
  }

  try {
    fs.unlinkSync(runtimeProcessFile);
  } catch {
    // best effort
  }
}

function stopRuntimeOnPort(port) {
  if (!Number.isFinite(port) || port <= 0) {
    return;
  }

  if (process.platform === "win32") {
    const script = `
$connections = Get-NetTCPConnection -LocalPort ${Math.floor(port)} -State Listen -ErrorAction SilentlyContinue
if ($connections) {
  $connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
}
`;
    spawnSync("powershell", ["-NoProfile", "-Command", script], {
      stdio: "ignore",
    });
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
    const content = fs.readFileSync(filePath);
    const start = Math.max(0, Math.min(Number(offset) || 0, content.length));
    return content.subarray(start).toString("utf8");
  } catch {
    return "";
  }
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
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
