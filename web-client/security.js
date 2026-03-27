const fs = require("fs");
const path = require("path");

const DEFAULT_LOCAL_ALLOWLIST = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const DEFAULT_CLOUDFLARE_PROXY_CIDRS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

function createSecurityManager({
  stateFile,
  initialState = {},
} = {}) {
  if (!stateFile) {
    throw new Error("createSecurityManager requires a state file path");
  }

  ensureParentDirectory(stateFile);
  let state = loadState(stateFile, initialState);

  function save() {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  }

  function getSummary(req) {
    const connection = inspectRequestConnection(req, state);
    return {
      mode: connection.proxyHeaderTrusted ? "cloudflare_proxy" : "direct",
      allowlistEnabled: Boolean(state.allowlistEnabled),
      trustProxyHeaders: Boolean(state.trustProxyHeaders),
      allowedCidrs: [...state.allowedCidrs],
      trustedProxyCidrs: [...state.trustedProxyCidrs],
      currentRequestIp: connection.clientIp,
      remoteAddress: connection.remoteAddress,
      proxyHeaderTrusted: connection.proxyHeaderTrusted,
      matchedAllowlistEntry: connection.matchedAllowlistEntry,
      blocked: !connection.allowed,
    };
  }

  function update(config = {}) {
    const nextAllowedCidrs = normalizeEntryList(config.allowedCidrs, state.allowedCidrs);
    const nextTrustedProxyCidrs = normalizeEntryList(config.trustedProxyCidrs, state.trustedProxyCidrs);

    state = {
      version: 1,
      allowlistEnabled: Boolean(config.allowlistEnabled),
      trustProxyHeaders: Boolean(config.trustProxyHeaders),
      allowedCidrs: nextAllowedCidrs.length > 0 ? nextAllowedCidrs : [...DEFAULT_LOCAL_ALLOWLIST],
      trustedProxyCidrs: nextTrustedProxyCidrs.length > 0
        ? nextTrustedProxyCidrs
        : [...DEFAULT_CLOUDFLARE_PROXY_CIDRS],
      updatedAt: Date.now(),
    };
    save();
    return state;
  }

  function assertRequestAllowed(req) {
    const connection = inspectRequestConnection(req, state);
    if (!state.allowlistEnabled) {
      return connection;
    }
    if (connection.allowed) {
      return connection;
    }

    const error = new Error(`IP ${connection.clientIp} is not in the allowlist`);
    error.status = 403;
    error.code = "ip_not_allowed";
    error.connection = connection;
    throw error;
  }

  return {
    assertRequestAllowed,
    getSummary,
    update,
  };
}

function inspectRequestConnection(req, state) {
  const remoteAddress = normalizeIp(req?.socket?.remoteAddress || "unknown");
  const canTrustProxy = Boolean(
    state.trustProxyHeaders
    && remoteAddress
    && matchesAnyEntry(remoteAddress, state.trustedProxyCidrs)
  );
  const headerClientIp = canTrustProxy ? extractForwardedClientIp(req) : "";
  const clientIp = normalizeIp(headerClientIp || remoteAddress || "unknown");
  const matchedAllowlistEntry = findMatchingEntry(clientIp, state.allowedCidrs);

  return {
    clientIp,
    remoteAddress,
    proxyHeaderTrusted: Boolean(headerClientIp),
    allowed: !state.allowlistEnabled || Boolean(matchedAllowlistEntry),
    matchedAllowlistEntry: matchedAllowlistEntry || "",
  };
}

function extractForwardedClientIp(req) {
  const cfConnectingIp = normalizeIp(req?.headers?.["cf-connecting-ip"] || "");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "");
  if (!forwardedFor) {
    return "";
  }
  const firstHop = forwardedFor.split(",")[0]?.trim() || "";
  return normalizeIp(firstHop);
}

function loadState(stateFile, initialState) {
  const fallback = {
    version: 1,
    allowlistEnabled: Boolean(initialState.allowlistEnabled),
    trustProxyHeaders: Boolean(initialState.trustProxyHeaders),
    allowedCidrs: normalizeEntryList(initialState.allowedCidrs, DEFAULT_LOCAL_ALLOWLIST),
    trustedProxyCidrs: normalizeEntryList(
      initialState.trustedProxyCidrs,
      DEFAULT_CLOUDFLARE_PROXY_CIDRS
    ),
    updatedAt: Date.now(),
  };

  if (!fs.existsSync(stateFile)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      version: 1,
      allowlistEnabled: Boolean(parsed.allowlistEnabled),
      trustProxyHeaders: Boolean(parsed.trustProxyHeaders),
      allowedCidrs: normalizeEntryList(parsed.allowedCidrs, fallback.allowedCidrs),
      trustedProxyCidrs: normalizeEntryList(parsed.trustedProxyCidrs, fallback.trustedProxyCidrs),
      updatedAt: Number(parsed.updatedAt || Date.now()),
    };
  } catch {
    return fallback;
  }
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeEntryList(value, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const nextEntries = value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map(normalizeEntry)
    .filter(Boolean);
  if (nextEntries.length === 0) {
    return [...fallback];
  }
  return [...new Set(nextEntries)];
}

