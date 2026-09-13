const assert = require("node:assert/strict");
const test = require("node:test");

const { classifySpecialEventContent, isSpecialEventContent } = require("../special_events");

test("recognizes timestamped wake events", () => {
  assert.equal(isSpecialEventContent("（2026-08-10 20:10 自动唤醒：本次未发送推送｜原因：不打扰）"), true);
  assert.equal(isSpecialEventContent("（2026/8/10 20:10:03 刚刚给用户发了Bark推送：标题｜正文）"), true);
  assert.equal(isSpecialEventContent("（2026-08-10  20:10 刚刚给宝宝发了 Bark：测试）"), true);
  assert.equal(isSpecialEventContent("（2026-09-11 14:35 自主活动：向 Spotify 歌单添加了歌曲）"), true);
  assert.equal(isSpecialEventContent("（2026-09-13 09:10 Solo 独处：整理了昨晚的感受）"), true);
});

test("classifies push, activity and solo records independently", () => {
  assert.equal(classifySpecialEventContent("（2026-09-13 09:00 刚刚给用户发了 Bark 推送：早安）"), "push");
  assert.equal(classifySpecialEventContent("（2026-09-13 09:05 自主活动：照料了花园）"), "activity");
  assert.equal(classifySpecialEventContent("（2026-09-13 09:10 Solo 独处：安静回想了一会儿）"), "solo");
  assert.equal(classifySpecialEventContent("这是一条普通聊天消息"), "");
});

test("does not mistake ordinary chat about pushes for a wake event", () => {
  assert.equal(isSpecialEventContent("我刚刚给用户发了推送，不过这只是回答里的说明。"), false);
  assert.equal(isSpecialEventContent("2026-08-10 20:10 我觉得‘自动唤醒：本次未发送推送’这句话很奇怪。"), false);
});
