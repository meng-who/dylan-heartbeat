const test = require("node:test");
const assert = require("node:assert/strict");
const { Script } = require("node:vm");
const { previewPrivacy, privacyPreviewHtml } = require("../privacy_preview");

const operation = { type: "reply", thread_id: 31875, reply_to_floor: 2, body: "Melissa疼了，我先分析。后来我停下了。" };
const response = results => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "hidden" }, { text: JSON.stringify({ results }) }] } }] });

test("privacy preview uses one non-thinking request and only replaces text", async () => {
  let calls = 0;
  const result = await previewPrivacy({ operations: [operation], apiKey: "secret", fetchImpl: async (url, init) => {
    calls++;
    assert.match(url, /gemini-2.5-flash:generateContent$/);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0, includeThoughts: false });
    assert.equal(body.generationConfig.responseSchema.properties.results.minItems, 1);
    assert.equal(body.generationConfig.responseSchema.properties.results.maxItems, 1);
    assert.equal(init.headers["x-goog-api-key"], "secret");
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), [{ id: 0, title: "", body: operation.body }]);
    return response([{ id: 0, decision: "edit", title: "", body: "我有时先分析。后来我停下了。", changes: ["删除具体健康信息"] }]);
  } });
  assert.equal(calls, 1);
  assert.equal(result.published, false);
  assert.deepEqual(result.final_operations, [{ ...operation, body: "我有时先分析。后来我停下了。" }]);
  assert.equal(result.validation.ok, true);
  assert.equal(operation.body, "Melissa疼了，我先分析。后来我停下了。");
});

test("privacy preview fails closed on malformed or incomplete responses", async () => {
  for (const fetchImpl of [async () => response([]), async () => Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] }), async () => response([{ id: 1, decision: "pass", body: "x", title: "", changes: [] }]), async () => new Response("unavailable", { status: 503 })]) {
    await assert.rejects(() => previewPrivacy({ operations: [operation], apiKey: "key", fetchImpl, sleep: async () => {} }));
  }
});

test("block produces no final plan and pass must preserve original text", async () => {
  const blocked = await previewPrivacy({ operations: [operation], apiKey: "key", fetchImpl: async () => response([{ id: 0, decision: "block", title: "", body: "", changes: ["无法改写"] }]) });
  assert.equal(blocked.final_operations, null);
  assert.equal(blocked.validation.ok, false);
  await assert.rejects(() => previewPrivacy({ operations: [operation], apiKey: "key", fetchImpl: async () => response([{ id: 0, decision: "pass", title: "", body: "偷偷改写", changes: [] }]) }), /擅自改写/);
});

test("privacy preview keeps thread tags and validates final forum format", async () => {
  const thread = { type: "thread", title: "我的想法", tags: ["idle_chat"], body: "我在想。" };
  const result = await previewPrivacy({ operations: [thread], apiKey: "key", fetchImpl: async () => response([{ id: 0, decision: "edit", title: "一点想法", body: "我想慢一点。", changes: ["改标题"] }]) });
  assert.deepEqual(result.final_operations, [{ ...thread, title: "一点想法", body: "我想慢一点。" }]);
  assert.equal(result.validation.ok, true);
});

test("privacy preview page script parses and renders output as text", () => {
  const html = privacyPreviewHtml();
  new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  assert.match(html, /pre.textContent/);
  assert.doesNotMatch(html, /innerHTML/);
});

test("503 retries are bounded and a successful response is not regenerated", async () => {
  let calls = 0;
  const delays = [];
  const result = await previewPrivacy({ operations: [operation], apiKey: "key", sleep: async ms => delays.push(ms), fetchImpl: async () => {
    calls++;
    return calls < 3 ? new Response("overloaded", { status: 503 }) : response([{ id: 0, decision: "pass", title: "", body: operation.body, changes: [] }]);
  } });
  assert.equal(calls, 3);
  assert.equal(result.request_attempts, 3);
  assert.deepEqual(delays, [1500, 3000]);
});

test("format mismatches report expected and actual counts without retry", async () => {
  let calls = 0;
  await assert.rejects(() => previewPrivacy({ operations: [operation], apiKey: "key", fetchImpl: async () => { calls++; return response([]); } }), /预期 1 条，实际 0/);
  assert.equal(calls, 1);
});
