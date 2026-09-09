const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanPulseArtifacts,
  couldStartWithPulseReaction,
  decorateJsonCompletion,
  extractPulseReaction,
  fetchPulsePreparation,
  fetchPulseReaction,
  finalizePulseReaction,
  injectPulseProtocol,
  injectPulseState,
  jsonCompletionToSse,
  prefixSseStream,
  semanticPulseSseStream
} = require("../pulse_sidecar");

test("distinguishes a split Pulse prefix from ordinary text", () => {
  assert.equal(couldStartWithPulseReaction("<pulse_re"), true);
  assert.equal(couldStartWithPulseReaction("```json\n<pulse_re"), true);
  assert.equal(couldStartWithPulseReaction("\\<pulse\\_re"), true);
  assert.equal(couldStartWithPulseReaction("```json\n\\<pulse\\_re"), true);
  assert.equal(couldStartWithPulseReaction("&lt;pulse_re"), true);
  assert.equal(couldStartWithPulseReaction("工具结果出来了。"), false);
});

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

test("injects a mandatory hidden semantic protocol exactly once", () => {
  const messages = [{ role: "system", content: "角色设定" }, { role: "user", content: "抱抱我" }];
  injectPulseProtocol(messages);
  injectPulseProtocol(messages);
  assert.equal((messages[0].content.match(/<pulse_protocol>/g) || []).length, 1);
  assert.match(messages[0].content, /否定、假设、引用、第三方经历/);
});

test("extracts a valid reaction and never exposes its hidden block", () => {
  const result = extractPulseReaction(
    '<pulse_reaction>{"confidence":0.9,"emotion":{"label":"亲近","intensity":0.8},"senses":[{"channel":"touch","kind":"embrace","intensity":0.7}]}</pulse_reaction>\n抱住你。'
  );
  assert.equal(result.reaction.emotion.label, "亲近");
  assert.equal(result.reaction.senses[0].kind, "embrace");
  assert.equal(result.text, "抱住你。");
  assert.doesNotMatch(result.text, /pulse_reaction/);
});

test("accepts surprise as a validated semantic emotion", () => {
  const result = extractPulseReaction(
    '<pulse_reaction>{"confidence":0.94,"emotion":{"label":"惊喜","intensity":0.88},"senses":[]}</pulse_reaction>没想到是礼物。'
  );
  assert.equal(result.reaction.emotion.label, "惊喜");
  assert.equal(result.text, "没想到是礼物。");
});

test("accepts richer validated semantic emotions", () => {
  for (const label of ["安心", "温柔", "满足", "害羞", "期待", "思念", "委屈", "失落", "孤独", "烦躁", "嫉妒", "疲惫"]) {
    const result = extractPulseReaction(
      `<pulse_reaction>{"confidence":0.9,"emotion":{"label":"${label}","intensity":0.7},"senses":[]}</pulse_reaction>正常回复`
    );
    assert.equal(result.reaction.emotion.label, label);
    assert.equal(result.text, "正常回复");
  }
});

test("rejects invented reaction fields and strips malformed hidden output", () => {
  const invalid = extractPulseReaction(
    '<pulse_reaction>{"confidence":1,"emotion":null,"senses":[{"channel":"vision","kind":"secret","intensity":1}]}</pulse_reaction>正常回复'
  );
  assert.equal(invalid.reaction, null);
  assert.equal(invalid.text, "正常回复");
  const incomplete = extractPulseReaction("<pulse_reaction>{broken");
  assert.equal(incomplete.reaction, null);
  assert.equal(incomplete.text, "");
});

test("strips a valid hidden reaction even when the model wraps it in a code fence", () => {
  const result = extractPulseReaction(
    '```json\n<pulse_reaction>{"confidence":0.8,"emotion":null,"senses":[]}</pulse_reaction>\n```\n正常回复'
  );
  assert.equal(result.reaction.confidence, 0.8);
  assert.equal(result.text, "正常回复");
});

