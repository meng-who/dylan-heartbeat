const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanPulseArtifacts,
  fetchPulseReaction,
  injectPulseState,
  jsonCompletionToSse,
  prefixSseStream
} = require("../pulse_sidecar");

test("cleans old visible and private Pulse state", () => {
  const messages = cleanPulseArtifacts([
    { role: "system", content: "角色设定\n\n<pulse_state>旧状态</pulse_state>" },
    { role: "assistant", content: "♡ 80 bpm · 36.8°C · 呼吸平稳 · 身体安静\n\n过来。" }
  ]);
  assert.equal(messages[0].content, "角色设定");
  assert.equal(messages[1].content, "过来。");
});

test("fetches the body reaction and injects it into the system prompt", async () => {
  const reaction = await fetchPulseReaction({
    baseUrl: "https://pulse.example.com",
    clientKey: "secret",
    text: "抱抱",
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.authorization, "Bearer secret");
      return Response.json({ privateState: "<pulse_state>温暖</pulse_state>", statusBar: "♡ 82 bpm" });
    }
  });
  const messages = [{ role: "system", content: "角色设定" }, { role: "user", content: "抱抱" }];
  injectPulseState(messages, reaction.privateState);
  assert.match(messages[0].content, /<pulse_state>温暖/);
});

test("prefixes SSE text and guarantees a DONE marker", async () => {
  const encoder = new TextEncoder();
  const source = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"在。"}}]}\n\n'));
    controller.close();
  }});
  const output = await new Response(prefixSseStream(source, "♡ 79 bpm")).text();
  assert.match(output, /♡ 79 bpm/);
  assert.match(output, /data: \[DONE\]/);
});

test("converts a JSON completion for a streaming Kelivo request", () => {
  const output = jsonCompletionToSse(JSON.stringify({
    id: "x", model: "m", choices: [{ index: 0, message: { role: "assistant", content: "好。" }, finish_reason: "stop" }]
  }), "♡ 76 bpm");
  assert.match(output, /chat.completion.chunk/);
  assert.match(output, /♡ 76 bpm/);
  assert.match(output, /data: \[DONE\]/);
});
