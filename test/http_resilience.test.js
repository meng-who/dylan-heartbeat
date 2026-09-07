const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyHttpResilience,
  httpTimeoutSettings,
  isToolFollowUp,
  requestTraceId
} = require("../http_resilience");

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