test("accepts Markdown-escaped reaction tags without exposing private JSON", () => {
  const result = extractPulseReaction(
    '\\<pulse\\_reaction>{"confidence":0.91,"emotion":{"label":"安心","intensity":0.7},"senses":[]}\\<\/pulse\\_reaction>\n我在。'
  );
  assert.equal(result.reaction.emotion.label, "安心");
  assert.equal(result.text, "我在。");
  assert.doesNotMatch(result.text, /pulse\\?_reaction|confidence/);
});

test("accepts HTML-escaped reaction tags without exposing private JSON", () => {
  const result = extractPulseReaction(
    '&lt;pulse_reaction&gt;{"confidence":0.82,"emotion":null,"senses":[]}&lt;/pulse_reaction&gt;\n正常回复'
  );
  assert.equal(result.reaction.confidence, 0.82);
  assert.equal(result.text, "正常回复");
  assert.doesNotMatch(result.text, /pulse_reaction|confidence/);
});

test("fails closed for an incomplete escaped reaction tag", () => {
  const result = extractPulseReaction('\\<pulse\\_reaction>{"confidence":0.8');
  assert.equal(result.reaction, null);
  assert.equal(result.text, "");
});

test("prepares and finalizes Pulse through separate safe endpoints", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ privateState: "<pulse_state>状态</pulse_state>", statusBar: "♡ 80 bpm" });
  };
  await fetchPulsePreparation({ baseUrl: "https://pulse.example.com", clientKey: "k", fetchImpl });
  await finalizePulseReaction({
    baseUrl: "https://pulse.example.com", clientKey: "k", fallbackText: "抱抱",
    reaction: { confidence: 0.9, emotion: null, senses: [] }, fetchImpl
  });
  await finalizePulseReaction({ baseUrl: "https://pulse.example.com", clientKey: "k", fallbackText: "抱抱", reaction: null, fetchImpl });
  assert.match(calls[0].url, /\/api\/prepare$/);
  assert.match(calls[1].url, /\/api\/apply$/);
  assert.match(calls[2].url, /\/api\/react$/);
  assert.equal(calls[2].body.text, "抱抱");
});

test("decorates JSON with the post-reaction status and strips metadata", async () => {
  let received;
  const hidden = '<pulse_reaction>{"confidence":0.9,"emotion":{"label":"亲近","intensity":0.8},"senses":[]}</pulse_reaction>\n在。';
  const output = await decorateJsonCompletion(JSON.stringify({
    choices: [{ message: { role: "assistant", content: hidden } }]
  }), {
    fallbackStatusBar: "♡ old",
    finalize: async reaction => { received = reaction; return { statusBar: "♡ new" }; }
  });
  const payload = JSON.parse(output);
  assert.equal(received.emotion.label, "亲近");
  assert.match(payload.choices[0].message.content, /^♡ new\n\n在。$/);
  assert.doesNotMatch(payload.choices[0].message.content, /pulse_reaction/);
});

test("keeps an intermediate JSON tool call content-free", async () => {
  let finalized = false;
  const hidden = '<pulse_reaction>{"confidence":0.8,"emotion":null,"senses":[]}</pulse_reaction>';
  const output = await decorateJsonCompletion(JSON.stringify({
    choices: [{
      message: {
        role: "assistant",
        content: hidden,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "search", arguments: "{}" } }]
      },
      finish_reason: "tool_calls"
    }]
  }), {
    fallbackStatusBar: "♡ must not appear",
    finalize: async () => { finalized = true; return { statusBar: "♡ must not appear" }; }
  });
  const payload = JSON.parse(output);
  assert.equal(payload.choices[0].message.content, null);
  assert.equal(payload.choices[0].message.tool_calls[0].function.name, "search");
  assert.equal(finalized, false);
});

