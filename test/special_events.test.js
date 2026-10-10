const assert = require("node:assert/strict");
const test = require("node:test");

const { classifySpecialEventContent, isSpecialEventContent, selectRecentAutomationEvents } = require("../special_events");

test("recognizes timestamped wake events", () => {
  assert.equal(isSpecialEventContent("（2026-08-10 20:10 自动唤醒：本次未发送推送｜原因：不打扰）"), true);
  assert.equal(isSpecialEventContent("（2026/8/10 20:10:03 刚刚给用户发了Bark推送：标题｜正文）"), true);
  assert.equal(isSpecialEventContent("（2026-08-10  20:10 刚刚给宝宝发了 Bark：测试）"), true);
  assert.equal(isSpecialEventContent("（2026-09-11 14:35 自主活动：向 Spotify 歌单添加了歌曲）"), true);
  assert.equal(isSpecialEventContent("（2026-09-13 09:10 Solo 独处：整理了昨晚的感受）"), true);
  assert.equal(isSpecialEventContent("（2026-10-10 23:30 梦境：走廊里的铃铛）"), true);
});

test("classifies push, activity and solo records independently", () => {
  assert.equal(classifySpecialEventContent("（2026-09-13 09:00 刚刚给用户发了 Bark 推送：早安）"), "push");
  assert.equal(classifySpecialEventContent("（2026-09-13 09:05 自主活动：照料了花园）"), "activity");
  assert.equal(classifySpecialEventContent("（2026-09-13 09:10 Solo 独处：安静回想了一会儿）"), "solo");
  assert.equal(classifySpecialEventContent("（2026-10-10 23:30 梦境：走廊里的铃铛）"), "dream");
  assert.equal(classifySpecialEventContent("这是一条普通聊天消息"), "");
});

test("does not mistake ordinary chat about pushes for a wake event", () => {
  assert.equal(isSpecialEventContent("我刚刚给用户发了推送，不过这只是回答里的说明。"), false);
  assert.equal(isSpecialEventContent("2026-08-10 20:10 我觉得‘自动唤醒：本次未发送推送’这句话很奇怪。"), false);
});

test("selects the newest automation records by timestamp rather than array order", () => {
  const events = [
    { content: "（2026-10-10 10:00 自主活动：今天的新活动）" },
    { content: "（2026-10-09 21:00 自主活动：昨天较晚的活动）" },
    { content: "（2026-10-09 09:00 自主活动：昨天较早的活动）" },
    { content: "（2026-10-10 11:00 Solo 独处：今天的独处）" },
    { content: "（2026-10-08 11:00 Solo 独处：前天的独处）" }
  ];
  const selected = selectRecentAutomationEvents(events, {
    maxPushEvents: 0,
    maxActivityEvents: 1,
    maxSoloEvents: 1,
    maxDreamEvents: 0,
    getTimestamp: event => new Date(event.content.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)[0].replace(" ", "T") + ":00Z")
  });
  assert.deepEqual(selected.map(event => event.content), [
    "（2026-10-10 10:00 自主活动：今天的新活动）",
    "（2026-10-10 11:00 Solo 独处：今天的独处）"
  ]);
});