function normalizeEntry(entry) {
  if (!entry.includes("/")) {
    const normalizedIp = normalizeIp(entry);
    return normalizedIp || "";
  }

  const [rawIp, rawPrefix] = entry.split("/", 2);
  const normalizedIp = normalizeIp(rawIp);
  const version = detectIpVersion(normalizedIp);
  const maxPrefix = version === 6 ? 128 : 32;
  const prefix = Number.parseInt(String(rawPrefix || ""), 10);
  if (!normalizedIp || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    return "";
  }
  return `${normalizedIp}/${prefix}`;
}

function normalizeIp(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) {
    return "";
  }
  if (value === "::1" || value === "localhost") {
    return "::1";
  }
  if (value.startsWith("::ffff:")) {
    const ipv4Candidate = value.slice(7);
    return isIPv4(ipv4Candidate) ? ipv4Candidate : value;
  }
  if (isIPv4(value) || isIPv6(value)) {
    return value;
  }
  return "";
}

function detectIpVersion(value) {
  if (isIPv4(value)) {
    return 4;
  }
  if (isIPv6(value)) {
    return 6;
  }
  return 0;
}

function isIPv4(value) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return false;
  }
  return value.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function isIPv6(value) {
  if (!/^[0-9a-f:]+$/.test(value) || !value.includes(":")) {
    return false;
  }
  const halves = value.split("::");
  if (halves.length > 2) {
    return false;
  }
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const totalGroups = left.length + right.length;
  if (halves.length === 1) {
    return totalGroups === 8 && [...left, ...right].every(isIPv6Group);
  }
  return totalGroups < 8 && [...left, ...right].every(isIPv6Group);
}

function isIPv6Group(part) {
  return /^[0-9a-f]{1,4}$/.test(part);
}

function matchesAnyEntry(ip, entries) {
  return Boolean(findMatchingEntry(ip, entries));
}

function findMatchingEntry(ip, entries) {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) {
    return "";
  }
  for (const entry of entries) {
    if (matchesEntry(normalizedIp, entry)) {
      return entry;
    }
  }
  return "";
}

function matchesEntry(ip, entry) {
  if (!entry) {
    return false;
  }
  if (!entry.includes("/")) {
    return normalizeIp(entry) === normalizeIp(ip);
  }

  const [baseIp, rawPrefix] = entry.split("/", 2);
  const ipVersion = detectIpVersion(ip);
  const baseVersion = detectIpVersion(baseIp);
  if (!ipVersion || ipVersion !== baseVersion) {
    return false;
  }

  const prefix = Number.parseInt(rawPrefix, 10);
  if (ipVersion === 4) {
    return ipv4ToBigInt(ip) >> BigInt(32 - prefix) === ipv4ToBigInt(baseIp) >> BigInt(32 - prefix);
  }
  return ipv6ToBigInt(ip) >> BigInt(128 - prefix) === ipv6ToBigInt(baseIp) >> BigInt(128 - prefix);
}

function ipv4ToBigInt(ip) {
  return ip
    .split(".")
    .map((part) => BigInt(Number(part)))
    .reduce((accumulator, part) => (accumulator << 8n) + part, 0n);
}

function ipv6ToBigInt(ip) {
  const [leftPart, rightPart = ""] = ip.split("::");
  const left = leftPart ? leftPart.split(":").filter(Boolean) : [];
  const right = rightPart ? rightPart.split(":").filter(Boolean) : [];
  const missingGroups = 8 - (left.length + right.length);
  const groups = [
    ...left,
    ...new Array(Math.max(0, missingGroups)).fill("0"),
    ...right,
  ];

  return groups.reduce((accumulator, group) => {
    return (accumulator << 16n) + BigInt(Number.parseInt(group || "0", 16));
  }, 0n);
}

module.exports = {
  DEFAULT_CLOUDFLARE_PROXY_CIDRS,
  DEFAULT_LOCAL_ALLOWLIST,
  createSecurityManager,
};
