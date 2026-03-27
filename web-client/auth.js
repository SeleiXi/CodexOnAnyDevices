const fs = require("fs");
const path = require("path");
const {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} = require("crypto");

const COOKIE_NAME = "remodex_admin_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_BAN_MS = 15 * 60 * 1000;
const DAY_BAN_MS = 24 * 60 * 60 * 1000;
const WEEK_BAN_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_BAN_MS = 30 * 24 * 60 * 60 * 1000;

function createAuthManager({
  stateFile,
  forceSecureCookies = false,
} = {}) {
  if (!stateFile) {
    throw new Error("createAuthManager requires a state file path");
  }

  ensureParentDirectory(stateFile);
  let state = loadState(stateFile);

  function save() {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  }

  function cleanup(now = Date.now()) {
    for (const [tokenHash, session] of Object.entries(state.sessions)) {
      if (!session || !Number.isFinite(session.expiresAt) || session.expiresAt <= now) {
        delete state.sessions[tokenHash];
      }
    }

    for (const [ip, attemptState] of Object.entries(state.attempts)) {
      if (!attemptState) {
        delete state.attempts[ip];
        continue;
      }

      if (
        Number.isFinite(attemptState.windowStartedAt)
        && now - attemptState.windowStartedAt > ATTEMPT_WINDOW_MS
      ) {
        attemptState.rollingFailures = 0;
        attemptState.windowStartedAt = now;
      }

      const hasBan = Number.isFinite(attemptState.banUntil) && attemptState.banUntil > now;
      const hasRecentFailures = Number.isFinite(attemptState.lastFailureAt)
        && (now - attemptState.lastFailureAt) <= ATTEMPT_WINDOW_MS;
      const hasRollingFailures = Number(attemptState.rollingFailures || 0) > 0;
      if (!hasBan && !hasRecentFailures && !hasRollingFailures) {
        delete state.attempts[ip];
      }
    }
  }

  function hasPasswordConfigured() {
    return Boolean(
      state.password
      && typeof state.password.salt === "string"
      && typeof state.password.derivedKey === "string"
      && state.password.salt
      && state.password.derivedKey
    );
  }

  function setPassword(password) {
    assertStrongPassword(password);
    state.password = buildPasswordRecord(password);
    cleanup();
    save();
  }

  function getAuthSession(req) {
    cleanup();

    const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
    if (!token) {
      return null;
    }

    const tokenHash = hashToken(token);
    const session = state.sessions[tokenHash];
    if (!session) {
      return null;
    }

    const now = Date.now();
    if (!Number.isFinite(session.expiresAt) || session.expiresAt <= now) {
      delete state.sessions[tokenHash];
      save();
      return null;
    }

    session.lastSeenAt = now;
    save();
    return {
      tokenHash,
      ...session,
    };
  }

  function getAuthSessionSummary(req) {
    cleanup();
    const session = getAuthSession(req);

    return {
      authenticated: Boolean(session),
      hasPasswordConfigured: hasPasswordConfigured(),
      session: session
        ? {
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            ip: session.ip,
          }
        : null,
    };
  }

  function getCurrentBan(ip) {
    cleanup();
    const now = Date.now();
    const attemptState = getOrCreateAttemptState(state.attempts, ip, now);
    const activeBan = describeBan(attemptState, now);
    if (!activeBan && Number(attemptState.rollingFailures || 0) === 0) {
      delete state.attempts[String(ip || "unknown")];
    }
    return activeBan;
  }

  function login({ password, ip, userAgent = "" }) {
    cleanup();

    if (!hasPasswordConfigured()) {
      const error = new Error("Admin password is not configured");
      error.status = 503;
      error.code = "password_not_configured";
      throw error;
    }

    const now = Date.now();
    const attemptState = getOrCreateAttemptState(state.attempts, ip, now);
    const activeBan = describeBan(attemptState, now);
    if (activeBan) {
      registerBlockedAttemptDuringBan(attemptState, now);
      save();
      const escalatedBan = describeBan(attemptState, now) || activeBan;
      const error = new Error(activeBan.message);
      error.status = 429;
      error.code = "ip_banned";
      error.ban = escalatedBan;
      throw error;
    }

    if (!verifyPassword(password, state.password)) {
      registerFailedAttempt(attemptState, now);
      save();

      const nextBan = describeBan(attemptState, now);
      const error = new Error(nextBan ? nextBan.message : "Invalid password");
      error.status = nextBan ? 429 : 401;
      error.code = nextBan ? "ip_banned" : "invalid_password";
      error.ban = nextBan;
      error.remainingBeforeShortBan = Math.max(0, 5 - Number(attemptState.consecutiveFailures || 0));
      throw error;
    }

    attemptState.consecutiveFailures = 0;
    attemptState.lastSuccessAt = now;
    attemptState.banUntil = 0;

    const token = randomBytes(48).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = now + SESSION_TTL_MS;

    state.sessions[tokenHash] = {
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
      ip: String(ip || "unknown"),
      userAgent: String(userAgent || "").slice(0, 512),
    };
    save();

    return {
      token,
      expiresAt,
    };
  }

  function logout(req) {
    cleanup();

    const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
    if (!token) {
      return;
    }

    const tokenHash = hashToken(token);
    if (state.sessions[tokenHash]) {
      delete state.sessions[tokenHash];
      save();
    }
  }

  function buildSessionCookie(token, {
    expiresAt,
    secure = forceSecureCookies,
  } = {}) {
    const maxAgeSeconds = Math.max(
      0,
      Math.floor(((Number.isFinite(expiresAt) ? expiresAt : Date.now() + SESSION_TTL_MS) - Date.now()) / 1000)
    );

    return serializeCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: maxAgeSeconds,
      secure,
    });
  }

  function buildClearSessionCookie({
    secure = forceSecureCookies,
  } = {}) {
    return serializeCookie(COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 0,
      secure,
    });
  }

  return {
    COOKIE_NAME,
    buildClearSessionCookie,
    buildSessionCookie,
    getAuthSession,
    getAuthSessionSummary,
    getCurrentBan,
    hasPasswordConfigured,
    login,
    logout,
    setPassword,
  };
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadState(stateFile) {
  const fallback = {
    version: 1,
    password: null,
    sessions: {},
    attempts: {},
  };

  if (!fs.existsSync(stateFile)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      version: 1,
      password: parsed.password || null,
      sessions: parsed.sessions || {},
      attempts: parsed.attempts || {},
    };
  } catch {
    return fallback;
  }
}

