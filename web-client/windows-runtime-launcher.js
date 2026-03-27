const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { createRequire } = require("module");

const ROOT_DIR = path.dirname(__filename);
const REPO_DIR = path.dirname(ROOT_DIR);
const BRIDGE_DIR = path.join(REPO_DIR, "phodex-bridge");
const RELAY_DIR = path.join(REPO_DIR, "relay");

void main();

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensurePackageDependencies(BRIDGE_DIR);
  ensurePackageDependencies(RELAY_DIR);

  const { createRelayServer } = require(path.join(RELAY_DIR, "server.js"));
  const { server } = createRelayServer();

  let bridgeChild = null;
  let shuttingDown = false;

  function shutdown(code = 0) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    if (bridgeChild && !bridgeChild.killed) {
      bridgeChild.kill("SIGTERM");
      setTimeout(() => {
        if (bridgeChild && !bridgeChild.killed) {
          bridgeChild.kill("SIGKILL");
        }
      }, 4_000).unref?.();
    }

    server.close(() => {
      process.exit(code);
    });

    setTimeout(() => {
      process.exit(code || 1);
    }, 5_000).unref?.();
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  await listen(server, config.port, config.bindHost);
  console.log(`[run-local-remodex:windows] relay listening on http://${config.bindHost}:${config.port}`);

  bridgeChild = spawn(process.execPath, ["./bin/remodex.js", "up"], {
    cwd: BRIDGE_DIR,
    env: {
      ...process.env,
      REMODEX_RELAY: `ws://${config.hostname}:${config.port}/relay`,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  bridgeChild.once("exit", (code, signal) => {
    console.error(
      `[run-local-remodex:windows] bridge exited (${Number(code || 0)}/${signal || "no-signal"})`
    );
    shutdown(Number(code || 0));
  });
}

function parseArgs(args) {
  let hostname = "";
  let bindHost = "0.0.0.0";
  let port = 9000;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--hostname") {
      hostname = String(args[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (value === "--bind-host") {
      bindHost = String(args[index + 1] || "").trim() || bindHost;
      index += 1;
      continue;
    }
    if (value === "--port") {
      port = Number.parseInt(args[index + 1] || "9000", 10);
      index += 1;
    }
  }

  if (!hostname) {
    hostname = "127.0.0.1";
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Invalid relay port for Windows runtime launcher.");
  }

  return {
    hostname,
    bindHost,
    port,
  };
}

function ensurePackageDependencies(packageDir) {
  if (packageDependenciesInstalled(packageDir)) {
    return;
  }

  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd install"], {
      cwd: packageDir,
      stdio: "inherit",
    })
    : spawnSync("npm", ["install"], {
      cwd: packageDir,
      stdio: "inherit",
    });
  if (result.status !== 0) {
    throw new Error(`Failed to install dependencies in ${packageDir}`);
  }
}

function packageDependenciesInstalled(packageDir) {
  try {
    const packageJsonPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      return false;
    }

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const dependencyNames = Object.keys(pkg.dependencies || {});
    const requireFromPackage = createRequire(packageJsonPath);
    for (const dependencyName of dependencyNames) {
      requireFromPackage.resolve(`${dependencyName}/package.json`);
    }
    return true;
  } catch {
    return false;
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}
