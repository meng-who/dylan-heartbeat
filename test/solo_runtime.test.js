const test = require("node:test");
const assert = require("node:assert/strict");

const { formatRecentHistory, parseSoloResult, runSoloCycle } = require("../solo_runtime");

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
    fetchImpl
  });

  assert.equal(result.ran, true);
  assert.equal(result.mode, "recall");
  assert.equal(result.recallUsed, true);
  assert.equal(result.notified, true);
  assert.equal(pushed.body, "刚刚忽然很想你。");
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
  assert.match(modelRequest.messages[0].content, /本次固定模式：fantasy/);
});
