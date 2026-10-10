const assert = require("node:assert/strict");
const test = require("node:test");
const { conversationMaterial, dreamNight, requestDream, runDreamCycle } = require("../dream_runtime");

const timeZone = "Asia/Shanghai";
const now = new Date("2026-10-10T15:30:00.000Z");
const baseEnv = {
  DREAM_ENABLED: "true",
  DREAM_PROBABILITY: "0.35",
  DREAM_IDLE_MINUTES: "120",
  DREAM_MODEL_NAME: "glm-4.7-flash",
  BIGMODEL_API_KEY: "test-key",
  WAKE_ARCHIVE_KEY: "test-archive-key"
};

function harness(overrides = {}) {
  let state = {};
  let modelCalls = 0;
  let memoryCalls = 0;
  let archiveCalls = 0;
  let summaryCalls = 0;
  const options = {
    env: { ...baseEnv, ...overrides.env },
    now,
    timeZone,
    lastUserAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
    messages: [{ role: "user", content: "今天我们说到门边的铃铛。" }],
    loadState: () => state,
    saveState: value => { state = value; },
    readMemory: async () => { memoryCalls++; return "一只熟悉的蓝色杯子。"; },
    archive: async record => { archiveCalls++; assert.equal(record.kind, "dream"); return { saved: true }; },
    recordSummary: async () => { summaryCalls++; },
    random: () => 0.5,
    fetchImpl: async () => {
      modelCalls++;
      return {
        ok: true,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            dream: "我走过一条很长的走廊，门边的铃铛没有发声，蓝色杯子却在窗台上轻轻晃动。我伸手去拿，它忽然变成一小片海，潮水从指缝里慢慢退去。",
            summary: "梦见门边的铃铛与变成海的蓝色杯子"
          }) } }]
        })
      };
    },
    logger: { warn() {}, error() {} },
    ...overrides
  };
  return { options, counts: () => ({ modelCalls, memoryCalls, archiveCalls, summaryCalls, state }) };
}

test("night key joins late night and following early morning", () => {
  assert.equal(dreamNight(new Date("2026-10-10T15:30:00Z"), timeZone), "2026-10-10");
  assert.equal(dreamNight(new Date("2026-10-10T23:30:00Z"), timeZone), "2026-10-10");
  assert.equal(dreamNight(new Date("2026-10-10T08:00:00Z"), timeZone), "");
});

test("a missed draw is recorded once and uses no model", async () => {
  const h = harness();
  assert.equal((await runDreamCycle(h.options)).reason, "probability_skipped");
  assert.equal((await runDreamCycle(h.options)).reason, "already_decided");
  assert.deepEqual(h.counts().modelCalls, 0);
  assert.equal(h.counts().memoryCalls, 0);
});

test("a selected night makes one request, archives first, then records summary", async () => {
  const h = harness({ random: () => 0.1 });
  assert.equal((await runDreamCycle(h.options)).reason, "completed");
  assert.equal((await runDreamCycle(h.options)).reason, "already_decided");
  assert.equal(h.counts().modelCalls, 1);
  assert.equal(h.counts().archiveCalls, 1);
  assert.equal(h.counts().summaryCalls, 1);
  assert.equal(h.counts().state.status, "completed");
});

test("dream request uses BigModel Flash without thinking", async () => {
  let requested = false;
  await requestDream({
    apiKey: "test-key",
    model: "glm-4.7-flash",
    messages: [{ role: "user", content: "做一个梦" }],
    fetchImpl: async (url, options) => {
      requested = true;
      assert.equal(url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
      assert.equal(options.headers.authorization, "Bearer test-key");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "glm-4.7-flash");
      assert.deepEqual(body.thinking, { type: "disabled" });
      return {
        ok: true,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({ choices: [{ message: { content: "我走过一条很长的走廊，门边的铃铛没有发声，蓝色杯子却在窗台上轻轻晃动。我伸手去拿，它忽然变成一小片海，潮水从指缝里慢慢退去。" } }] })
      };
    }
  });
  assert.equal(requested, true);
});

test("automation records are excluded from dream conversation material", () => {
  const text = conversationMaterial([
    { role: "user", content: "我们今天聊了桥。" },
    { role: "assistant", content: "（2026-10-10 21:00 Solo 独处：隐私摘要）" },
    { role: "assistant", content: "（2026-10-10 21:30 自主活动：读了一本书）" },
    { role: "assistant", content: "（2026-10-10 22:00 梦境：旧梦）" }
  ]);
  assert.match(text, /桥/);
  assert.doesNotMatch(text, /隐私摘要|读了一本书|旧梦/);
});

