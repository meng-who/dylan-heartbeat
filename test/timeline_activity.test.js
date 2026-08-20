const test = require("node:test");
const assert = require("node:assert/strict");
const { getLatestUserActivity, stampLatestUserActivity } = require("../timeline_activity");

test("stamps only the latest user message with the gateway activity time", () => {
  const messages = stampLatestUserActivity([
    { role: "user", content: "old" },
    { role: "assistant", content: "reply" },
    { role: "user", content: "new" }
  ], "2026-08-20T05:00:00.000Z");

  assert.equal(messages[0].gateway_activity_at, undefined);
  assert.equal(messages[2].gateway_activity_at, "2026-08-20T05:00:00.000Z");
});

test("prefers the gateway activity stamp over a misleading content date", () => {
  const activity = getLatestUserActivity([{
    role: "user",
    content: "2025-01-01 10:00 我在回忆去年的事",
    gateway_activity_at: "2026-08-20T05:00:00.000Z"
  }], () => new Date("2025-01-01T02:00:00.000Z"));

  assert.equal(activity.time.toISOString(), "2026-08-20T05:00:00.000Z");
  assert.equal(activity.source, "gateway_activity_at");
});

test("keeps legacy timestamp fallbacks for an existing timeline", () => {
  const activity = getLatestUserActivity([
    { role: "user", content: "legacy", received_at: "2026-08-19T05:00:00.000Z" }
  ], () => null);

  assert.equal(activity.time.toISOString(), "2026-08-19T05:00:00.000Z");
  assert.equal(activity.source, "received_at");
});
