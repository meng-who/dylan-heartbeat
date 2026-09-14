const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addPulseOutputHeadroom,
  applyHttpResilience,
  createSseDiagnostics,
  httpTimeoutSettings,
  isToolFollowUp,
  requestTraceId
} = require("../http_resilience");

test("reserves output tokens for the hidden Pulse reaction without mutating the request", () => {
  const body = { model: "m", max_tokens: 4096, max_completion_tokens: 8192 };
  const adjusted = addPulseOutputHeadroom(body, true);
  assert.deepEqual(adjusted, { model: "m", max_tokens: 4352, max_completion_tokens: 8448 });
  assert.equal(body.max_tokens, 4096);
  assert.equal(addPulseOutputHeadroom(body, false), body);
  assert.equal(addPulseOutputHeadroom({ model: "m" }, true).model, "m");
});

test("records SSE completion reasons and detects a complete terminator", () => {
  const diagnostics = createSseDiagnostics();
  const encoder = new TextEncoder();
  diagnostics.push(encoder.encode('data: {"choices":[{"delta":{"content":"一段"},"finish_reason":null}]}\n\n'));
  diagnostics.push(encoder.encode('data: {"choices":[{"delta":{"content":"回复"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'));
  const result = diagnostics.finish();
  assert.equal(result.content_chars, 4);
  assert.equal(result.saw_done, true);
  assert.deepEqual(result.finish_reasons, ["length"]);
  assert.ok(result.bytes > 0);
});

test("keeps tool follow-up sockets alive for five minutes by default", () => {
  const server = { keepAliveTimeout: 72_000, headersTimeout: 60_000, keepAliveTimeoutBuffer: 1_000 };
  const settings = applyHttpResilience(server, {});
  assert.deepEqual(settings, { keepAliveTimeout: 300_000, headersTimeout: 305_000 });
  assert.equal(server.keepAliveTimeout, 300_000);
  assert.equal(server.headersTimeout, 305_000);
  assert.equal(server.keepAliveTimeoutBuffer, 5_000);
});

test("header timeout always stays above keep-alive timeout", () => {
  assert.deepEqual(httpTimeoutSettings({
    KEEP_ALIVE_TIMEOUT_MS: "400000",
    HEADERS_TIMEOUT_MS: "120000"
  }), { keepAliveTimeout: 400_000, headersTimeout: 405_000 });
});

test("recognizes a Kelivo tool-result follow-up and Render request id", () => {
  assert.equal(isToolFollowUp({ messages: [{ role: "user" }, { role: "tool" }] }), true);
  assert.equal(isToolFollowUp({ messages: [{ role: "user" }] }), false);
  assert.equal(requestTraceId({ "rndr-id": "render-123", "cf-ray": "ray-456" }, "local"), "render-123");
});
