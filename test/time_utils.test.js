const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatDateTimeInTimeZone,
  getChineseDayPeriod,
  getHourInTimeZone,
  parseLeadingZonedTimestamp,
  resolveTimeZone,
  zonedWallTimeToDate
} = require("../time_utils");

test("parses a Beijing wall time independently of the server timezone", () => {
  const parsed = zonedWallTimeToDate(
    { year: "2026", month: "07", day: "30", hour: "20", minute: "15" },
    "Asia/Shanghai"
  );
  assert.equal(parsed.toISOString(), "2026-07-30T12:15:00.000Z");
});

test("formats wake-up time and day/night hour in the configured timezone", () => {
  const date = new Date("2026-07-30T02:15:00.000Z");
  assert.equal(formatDateTimeInTimeZone(date, "Asia/Shanghai"), "2026-07-30 10:15");
  assert.equal(getHourInTimeZone(date, "Asia/Shanghai"), 10);
});

test("labels the user's local day period instead of the server's period", () => {
  assert.equal(getChineseDayPeriod(new Date("2026-08-17T06:53:00.000Z"), "Asia/Shanghai"), "下午");
  assert.equal(getChineseDayPeriod(new Date("2026-08-17T12:00:00.000Z"), "Asia/Shanghai"), "晚上");
});

test("only treats a leading Kelivo label as the message timestamp", () => {
  assert.equal(
    parseLeadingZonedTimestamp("2026-08-18 09:30 今天聊什么？", "Asia/Shanghai").toISOString(),
    "2026-08-18T01:30:00.000Z"
  );
  assert.equal(
    parseLeadingZonedTimestamp("我在回忆 2025-01-01 10:00 的事情", "Asia/Shanghai"),
    null
  );
});

test("falls back when TIME_ZONE is invalid", () => {
  assert.equal(resolveTimeZone("Not/A-Time-Zone"), "Asia/Shanghai");
});
