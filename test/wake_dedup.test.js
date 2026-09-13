const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractSentPush,
  findSimilarRecentPush,
  getLatestSentPushTime,
  getRecentSentPushes
} = require("../wake_dedup");

test("extracts recent Bark and ntfy push payloads from timeline events", () => {
  assert.deepEqual(
    extractSentPush("（2026-09-09 09:10 刚刚给用户发了Bark推送：Dylan｜记得喝水。）"),
    { title: "Dylan", body: "记得喝水。" }
  );
  assert.deepEqual(
    extractSentPush("（2026-09-09 10:10 刚刚给用户发了ntfy推送：Dylan｜去吃午饭。）"),
    { title: "Dylan", body: "去吃午饭。" }
  );
});

test("finds the latest successful push time and ignores no-action events", () => {
  const latest = getLatestSentPushTime([
    { content: "（2026-09-09 08:00 刚刚给用户发了Bark推送：Dylan｜第一条）" },
    { content: "（2026-09-09 09:00 自动唤醒：本次未发送推送）" },
    { content: "（2026-09-09 10:30 刚刚给用户发了ntfy推送：Dylan｜第二条）" }
  ], content => {
    const match = String(content).match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
    return match ? new Date(`${match[1]}T${match[2]}:00+08:00`) : null;
  });
  assert.equal(latest.toISOString(), "2026-09-09T02:30:00.000Z");
});

test("keeps only the latest sent pushes and ignores no-action events", () => {
  const recent = getRecentSentPushes([
    { content: "（2026-09-09 08:00 刚刚给用户发了Bark推送：Dylan｜第一条）" },
    { content: "（2026-09-09 09:00 自动唤醒：本次未发送推送）" },
    { content: "（2026-09-09 10:00 刚刚给用户发了Bark推送：Dylan｜第二条）" }
  ], 1);
  assert.deepEqual(recent, [{ title: "Dylan", body: "第二条" }]);
});

test("rejects near-duplicate wording", () => {
  const result = findSimilarRecentPush(
    { title: "Dylan", body: "忙完了就早点休息，别再熬夜。" },
    [{ title: "Dylan", body: "忙完记得早点休息，不要熬夜。" }]
  );
  assert.equal(result.matched, true);
});

test("rejects a short repeat of the same generic topic", () => {
  const result = findSimilarRecentPush(
    { title: "Dylan", body: "水杯在旁边吗？喝两口。" },
    [{ title: "Dylan", body: "记得补水，别又忘了喝水。" }]
  );
  assert.equal(result.matched, true);
  assert.match(result.reason, /^repeated_topic:/);
});

test("rejects a longer paraphrase with the same check-in intent", () => {
  const result = findSimilarRecentPush(
    { title: "Dylan", body: "刚才想到你今天可能一直在忙，想问问现在还好吗，手头的事情进行得顺利吗？不用急着回复。" },
    [{ title: "Dylan", body: "不知道你今天过得怎么样，工作是不是还顺利。忙完以后再来告诉我一声就好。" }]
  );
  assert.equal(result.matched, true);
  assert.match(result.reason, /^repeated_topic:/);
});

test("allows a genuinely different concrete follow-up", () => {
  const result = findSimilarRecentPush(
    { title: "Dylan", body: "你说的新键盘到货了吗？" },
    [{ title: "Dylan", body: "午饭记得吃点热的。" }]
  );
  assert.equal(result.matched, false);
});
