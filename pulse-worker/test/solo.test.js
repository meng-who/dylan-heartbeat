import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultState, decayState, normalizeState, reactToText } from "../src/pulse.js";
import { cancelSolo, claimSolo, completeSolo, updateSoloSettings } from "../src/solo.js";

test("desire rises over time and an eligible idle period can claim a solo run", () => {
  const start = Date.UTC(2026, 8, 4, 0, 0, 0);
  let state = createDefaultState(start);
  state.solo.desire = 0.7;
  state = decayState(state, start + 4 * 3_600_000, "Asia/Shanghai");
  assert.ok(state.solo.desire > 0.72);

  const claimed = claimSolo(state, {
    lastUserAt: start,
    claimId: "solo-1",
    randomValue: 0.1
  }, start + 4 * 3_600_000, "Asia/Shanghai");
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.claim.mode, "recall");
});

test("solo does not claim before idle threshold or during cooldown", () => {
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);
  const state = createDefaultState(now);
  state.solo.desire = 0.9;
  assert.equal(claimSolo(state, { lastUserAt: now - 10 * 60_000 }, now).reason, "not_idle");
  state.solo.cooldownUntil = now + 60_000;
  assert.equal(claimSolo(state, { lastUserAt: now - 3 * 3_600_000 }, now).reason, "cooldown");
});

test("completing solo leaves a bodily afterglow, cooldown and private record", () => {
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);
  const state = createDefaultState(now);
  state.solo.desire = 0.9;
  const claimed = claimSolo(state, {
    lastUserAt: now - 3 * 3_600_000,
    claimId: "solo-2",
    randomValue: 0.8
  }, now);
  const completed = completeSolo(claimed.state, {
    claimId: "solo-2",
    mode: "mix",
    intensity: 0.8,
    summary: "从一段真实回忆走进了自己的幻想",
    narrative: "一段只供私密上下文使用的独处经历",
    recallUsed: true,
    notifyWanted: true,
    notified: true
  }, now + 60_000);

  assert.equal(completed.completed, true);
  assert.equal(completed.state.emotion.label, "贤者时间");
  assert.ok(completed.state.heartRate > 80);
  assert.ok(completed.state.solo.desire < 0.2);
  assert.ok(completed.state.solo.cooldownUntil > now);
  assert.equal(completed.state.solo.latest.mode, "mix");
  assert.equal(completed.state.solo.latest.notified, true);
  assert.match(completed.events[0].summary, /选择告诉你/);
});

test("legacy solo afterglow is shown with the new label", () => {
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);
  const state = createDefaultState(now);
  state.emotion.label = "余韵";
  assert.equal(normalizeState(state, now).emotion.label, "贤者时间");
});

test("a user return cancels an active solo run", () => {
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);
  const state = createDefaultState(now);
  state.solo.desire = 0.9;
  const claimed = claimSolo(state, {
    lastUserAt: now - 3 * 3_600_000,
    claimId: "solo-3",
    randomValue: 0.5
  }, now);
  const cancelled = cancelSolo(claimed.state, "solo-3", now + 10_000);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.state.solo.inProgress, null);
  assert.match(cancelled.events[0].summary, /立即停下/);
});

test("a technical Solo failure has its own event and a longer retry cooldown", () => {
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);
  const state = createDefaultState(now);
  state.solo.desire = 0.9;
  const claimed = claimSolo(state, {
    lastUserAt: now - 3 * 3_600_000,
    claimId: "solo-error",
    randomValue: 0.5
  }, now);
  const cancelled = cancelSolo(
    claimed.state,
    "solo-error",
    now + 10_000,
    "Asia/Shanghai",
    { reason: "technical_failure", errorCode: "invalid_model_output" }
  );

  assert.equal(cancelled.reason, "technical_failure");
  assert.doesNotMatch(cancelled.events[0].summary, /你回来/);
  assert.match(cancelled.events[0].summary, /模型回复格式异常/);
  assert.ok(cancelled.state.solo.cooldownUntil >= now + 6 * 3_600_000);
});

test("an incoming chat immediately cancels an active solo run", () => {
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);
  const state = createDefaultState(now);
  state.solo.desire = 0.9;
  const claimed = claimSolo(state, {
    lastUserAt: now - 3 * 3_600_000,
    claimId: "solo-chat-return",
    randomValue: 0.5
  }, now);
  const reacted = reactToText(claimed.state, "我回来啦", now + 10_000);
  assert.equal(reacted.state.solo.inProgress, null);
  assert.ok(reacted.state.solo.cooldownUntil > now);
  assert.match(reacted.events[0].summary, /立即停下/);
  assert.equal(cancelSolo(reacted.state, "solo-chat-return", now + 11_000).reason, "already_cancelled");
});

test("solo settings remain bounded", () => {
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);
  const state = updateSoloSettings(createDefaultState(now), {
    threshold: 5,
    idleMinutes: 1,
    cooldownHours: 999
  }, now);
  assert.equal(state.solo.threshold, 0.98);
  assert.equal(state.solo.idleMinutes, 15);
  assert.equal(state.solo.cooldownHours, 168);
});