test("buffers a split semantic SSE header, applies it, and never leaks it", async () => {
  const encoder = new TextEncoder();
  const reactionJson = '{"confidence":0.92,"emotion":{"label":"受惊","intensity":0.9},"senses":[{"channel":"sound","kind":"shout","intensity":0.95}]}';
  const chunks = [
    'data: {"choices":[{"delta":{"role":"assistant","content":"<pulse_re"}}]}\n\n',
    `data: ${JSON.stringify({ choices: [{ delta: { content: `action>${reactionJson}</pulse_reaction>别喊。` } }] })}\n\n`,
    'data: [DONE]\n\n'
  ];
  let received;
  const source = new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    controller.close();
  }});
  const output = await new Response(semanticPulseSseStream(source, {
    fallbackStatusBar: "♡ old",
    finalize: async reaction => { received = reaction; return { statusBar: "♡ new" }; }
  })).text();
  assert.equal(received.senses[0].kind, "shout");
  assert.match(output, /♡ new/);
  assert.match(output, /别喊/);
  assert.doesNotMatch(output, /pulse_reaction|confidence/);
  assert.equal((output.match(/data: \[DONE\]/g) || []).length, 1);
});

test("buffers and strips an escaped semantic SSE header", async () => {
  const encoder = new TextEncoder();
  const hidden = '\\<pulse\\_reaction>{"confidence":0.9,"emotion":null,"senses":[]}\\<\/pulse\\_reaction>回来啦。';
  const source = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: hidden.slice(0, 11) } }] })}\n\n`));
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: hidden.slice(11) } }] })}\n\n`));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
  }});
  const output = await new Response(semanticPulseSseStream(source, {
    fallbackStatusBar: "♡ old",
    finalize: async reaction => ({ statusBar: reaction ? "♡ new" : "♡ fallback" })
  })).text();
  assert.match(output, /♡ new/);
  assert.match(output, /回来啦/);
  assert.doesNotMatch(output, /pulse\\?_reaction|confidence/);
});

test("passes an SSE tool call through without status text or Pulse settlement", async () => {
  const encoder = new TextEncoder();
  const hidden = '<pulse_reaction>{"confidence":0.8,"emotion":null,"senses":[]}</pulse_reaction>';
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: hidden } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: "{}" } }] }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    "data: [DONE]\n\n"
  ];
  let finalized = false;
  const source = new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    controller.close();
  }});
  const output = await new Response(semanticPulseSseStream(source, {
    fallbackStatusBar: "♡ must not appear",
    finalize: async () => { finalized = true; return { statusBar: "♡ must not appear" }; },
    toolAware: true
  })).text();
  assert.match(output, /call_1/);
  assert.match(output, /tool_calls/);
  assert.doesNotMatch(output, /pulse_reaction|must not appear|confidence/);
  assert.equal(finalized, false);
  assert.equal((output.match(/data: \[DONE\]/g) || []).length, 1);
});

test("streams a plain tool follow-up without waiting for upstream completion", async () => {
  const encoder = new TextEncoder();
  let sourceController;
  const source = new ReadableStream({
    start(controller) { sourceController = controller; }
  });
  const output = semanticPulseSseStream(source, {
    fallbackStatusBar: "♡ 78 bpm",
    finalize: () => new Promise(() => {}),
    toolAware: true,
    finalizeWaitMs: 10
  });
  const reader = output.getReader();

  sourceController.enqueue(encoder.encode(
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "查到了，结果是正常的。" } }] })}\n\n`
  ));

  const first = await Promise.race([
    reader.read(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("plain follow-up was buffered")), 100))
  ]);
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /查到了，结果是正常的/);
  assert.match(text, /♡ 78 bpm/);

  sourceController.enqueue(encoder.encode("data: [DONE]\n\n"));
  sourceController.close();
  await reader.cancel();
});

test("caps the wait for a slow semantic Pulse finalization", async () => {
  const encoder = new TextEncoder();
  const hidden = '<pulse_reaction>{"confidence":0.9,"emotion":null,"senses":[]}</pulse_reaction>完成了。';
  const source = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: hidden } }] })}\n\n`));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
  }});
  const startedAt = Date.now();
  const output = await new Response(semanticPulseSseStream(source, {
    fallbackStatusBar: "♡ fallback",
    finalize: () => new Promise(() => {}),
    finalizeWaitMs: 10
  })).text();

  assert.ok(Date.now() - startedAt < 200);
  assert.match(output, /完成了/);
  assert.match(output, /♡ fallback/);
  assert.doesNotMatch(output, /pulse_reaction/);
});