function buildPasswordRecord(password) {
  const normalizedPassword = normalizePassword(password);
  const salt = randomBytes(16);
  const derivedKey = scryptSync(normalizedPassword, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });

  return {
    algorithm: "scrypt",
    salt: salt.toString("base64"),
    derivedKey: derivedKey.toString("base64"),
    keyLength: 64,
    N: 32768,
    r: 8,
    p: 1,
    updatedAt: Date.now(),
  };
}

function verifyPassword(password, passwordRecord) {
  try {
    const salt = Buffer.from(passwordRecord.salt, "base64");
    const expectedKey = Buffer.from(passwordRecord.derivedKey, "base64");
    const actualKey = scryptSync(normalizePassword(password), salt, expectedKey.length, {
      N: passwordRecord.N || 32768,
      r: passwordRecord.r || 8,
      p: passwordRecord.p || 1,
      maxmem: 256 * 1024 * 1024,
    });
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

function assertStrongPassword(password) {
  const normalizedPassword = normalizePassword(password);
  const failures = [];

  if (normalizedPassword.length < 24) {
    failures.push("at least 24 characters");
  }
  if (!/[a-z]/.test(normalizedPassword)) {
    failures.push("one lowercase letter");
  }
  if (!/[A-Z]/.test(normalizedPassword)) {
    failures.push("one uppercase letter");
  }
  if (!/[0-9]/.test(normalizedPassword)) {
    failures.push("one number");
  }
  if (!/[^A-Za-z0-9]/.test(normalizedPassword)) {
    failures.push("one symbol");
  }
  if (/\s/.test(normalizedPassword)) {
    failures.push("no whitespace");
  }

  if (failures.length > 0) {
    throw new Error(`Password is not strong enough: ${failures.join(", ")}`);
  }
}

function createHighEntropyPassword(length = 32) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+[]{}:,.?";
  let password = "";

  while (password.length < length) {
    const randomIndex = randomBytes(1)[0] % alphabet.length;
    password += alphabet[randomIndex];
  }

  assertStrongPassword(password);
  return password;
}

function getOrCreateAttemptState(attempts, ip, now) {
  const key = String(ip || "unknown");
  if (!attempts[key]) {
    attempts[key] = {
      consecutiveFailures: 0,
      rollingFailures: 0,
      totalFailures: 0,
      lastFailureAt: 0,
      lastSuccessAt: 0,
      windowStartedAt: now,
      banUntil: 0,
    };
  }
  return attempts[key];
}

function registerFailedAttempt(attemptState, now) {
  if (!Number.isFinite(attemptState.windowStartedAt) || (now - attemptState.windowStartedAt) > ATTEMPT_WINDOW_MS) {
    attemptState.windowStartedAt = now;
    attemptState.rollingFailures = 0;
  }

  attemptState.consecutiveFailures = Number(attemptState.consecutiveFailures || 0) + 1;
  attemptState.rollingFailures = Number(attemptState.rollingFailures || 0) + 1;
  attemptState.totalFailures = Number(attemptState.totalFailures || 0) + 1;
  attemptState.lastFailureAt = now;
  attemptState.banUntil = resolveBanUntil(attemptState, now);
}

function registerBlockedAttemptDuringBan(attemptState, now) {
  if (!Number.isFinite(attemptState.windowStartedAt) || (now - attemptState.windowStartedAt) > ATTEMPT_WINDOW_MS) {
    attemptState.windowStartedAt = now;
    attemptState.rollingFailures = 0;
  }

  attemptState.rollingFailures = Number(attemptState.rollingFailures || 0) + 1;
  attemptState.totalFailures = Number(attemptState.totalFailures || 0) + 1;
  attemptState.lastFailureAt = now;
  attemptState.banUntil = Math.max(
    Number(attemptState.banUntil || 0),
    resolveBanUntil(attemptState, now)
  );
}

function resolveBanUntil(attemptState, now) {
  const rollingFailures = Number(attemptState.rollingFailures || 0);
  const consecutiveFailures = Number(attemptState.consecutiveFailures || 0);

  if (rollingFailures >= 20) {
    return now + MONTH_BAN_MS;
  }
  if (rollingFailures >= 15) {
    return now + WEEK_BAN_MS;
  }
  if (rollingFailures >= 10) {
    return now + DAY_BAN_MS;
  }
  if (consecutiveFailures >= 5) {
    return now + SHORT_BAN_MS;
  }
  return 0;
}

function describeBan(attemptState, now) {
  const banUntil = Number(attemptState?.banUntil || 0);
  if (!Number.isFinite(banUntil) || banUntil <= now) {
    return null;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((banUntil - now) / 1000));
  const rollingFailures = Number(attemptState.rollingFailures || 0);
  let level = "short";
  if (rollingFailures >= 20) {
    level = "month";
  } else if (rollingFailures >= 15) {
    level = "week";
  } else if (rollingFailures >= 10) {
    level = "day";
  }

  const messageByLevel = {
    short: "Too many failed login attempts. This IP is blocked for 15 minutes.",
    day: "Too many failed login attempts. This IP is blocked for 24 hours.",
    week: "Too many failed login attempts. This IP is blocked for 7 days.",
    month: "Too many failed login attempts. This IP is blocked for 30 days.",
  };

  return {
    level,
    retryAfterSeconds,
    banUntil,
    message: messageByLevel[level],
  };
}

function parseCookies(cookieHeader) {
  const result = {};
  const rawHeader = String(cookieHeader || "");
  if (!rawHeader) {
    return result;
  }

  for (const pair of rawHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    result[key] = decodeURIComponent(value);
  }

  return result;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (Number.isFinite(options.maxAge)) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function hashToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function normalizePassword(password) {
  return String(password || "").normalize("NFKC");
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  assertStrongPassword,
  createAuthManager,
  createHighEntropyPassword,
};
