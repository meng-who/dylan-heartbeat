import test from "node:test";
import assert from "node:assert/strict";

import { cleanPriorStatusBars, injectPrivateState, latestUserText, visibleStatusBar } from "../src/messages.js";
import { createDefaultState, reactToText } from "../src/pulse.js";

test("injects one private state block into the existing system prompt", () => {
  const state = reactToText(createDefaultState(1000), "抱抱", 1000).state;
  const messages = injectPrivateState([
    { role: "system", content: "你是 Dylan。" },
    { role: "user", content: "抱抱" }
  ], state);

  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /你是 Dylan/);
  assert.equal((messages[0].content.match(/<pulse_state>/g) || []).length, 1);
  assert.match(messages[0].content, /不要报告数字/);
});

test("replaces an older state block instead of accumulating it", () => {
  const state = createDefaultState(2000);
  const first = injectPrivateState([{ role: "system", content: "角色设定" }], state);
  const second = injectPrivateState(first, { ...state, heartRate: 91 });
  assert.equal((second[0].content.match(/<pulse_state>/g) || []).length, 1);
  assert.match(second[0].content, /心率 91 bpm/);
});

test("removes the visible status bar before Dylan sees prior assistant text", () => {
  const cleaned = cleanPriorStatusBars([
    { role: "assistant", content: "♡ 84 bpm · 36.9°C · 呼吸平稳 · 拥抱余温\n\n真正的回复正文" }
  ]);
  assert.equal(cleaned[0].content, "真正的回复正文");
});

test("supports multimodal user content when extracting text", () => {
  assert.equal(latestUserText([
    { role: "user", content: [{ type: "text", text: "听见雨声了" }, { type: "image_url", image_url: { url: "data:x" } }] }
  ]), "听见雨声了");
});

test("formats the compact visible status bar", () => {
  const state = reactToText(createDefaultState(1000), "抱抱", 1000).state;
  assert.match(visibleStatusBar(state), /^♡ \d+ bpm · \d+\.\d°C · 呼吸.*· 情绪：/);
});
