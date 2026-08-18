const test = require("node:test");
const assert = require("node:assert/strict");
const { findWakeOutputViolations } = require("../wake_guardrails");

test("rejects invented day-long absences when the user chatted recently", () => {
  assert.deepEqual(
    findWakeOutputViolations("你今天一天都没来找我。", { diffMinutes: 90, dayPeriod: "下午" }),
    ["unsupported_absence_claim"]
  );
});

test("rejects greetings that contradict the user's local period", () => {
  assert.deepEqual(
    findWakeOutputViolations("晚上好，想你了。", { diffMinutes: 90, dayPeriod: "下午" }),
    ["wrong_local_greeting"]
  );
});

test("allows a grounded neutral message", () => {
  assert.deepEqual(
    findWakeOutputViolations("下午好，记得起来喝口水。", { diffMinutes: 90, dayPeriod: "下午" }),
    []
  );
});
