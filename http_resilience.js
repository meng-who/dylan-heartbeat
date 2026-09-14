const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_HEADERS_TIMEOUT_MS = DEFAULT_KEEP_ALIVE_TIMEOUT_MS + 5_000;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;
const PULSE_OUTPUT_HEADROOM_TOKENS = 256;

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

function addPulseOutputHeadroom(body, enabled = true) {
  if (!enabled || !body || typeof body !== "object") return body;
  const adjusted = { ...body };
  let changed = false;
  for (const key of ["max_tokens", "max_completion_tokens"]) {
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < 1 || value > 16_384) continue;
    adjusted[key] = Math.floor(value) + PULSE_OUTPUT_HEADROOM_TOKENS;
    changed = true;
  }
  return changed ? adjusted : body;
}

function createSseDiagnostics() {
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let contentChars = 0;
  let sawDone = false;
  const finishReasons = new Set();

  const processLine = line => {
    const match = String(line || "").match(/^data:\s*(.*)$/i);
    if (!match) return;
    const raw = match[1].trim();
    if (raw === "[DONE]") {
      sawDone = true;
      return;
    }
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      for (const choice of payload?.choices || []) {
        if (choice?.finish_reason) finishReasons.add(String(choice.finish_reason));
        if (typeof choice?.delta?.content === "string") contentChars += choice.delta.content.length;
      }
    } catch {}
  };

  return {
    push(chunk) {
      if (!chunk) return;
      bytes += chunk.byteLength || chunk.length || 0;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(processLine);
    },
    finish() {
      buffer += decoder.decode();
      if (buffer) processLine(buffer);
      buffer = "";
      return {
        bytes,
        content_chars: contentChars,
        saw_done: sawDone,
        finish_reasons: [...finishReasons]
      };
    }
  };
}

module.exports = {
  addPulseOutputHeadroom,
  applyHttpResilience,
  createSseDiagnostics,
  httpTimeoutSettings,
  isToolFollowUp,
  requestTraceId
};
