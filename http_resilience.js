const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_HEADERS_TIMEOUT_MS = DEFAULT_KEEP_ALIVE_TIMEOUT_MS + 5_000;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;

function boundedTimeout(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_TIMEOUT_MS) return fallback;
  return Math.min(Math.floor(parsed), MAX_TIMEOUT_MS);
}

function httpTimeoutSettings(env = process.env) {
  const keepAliveTimeout = boundedTimeout(
    env.KEEP_ALIVE_TIMEOUT_MS,
    DEFAULT_KEEP_ALIVE_TIMEOUT_MS
  );
  const requestedHeadersTimeout = boundedTimeout(
    env.HEADERS_TIMEOUT_MS,
    DEFAULT_HEADERS_TIMEOUT_MS
  );
  return {
    keepAliveTimeout,
    headersTimeout: Math.max(requestedHeadersTimeout, keepAliveTimeout + 5_000)
  };
}

function applyHttpResilience(server, env = process.env) {
  const settings = httpTimeoutSettings(env);
  server.keepAliveTimeout = settings.keepAliveTimeout;
  server.headersTimeout = settings.headersTimeout;
  if ("keepAliveTimeoutBuffer" in server) server.keepAliveTimeoutBuffer = 5_000;
  return settings;
}

function requestTraceId(headers = {}, fallback = "") {
  return String(headers["rndr-id"] || headers["cf-ray"] || fallback || "").trim();
}

function isToolFollowUp(body) {
  return Array.isArray(body?.messages) && body.messages.some(message => message?.role === "tool");
}

module.exports = {
  applyHttpResilience,
  httpTimeoutSettings,
  isToolFollowUp,
  requestTraceId
};
