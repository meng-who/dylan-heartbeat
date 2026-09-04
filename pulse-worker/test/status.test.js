import test from "node:test";
import assert from "node:assert/strict";

import { chatCompletionJsonToSse, prefixChatCompletionJson, prefixSseStream, prefixSseText } from "../src/status.js";

test("prefixes a non-stream chat completion", () => {
  const original = { choices: [{ message: { role: "assistant", content: "过来。" } }] };
  const output = prefixChatCompletionJson(original, "♡ 80 bpm · 36.8°C · 呼吸平稳 · 身体安静");
  assert.match(output.choices[0].message.content, /^♡ 80 bpm/);
  assert.equal(original.choices[0].message.content, "过来。");
});

test("prefixes the first content delta in an SSE stream", async () => {
  const encoder = new TextEncoder();
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"抱住你。"}}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  const transformed = prefixSseStream(source, "♡ 82 bpm · 36.9°C · 呼吸平稳 · 拥抱余温");
  const output = await new Response(transformed).text();
  assert.match(output, /♡ 82 bpm/);
  assert.equal((output.match(/♡ 82 bpm/g) || []).length, 1);
  assert.match(output, /抱住你/);
});

test("canonicalizes SSE and appends a missing DONE marker", () => {
  const input = 'data: {"choices":[{"delta":{"content":"抱住你。"}}]}\r\n\r\n';
  const output = prefixSseText(input, "♡ 82 bpm");
  assert.match(output, /♡ 82 bpm/);
  assert.match(output, /data: \[DONE\]\n\n$/);
});

test("does not duplicate an existing DONE marker", () => {
  const input = 'data: {"choices":[{"delta":{"content":"好。"}}]}\n\ndata: [DONE]\n\n';
  const output = prefixSseText(input, "♡ 80 bpm");
  assert.equal((output.match(/data: \[DONE\]/g) || []).length, 1);
});

test("converts a non-stream completion into a valid SSE response", () => {
  const input = {
    id: "chat-1",
    object: "chat.completion",
    created: 123,
    model: "test-model",
    choices: [{ index: 0, message: { role: "assistant", content: "在。" }, finish_reason: "stop" }]
  };
  const output = chatCompletionJsonToSse(input, "♡ 79 bpm");
  assert.match(output, /"object":"chat.completion.chunk"/);
  assert.match(output, /♡ 79 bpm/);
  assert.match(output, /data: \[DONE\]\n\n$/);
});
