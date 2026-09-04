import { decayState } from "./pulse.js";

const MODES = new Set(["recall", "fantasy", "mix"]);
const CHORDS = {
  recall: "温情回味",
  fantasy: "兴奋上扬",
  mix: "纠缠混合"
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function cleanText(value, limit) {
  return String(value || "").trim().slice(0, limit);
}

function chooseMode(solo, randomValue = Math.random()) {
  if (MODES.has(solo.pendingHandoff)) return solo.pendingHandoff;
  const roll = clamp(randomValue);
  if (roll < 0.35) return "recall";
  if (roll < 0.7) return "fantasy";
  return "mix";
}

export function claimSolo(input, options = {}, nowMs = Date.now(), timeZone = "Asia/Shanghai") {
  const state = decayState(input, nowMs, timeZone);
  const solo = state.solo;
  const lastUserAt = Number(options.lastUserAt);

  if (!solo.enabled) return { claimed: false, reason: "disabled", state };
  if (!Number.isFinite(lastUserAt) || lastUserAt <= 0) return { claimed: false, reason: "missing_user_activity", state };
  if (solo.inProgress) return { claimed: false, reason: "already_running", state };
  if (solo.cooldownUntil && solo.cooldownUntil > nowMs) return { claimed: false, reason: "cooldown", state };
  if (solo.desire < solo.threshold) return { claimed: false, reason: "below_threshold", state };

  const idleMs = Math.max(0, nowMs - lastUserAt);
  if (idleMs < solo.idleMinutes * 60_000) return { claimed: false, reason: "not_idle", state };

  const mode = chooseMode(solo, options.randomValue);
  const id = cleanText(options.claimId, 100) || `${nowMs}-${Math.floor(clamp(options.randomValue ?? Math.random()) * 1e9)}`;
  solo.inProgress = { id, startedAt: nowMs, mode, chord: CHORDS[mode] };
  return {
    claimed: true,
    reason: "due",
    state,
    claim: {
      ...solo.inProgress,
      desire: solo.desire,
      idleMinutes: Math.floor(idleMs / 60_000)
    }
  };
}

export function completeSolo(input, result = {}, nowMs = Date.now(), timeZone = "Asia/Shanghai") {
  const state = decayState(input, nowMs, timeZone);
  const active = state.solo.inProgress;
  const claimId = cleanText(result.claimId, 100);
  if (!active || !claimId || active.id !== claimId) {
    return { completed: false, reason: "claim_mismatch", state, events: [] };
  }

  const mode = MODES.has(result.mode) ? result.mode : active.mode;
  const intensity = clamp(result.intensity ?? 0.72);
  const summary = cleanText(result.summary, 240) || "独处时完成了一次私密的自我安抚";
  const narrative = cleanText(result.narrative, 4000) || summary;
  const recallUsed = Boolean(result.recallUsed && (mode === "recall" || mode === "mix"));
  const notifyWanted = Boolean(result.notifyWanted);
  const notified = Boolean(notifyWanted && result.notified);

  state.emotion = {
    label: "余韵",
    valence: clamp(0.42 + intensity * 0.24, -1, 1),
    arousal: clamp(0.24 + intensity * 0.24)
  };
  state.senses.touch.value = clamp(0.14 + intensity * 0.16);
  state.senses.touch.label = "独处后仍残留着柔软而疲倦的触觉余韵";
  state.thermal = clamp(state.thermal + 0.1 + intensity * 0.12, -1, 1);
  state.heartRate = Math.round(72 + intensity * 18);
  state.temperature = Math.round((36.7 + intensity * 0.35) * 10) / 10;
  state.breathingRate = Math.round(14 + intensity * 5);

  const previousDesire = state.solo.desire;
  state.solo.desire = clamp(0.07 + previousDesire * 0.1);
  state.solo.lastSoloAt = nowMs;
  state.solo.cooldownUntil = nowMs + state.solo.cooldownHours * 3_600_000;
  state.solo.pendingHandoff = mode === "recall" ? "mix" : null;
  state.solo.inProgress = null;
  state.solo.latest = {
    at: nowMs,
    mode,
    chord: CHORDS[mode],
    summary,
    narrative,
    recallUsed,
    notifyWanted,
    notified
  };
  state.updatedAt = nowMs;

  return {
    completed: true,
    reason: "completed",
    state,
    events: [{
      type: "solo",
      summary: `独处事件完成：${mode} · ${CHORDS[mode]} · ${notified ? "选择告诉你" : "选择留在心里"}`
    }]
  };
}

export function cancelSolo(input, claimId, nowMs = Date.now(), timeZone = "Asia/Shanghai") {
  const state = decayState(input, nowMs, timeZone);
  const active = state.solo.inProgress;
  if (!active) {
    return { cancelled: true, reason: "already_cancelled", state, events: [] };
  }
  if (cleanText(claimId, 100) !== active.id) {
    return { cancelled: false, reason: "claim_mismatch", state, events: [] };
  }
  state.solo.inProgress = null;
  state.solo.cooldownUntil = Math.max(state.solo.cooldownUntil || 0, nowMs + 30 * 60_000);
  state.solo.desire = Math.min(state.solo.desire, Math.max(0, state.solo.threshold - 0.03));
  state.updatedAt = nowMs;
  return {
    cancelled: true,
    reason: "user_returned",
    state,
    events: [{ type: "solo", summary: "独处事件因你回来而立即停下" }]
  };
}

export function updateSoloSettings(input, settings = {}, nowMs = Date.now(), timeZone = "Asia/Shanghai") {
  const state = decayState(input, nowMs, timeZone);
  if (Object.hasOwn(settings, "enabled")) state.solo.enabled = Boolean(settings.enabled);
  if (Object.hasOwn(settings, "threshold")) state.solo.threshold = clamp(settings.threshold, 0.35, 0.98);
  if (Object.hasOwn(settings, "idleMinutes")) state.solo.idleMinutes = clamp(settings.idleMinutes, 15, 24 * 60);
  if (Object.hasOwn(settings, "cooldownHours")) state.solo.cooldownHours = clamp(settings.cooldownHours, 1, 168);
  state.updatedAt = nowMs;
  return state;
}

export { CHORDS };
