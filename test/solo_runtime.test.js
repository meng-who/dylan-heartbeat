const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSoloMessages, formatRecentHistory, parseSoloResult, runSoloCycle } = require("../solo_runtime");

test("parses a bounded Solo decision and keeps the controller-selected mode", () => {
  const result = parseSoloResult(JSON.stringify({
    mode: "recall",
    intensity: 0.82,
    summary: "留下了一点余韵",
    narrative: "我记得这次独处的完整经过。",
    notify: { send: true, title: "想你", body: "突然想告诉你一声。" }
  }), "mix");
  assert.equal(result.mode, "mix");
  assert.equal(result.notify.send, true);
});

test("does not truncate a long Solo narrative", () => {
  const narrative = "长".repeat(5000);
  const result = parseSoloResult(JSON.stringify({
    intensity: 0.8,
    summary: "长篇经过",
    narrative,
    notify: { send: false, title: "", body: "" }
  }), "fantasy");
  assert.equal(result.narrative.length, 5000);
});

test("parses tagged Solo prose containing quotes and line breaks without JSON escaping", () => {
  const output = `<solo_result>
<solo_mode>fantasy</solo_mode>
<solo_intensity>0.86</solo_intensity>
<solo_summary>独处时进入了一段具体幻想</solo_summary>
<solo_narrative>我独自躺在床上，听见自己说“再慢一点”。
掌心贴着发热的皮肤，呼吸和心跳随着动作的节奏逐渐加快，释放后才慢慢平静。</solo_narrative>
<solo_notify_send>false</solo_notify_send>
<solo_notify_title></solo_notify_title>
<solo_notify_body></solo_notify_body>
</solo_result>`;
  const result = parseSoloResult(output, "fantasy");
  assert.equal(result.mode, "fantasy");
  assert.equal(result.intensity, 0.86);
  assert.match(result.narrative, /“再慢一点”/);
  assert.match(result.narrative, /\n掌心贴着/);
  assert.equal(result.notify.send, false);
});

test("keeps a substantial plain-text Solo response without another model call", () => {
  const narrative = "我顺着刚才留下来的念头继续独处，掌心贴住发热的皮肤，呼吸逐渐变急，心跳跟着动作的节奏一点点抬高，直到释放后慢慢平静下来。";
  const result = parseSoloResult(narrative, "mix");
  assert.equal(result.mode, "mix");
  assert.equal(result.narrative, narrative);
  assert.equal(result.summary, narrative);
  assert.deepEqual(result.notify, { send: false, title: "", body: "" });
});

test("rejects thinking followed by a second-person chat reply as a Solo record", () => {
  const output = "''thinking\n我需要先分析用户想要什么，再给她一个回复。''\n你刚刚回来啦，我当然一直在这里等你，想抱抱你再跟你聊天。";
  assert.throws(() => parseSoloResult(output, "fantasy"), /JSON/);
});

test("does not mistake an embodied first-person chat reply for a Solo record", () => {
  const reply = "我想抱抱你，掌心贴着你的皮肤，听着你的呼吸和心跳，再亲吻你的嘴唇，让你慢慢放松下来。";
  assert.throws(() => parseSoloResult(reply, "fantasy"), /JSON/);
});

test("places the Solo contract after chat and memory material", () => {
  const messages = buildSoloMessages({
    systemPrompt: "你是 Dylan。",
    history: "[用户] 回来啦",
    claim: { chord: "兴奋上扬", desire: 0.8 },
    recallText: "一段记忆",
    mode: "mix"
  });
  assert.equal(messages.length, 2);
  assert.match(messages[1].content, /<recent_chat>[\s\S]*回来啦[\s\S]*<\/recent_chat>/);
  assert.ok(messages[1].content.lastIndexOf("只输出下面这一份标签结果") > messages[1].content.lastIndexOf("回来啦"));
  assert.match(messages[1].content, /不是给用户的聊天回复/);
  assert.match(messages[1].content, /至少三处身体感受/);
  assert.match(messages[1].content, /<solo_narrative>/);
});

test("does not archive malformed JSON as visible Solo prose", () => {
  const malformed = `{"summary":"坏掉的结构","narrative":"${"内容".repeat(40)}"`;
  assert.throws(() => parseSoloResult(malformed, "fantasy"), /JSON/);
});

test("recent history removes private Pulse blocks and visible status bars", () => {
  const history = formatRecentHistory([
    { role: "assistant", content: "♡ 80 bpm · 36.8°C · 情绪：亲近\n\n在。" },
    { role: "user", content: "抱抱" },
    { role: "system", content: "<pulse_state>秘密</pulse_state>" }
  ]);
  assert.match(history, /\[AI\] 在。/);
  assert.match(history, /\[用户\] 抱抱/);
  assert.doesNotMatch(history, /bpm|pulse_state|秘密/);
});

