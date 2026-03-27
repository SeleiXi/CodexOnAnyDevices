const fs = require("fs");
const path = require("path");
const {
  assertStrongPassword,
  createAuthManager,
  createHighEntropyPassword,
} = require("./auth");

const ROOT_DIR = __dirname;
const STATE_DIR = path.join(ROOT_DIR, "state");
const AUTH_STATE_FILE = path.join(STATE_DIR, "auth-state.json");
const DEFAULT_PASSWORD_FILE = path.join(STATE_DIR, "admin-password.txt");

function main() {
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const writePlaintext = args.includes("--write-plaintext");
  const passwordFlagIndex = args.indexOf("--password");
  const generate = args.includes("--generate");

  let password = process.env.REMODEX_WEB_ADMIN_PASSWORD || "";
  if (passwordFlagIndex !== -1) {
    password = args[passwordFlagIndex + 1] || "";
  } else if (!password && generate) {
    password = createHighEntropyPassword(32);
  }

  if (!password) {
    console.error("Usage: node set-password.js --generate [--write-plaintext]");
    console.error("   or: node set-password.js --password '<strong password>'");
    process.exit(1);
  }

  assertStrongPassword(password);

  const auth = createAuthManager({
    stateFile: AUTH_STATE_FILE,
  });
  auth.setPassword(password);

  if (writePlaintext) {
    fs.writeFileSync(DEFAULT_PASSWORD_FILE, `${password}\n`, { mode: 0o600 });
    try {
      fs.chmodSync(DEFAULT_PASSWORD_FILE, 0o600);
    } catch {
      // best effort
    }
    console.log(DEFAULT_PASSWORD_FILE);
  } else {
    console.log("Password updated.");
  }
}

main();
