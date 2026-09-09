const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractSentPush,
  findSimilarRecentPush,
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

test("allows a genuinely different concrete follow-up", () => {
  const result = findSimilarRecentPush(
    { title: "Dylan", body: "你说的新键盘到货了吗？" },
    [{ title: "Dylan", body: "午饭记得吃点热的。" }]
  );
  assert.equal(result.matched, false);
});
