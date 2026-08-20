const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createUserActivityRecord,
  getLatestUserActivity,
  parseUserActivityRecord,
  stampLatestUserActivity
} = require("../timeline_activity");

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

test("creates and parses a standalone activity record", () => {
  const record = createUserActivityRecord(
    [{ role: "assistant" }, { role: "user" }],
    "2026-08-21T03:20:00.000Z"
  );
  assert.deepEqual(record, {
    last_user_at: "2026-08-21T03:20:00.000Z",
    source: "gateway_request"
  });

  const activity = parseUserActivityRecord(record);
  assert.equal(activity.time.toISOString(), "2026-08-21T03:20:00.000Z");
  assert.equal(activity.source, "gateway_request");
});

test("does not create an activity record without a real user message", () => {
  assert.equal(createUserActivityRecord([{ role: "assistant" }], new Date().toISOString()), null);
});