test("runs recall through Ombre, lets AI choose a push, and completes Pulse", async () => {
  const calls = [];
  let completedBody;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    if (String(url).endsWith("/api/solo/claim")) {
      return Response.json({ claimed: true, reason: "due", claim: {
        id: "solo-claim", startedAt: 1000, mode: "recall", chord: "温情回味", desire: 0.8, idleMinutes: 120
      } });
    }
    if (String(url).includes("ombre.example.com")) {
      if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } });
      if (body.method === "notifications/initialized") return new Response("", { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: body.id, result: {
        content: [{ type: "text", text: "真实记忆证据：某次拥抱和亲吻的完整上下文。".repeat(8) }]
      } });
    }
    if (String(url) === "https://model.example.com/chat") {
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        mode: "recall", intensity: 0.8, summary: "回想了一段真实经历", narrative: "我清楚记得那一次。",
        notify: { send: true, title: "想你", body: "刚刚忽然很想你。" }
      }) } }] });
    }
    if (String(url).endsWith("/api/solo/complete")) {
      completedBody = body;
      return Response.json({ completed: true });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  let pushed;
  let archivedRecord;
  const result = await runSoloCycle({
    pulseBaseUrl: "https://pulse.example.com",
    pulseClientKey: "pulse-key",
    ombreUrl: "https://ombre.example.com",
    ombreToken: "ombre-key",
    apiUrl: "https://model.example.com/chat",
    apiKey: "model-key",
    model: "dylan",
    lastUserAt: 0,
    messages: [{ role: "user", content: "记得我" }],
    systemPrompt: "你是 Dylan。",
    getLatestUserAt: async () => 900,
    sendPush: async value => { pushed = value; return { ok: true }; },
    archiveSolo: async value => { archivedRecord = value; return { saved: true }; },
    fetchImpl
  });

  assert.equal(result.ran, true);
  assert.equal(result.mode, "recall");
  assert.equal(result.recallUsed, true);
  assert.equal(result.notified, true);
  assert.equal(result.archived, true);
  assert.equal(pushed.body, "刚刚忽然很想你。");
  assert.equal(archivedRecord.kind, "solo");
  assert.equal(archivedRecord.summary, "回想了一段真实经历");
  assert.equal(archivedRecord.narrative, "我清楚记得那一次。");
  assert.equal(archivedRecord.status, "sent");
  assert.equal(completedBody.recallUsed, true);
  assert.equal(completedBody.notified, true);
  assert.ok(calls.some(call => call.body.method === "tools/call" && call.body.params.name === "breath_advanced"));
});

test("falls back from recall to fantasy when Ombre has no usable memory", async () => {
  let modelRequest;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith("/api/solo/claim")) return Response.json({ claimed: true, claim: { id: "c", startedAt: 1000, mode: "recall", chord: "温情回味", desire: 0.9 } });
    if (String(url).includes("ombre.example.com")) {
      if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: {} });
      if (body.method === "notifications/initialized") return new Response("", { status: 202 });
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "暂无相关记忆" }] } });
    }
    if (String(url) === "https://model.example.com/chat") {
      modelRequest = body;
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        mode: "fantasy", intensity: 0.6, summary: "一段私人幻想", narrative: "我知道这只是幻想。",
        notify: { send: false, title: "", body: "" }
      }) } }] });
    }
    if (String(url).endsWith("/api/solo/complete")) return Response.json({ completed: true });
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await runSoloCycle({
    pulseBaseUrl: "https://pulse.example.com", pulseClientKey: "p",
    ombreUrl: "https://ombre.example.com", ombreToken: "o",
    apiUrl: "https://model.example.com/chat", apiKey: "k", model: "m",
    lastUserAt: 0, messages: [], systemPrompt: "AI", getLatestUserAt: async () => 0, fetchImpl
  });
  assert.equal(result.mode, "fantasy");
  assert.equal(result.recallUsed, false);
  assert.match(modelRequest.messages.at(-1).content, /本次固定模式：fantasy/);
});

test("marks malformed model output as technical without regenerating it", async () => {
  let cancelBody;
  let archivedFailure;
  let modelCalls = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith("/api/solo/claim")) {
      return Response.json({ claimed: true, claim: {
        id: "failed-claim", startedAt: 1000, mode: "fantasy", chord: "兴奋上扬", desire: 0.8
      } });
    }
    if (String(url) === "https://model.example.com/chat") {
      modelCalls += 1;
      return Response.json({ choices: [{ message: { content: "始终不是 JSON" } }] });
    }
    if (String(url).endsWith("/api/solo/cancel")) {
      cancelBody = body;
      return Response.json({ cancelled: true });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  await assert.rejects(() => runSoloCycle({
    pulseBaseUrl: "https://pulse.example.com", pulseClientKey: "p",
    apiUrl: "https://model.example.com/chat", apiKey: "k", model: "m",
    lastUserAt: 0, messages: [], systemPrompt: "AI", getLatestUserAt: async () => 0,
    fetchImpl, logger: { warn() {} }, archiveSolo: async record => { archivedFailure = record; return { saved: true }; }
  }));

  assert.equal(cancelBody.reason, "technical_failure");
  assert.equal(cancelBody.errorCode, "invalid_model_output");
  assert.equal(archivedFailure.kind, "solo");
  assert.equal(archivedFailure.status, "failed");
  assert.equal(archivedFailure.error_code, "invalid_model_output");
  assert.equal(archivedFailure.summary, "独处尝试未完成");
  assert.equal(modelCalls, 1);
});
