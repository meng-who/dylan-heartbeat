const test = require("node:test");
const assert = require("node:assert/strict");
const { parseChatCompletionResponse } = require("../upstream_response");

test("parses an official non-stream JSON response", () => {
  const parsed = parseChatCompletionResponse(
    JSON.stringify({ choices: [{ message: { content: "回来看看你" } }] }),
    "application/json"
  );
  assert.equal(parsed.choices[0].message.content, "回来看看你");
});

test("joins SSE deltas when a compatible endpoint ignores stream=false", () => {
  const raw = [
    'data: {"choices":[{"delta":{"content":"回来"}}]}',
    'data: {"choices":[{"delta":{"content":"看看你"}}]}',
    "data: [DONE]"
  ].join("\n\n");
  const parsed = parseChatCompletionResponse(raw, "text/event-stream");
  assert.equal(parsed.choices[0].message.content, "回来看看你");
});
