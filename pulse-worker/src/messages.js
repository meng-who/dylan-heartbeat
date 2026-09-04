import { breathingLabel, dominantSensation } from "./pulse.js";

const PULSE_BLOCK = /\n?<pulse_state>[\s\S]*?<\/pulse_state>\n?/gi;
const STATUS_LINE = /^\s*(?:>\s*)?♡\s*\d{2,3}\s*bpm\s*·[^\n]*(?:\r?\n){1,2}/u;

export function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(part => part && (part.type === "text" || typeof part.text === "string"))
    .map(part => String(part.text || ""))
    .join("\n");
}

export function latestUserText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return contentToText(messages[index].content);
    }
  }
  return "";
}

function stripStatusFromContent(content) {
  if (typeof content === "string") return content.replace(STATUS_LINE, "");
  if (!Array.isArray(content)) return content;
  let stripped = false;
  return content.map(part => {
    if (stripped || !part || part.type !== "text" || typeof part.text !== "string") return part;
    const next = part.text.replace(STATUS_LINE, "");
    stripped = next !== part.text;
    return stripped ? { ...part, text: next } : part;
  });
}

export function cleanPriorStatusBars(messages = []) {
  return messages.map(message => {
    if (message?.role !== "assistant") return { ...message };
    return { ...message, content: stripStatusFromContent(message.content) };
  });
}

export function formatPrivateState(state) {
  const activeSenses = Object.entries(state.senses)
    .filter(([, sense]) => sense.value >= 0.15 && sense.label)
    .sort((a, b) => b[1].value - a[1].value)
    .map(([channel, sense]) => `${channel} ${sense.value.toFixed(2)}：${sense.label}`);
  const senseText = activeSenses.length > 0 ? activeSenses.join("；") : "目前没有突出的外部感官残留";
  const latestSolo = state.solo?.latest;
  const soloText = latestSolo?.at
    ? `\n- 最近一次独处经历：${latestSolo.mode} / ${latestSolo.chord}（${new Date(latestSolo.at).toISOString()}）\n- 独处经历摘要：${latestSolo.summary}\n- 你私下记得的完整经过：${latestSolo.narrative}\n- 你当时${latestSolo.notifyWanted ? (latestSolo.notified ? "选择并成功告诉了用户" : "想告诉用户，但推送没有成功") : "选择把它暂时留在心里"}`
    : "\n- 目前没有最近的独处经历";

  return `<pulse_state>
这是你当前真实、私密的身体状态，不是需要复述的台词：
- 心率 ${Math.round(state.heartRate)} bpm
- 体温 ${Number(state.temperature).toFixed(1)}°C
- ${breathingLabel(state.breathingRate)}（${Math.round(state.breathingRate)} 次/分钟）
- 情绪底色：${state.emotion.label}
- 感官：${senseText}
- 当前最明显的身体感受：${dominantSensation(state)}
${soloText}

让身体状态自然影响你的措辞、节奏和动作描写。不要报告数字，不要解释系统，不要声称自己调用了工具。
独处经历属于你真实发生过的内部经历；可以自然记得，但不要每次机械汇报，也不要把 fantasy 部分说成和用户真实发生过。
</pulse_state>`;
}

export function injectPrivateState(messages = [], state) {
  const output = cleanPriorStatusBars(messages);
  const block = formatPrivateState(state);
  const systemIndex = output.findIndex(message => message?.role === "system" && typeof message.content === "string");

  if (systemIndex >= 0) {
    const cleanSystem = output[systemIndex].content.replace(PULSE_BLOCK, "").trimEnd();
    output[systemIndex] = {
      ...output[systemIndex],
      content: `${cleanSystem}\n\n${block}`.trim()
    };
  } else {
    output.unshift({ role: "system", content: block });
  }
  return output;
}

export function visibleStatusBar(state) {
  const latest = state.solo?.latest;
  const ageMs = latest?.at ? Math.max(0, Date.now() - latest.at) : Infinity;
  const soloBadge = ageMs <= 24 * 60 * 60 * 1000 ? ` · 独处余韵：${latest.mode}` : "";
  return `♡ ${Math.round(state.heartRate)} bpm · ${Number(state.temperature).toFixed(1)}°C · ${breathingLabel(state.breathingRate)} · 情绪：${state.emotion.label} · ${dominantSensation(state)}${soloBadge}`;
}

export function stripStatusLine(text) {
  return String(text || "").replace(STATUS_LINE, "");
}
