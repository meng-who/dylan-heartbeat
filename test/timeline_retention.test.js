const assert = require("node:assert/strict");
const test = require("node:test");

const { retainTimelineMessages } = require("../timeline_retention");

const isEvent = message => message?.kind === "event";

test("wake events do not evict real conversation history", () => {
  const messages = [
    { role: "system", content: "persona" },
    { role: "user", content: "real-1" },
    { role: "assistant", content: "real-2" },
    ...Array.from({ length: 8 }, (_, index) => ({
      role: "assistant",
      content: `event-${index + 1}`,
      kind: "event"
    }))
  ];

  const retained = retainTimelineMessages(messages, {
    maxRealMessages: 2,
    maxSpecialEvents: 3,
    isSpecialEvent: isEvent
  });

  assert.deepEqual(retained.map(message => message.content), [
    "persona",
    "real-1",
    "real-2",
    "event-6",
    "event-7",
    "event-8"
  ]);
});

test("retains the latest system prompt", () => {
  const retained = retainTimelineMessages([
    { role: "system", content: "old persona" },
    { role: "user", content: "hello" },
    { role: "system", content: "new persona" }
  ], { isSpecialEvent: isEvent });

  assert.equal(retained[0].content, "new persona");
});

test("tool traffic does not evict readable conversation history", () => {
  const retained = retainTimelineMessages([
    { role: "system", content: "persona" },
    { role: "user", content: "你记得那篇论文吗" },
    { role: "assistant", content: "记得，我们刚聊到结论。" },
    { role: "assistant", content: "", tool_calls: [{ id: "call-1" }] },
    { role: "tool", content: "very long search result", tool_call_id: "call-1" },
    { role: "user", content: "明天继续看" }
  ], {
    maxRealMessages: 3,
    isSpecialEvent: isEvent,
    isConversationMessage: message => (
      ["user", "assistant"].includes(message?.role)
      && String(message.content || "").trim().length > 0
    )
  });

  assert.deepEqual(retained.map(message => message.content), [
    "persona", "你记得那篇论文吗", "记得，我们刚聊到结论。", "明天继续看"
  ]);
});
