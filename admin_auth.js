const crypto = require("crypto");

const ADMIN_SESSION_COOKIE = "dylan_admin_session";
const DEFAULT_ADMIN_SESSION_DAYS = 180;

function normalizeSessionDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days) || days < 1 || days > 365) return DEFAULT_ADMIN_SESSION_DAYS;
  return Math.floor(days);
}

function sessionSecret(user, password) {
  return crypto
    .createHash("sha256")
    .update(`dylan-admin-session-v1\0${user}\0${password}`)
    .digest();
}

function signExpiry(expiresAt, user, password) {
  return crypto
    .createHmac("sha256", sessionSecret(user, password))
    .update(String(expiresAt))
    .digest("base64url");
}

function createAdminSessionToken({ user, password, days, now = Date.now() }) {
  const expiresAt = Math.floor(now / 1000) + normalizeSessionDays(days) * 24 * 60 * 60;
  return `${expiresAt}.${signExpiry(expiresAt, user, password)}`;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyAdminSessionToken(token, { user, password, now = Date.now() }) {
  const [expiresText, signature, extra] = String(token || "").split(".");
  if (extra !== undefined || !/^\d+$/.test(expiresText || "") || !signature) return false;
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  return safeEqual(signature, signExpiry(expiresAt, user, password));
}

function readCookie(cookieHeader, name) {
  for (const part of String(cookieHeader || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function parseBasicCredentials(authorization) {
  const [scheme, encoded] = String(authorization || "").split(" ");
  if (scheme !== "Basic" || !encoded) return null;
  const decoded = Buffer.from(encoded, "base64").toString();
  const colonIndex = decoded.indexOf(":");
  if (colonIndex < 0) return null;
  return { user: decoded.slice(0, colonIndex), password: decoded.slice(colonIndex + 1) };
}

function authorizeAdmin({ authorization, cookie, user, password, now = Date.now() }) {
  const session = readCookie(cookie, ADMIN_SESSION_COOKIE);
  if (verifyAdminSessionToken(session, { user, password, now })) {
    return { authorized: true, source: "session" };
  }
  const credentials = parseBasicCredentials(authorization);
  if (credentials && safeEqual(credentials.user, user) && safeEqual(credentials.password, password)) {
    return { authorized: true, source: "basic" };
  }
  return { authorized: false, source: session ? "invalid_session" : "missing" };
}

function buildAdminSessionCookie({ user, password, days, secure = true, now = Date.now() }) {
  const maxAge = normalizeSessionDays(days) * 24 * 60 * 60;
  const token = createAdminSessionToken({ user, password, days, now });
  return [
    `${ADMIN_SESSION_COOKIE}=${token}`,
    "Path=/admin",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

module.exports = {
  ADMIN_SESSION_COOKIE,
  authorizeAdmin,
  buildAdminSessionCookie,
  createAdminSessionToken,
  normalizeSessionDays,
  parseBasicCredentials,
  readCookie,
  verifyAdminSessionToken
};
