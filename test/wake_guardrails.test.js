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

test("rejects an incorrect explicit weekday claim", () => {
  assert.deepEqual(
    findWakeOutputViolations("今天是周二，记得吃午饭。", {
      diffMinutes: 90,
      dayPeriod: "中午",
      weekday: "星期三"
    }),
    ["wrong_local_weekday"]
  );
});

test("allows the weekday calculated for the user's timezone", () => {
  assert.deepEqual(
    findWakeOutputViolations("今天是星期三，记得吃午饭。", {
      diffMinutes: 90,
      dayPeriod: "中午",
      weekday: "星期三"
    }),
    []
  );
});
