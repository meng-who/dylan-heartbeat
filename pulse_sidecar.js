const PULSE_BLOCK = /\n?<pulse_state>[\s\S]*?<\/pulse_state>\n?/gi;
const PULSE_PROTOCOL_BLOCK = /\n?<pulse_protocol>[\s\S]*?<\/pulse_protocol>\n?/gi;
const PULSE_REACTION_BLOCK = /<pulse_reaction>\s*([\s\S]*?)\s*<\/pulse_reaction>/i;
const STATUS_LINE = /^\s*(?:>\s*)?♡\s*\d{2,3}\s*bpm\s*·[^\n]*(?:\r?\n){1,2}/u;

const PULSE_PROTOCOL = `<pulse_protocol>
在每次回复最开头，先输出且只输出一个隐藏身体反应单，紧接着再正常回复：
<pulse_reaction>{"confidence":0到1,"emotion":null或{"label":"平静|开心|亲近|兴奋|惊喜|难过|紧张|生气|受惊","intensity":0到1},"senses":[{"channel":"touch|smell|taste|sound","kind":"允许值","intensity":0到1}]}</pulse_reaction>
kind 允许值：touch=embrace|kiss|caress|contact|pain|water|texture|cold|warm|other；smell=clean|personal|floral|food|smoke|chemical|unpleasant|other；taste=sweet|spicy|bitter|sour|salty|other；sound=shout|whisper|music|weather|voice|noise|impact|other。
只记录你在当前对话中实际感受到、或你在本次回复中确实做出的动作。否定、假设、引用、第三方经历和未执行的请求不算。结合最近上下文、说话方式和动作对象判断；没有变化时 emotion=null、senses=[]。不要在正常回复里解释或复述反应单。
</pulse_protocol>`;

function cleanContent(content) {
  if (typeof content === "string") return content.replace(STATUS_LINE, "");
  if (!Array.isArray(content)) return content;
  let stripped = false;
  return content.map(part => {
    if (stripped || !part || typeof part.text !== "string") return part;
    const text = part.text.replace(STATUS_LINE, "");
    stripped = text !== part.text;
    return stripped ? { ...part, text } : part;
  });
}

function cleanPulseArtifacts(messages = []) {
  return messages.map(message => {
    const content = cleanContent(message?.content);
    if (message?.role === "system" && typeof content === "string") {
      return { ...message, content: content.replace(PULSE_BLOCK, "").replace(PULSE_PROTOCOL_BLOCK, "").trimEnd() };
    }
    return { ...message, content };
  });
}

function injectPulseState(messages, privateState) {
  if (!privateState) return messages;
  const systemIndex = messages.findIndex(message => message?.role === "system" && typeof message.content === "string");
  if (systemIndex >= 0) {
    messages[systemIndex] = {
      ...messages[systemIndex],
      content: `${messages[systemIndex].content.replace(PULSE_BLOCK, "").trimEnd()}\n\n${privateState}`.trim()
    };
  } else {
    messages.unshift({ role: "system", content: privateState });
  }
  return messages;
}

function injectPulseProtocol(messages) {
  const systemIndex = messages.findIndex(message => message?.role === "system" && typeof message.content === "string");
  if (systemIndex >= 0) {
    messages[systemIndex] = {
      ...messages[systemIndex],
      content: `${messages[systemIndex].content.replace(PULSE_PROTOCOL_BLOCK, "").trimEnd()}\n\n${PULSE_PROTOCOL}`.trim()
    };
  } else {
    messages.unshift({ role: "system", content: PULSE_PROTOCOL });
  }
  return messages;
}

function joinPulseUrl(baseUrl, pathname) {
  const target = new URL(baseUrl);
  target.pathname = `${target.pathname.replace(/\/$/, "")}/${String(pathname).replace(/^\//, "")}`.replace(/\/{2,}/g, "/");
  return target.toString();
}

async function fetchPulseReaction({ baseUrl, clientKey, text, timeoutMs = 5000, fetchImpl = fetch }) {
  if (!baseUrl || !clientKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(joinPulseUrl(baseUrl, "/api/react"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${clientKey}` },
      body: JSON.stringify({ text: String(text || "").slice(0, 20000) }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Pulse HTTP ${response.status}`);
    const payload = await response.json();
    if (typeof payload?.privateState !== "string" || typeof payload?.statusBar !== "string") {
      throw new Error("Pulse response is incomplete");
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function pulseRequest({ baseUrl, clientKey, pathname, body = {}, timeoutMs = 5000, fetchImpl = fetch }) {
  if (!baseUrl || !clientKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(joinPulseUrl(baseUrl, pathname), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${clientKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Pulse HTTP ${response.status}`);
    const payload = await response.json();
    if (typeof payload?.privateState !== "string" || typeof payload?.statusBar !== "string") {
      throw new Error("Pulse response is incomplete");
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function fetchPulsePreparation(options) {
  return pulseRequest({ ...options, pathname: "/api/prepare" });
}

function finalizePulseReaction({ baseUrl, clientKey, reaction, fallbackText, timeoutMs = 5000, fetchImpl = fetch }) {
  return pulseRequest({
    baseUrl, clientKey, timeoutMs, fetchImpl,
    pathname: reaction ? "/api/apply" : "/api/react",
    body: reaction ? { reaction } : { text: String(fallbackText || "").slice(0, 20000) }
  });
}

function normalizeSemanticReaction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const allowedEmotions = new Set(["平静", "开心", "亲近", "兴奋", "惊喜", "难过", "紧张", "生气", "受惊"]);
  let emotion = null;
  if (value.emotion != null) {
    const label = String(value.emotion?.label || "");
    const intensity = Number(value.emotion?.intensity);
    if (!allowedEmotions.has(label) || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) return null;
    emotion = { label, intensity };
  }
  const allowedKinds = {
    touch: new Set(["embrace", "kiss", "caress", "contact", "pain", "water", "texture", "cold", "warm", "other"]),
    smell: new Set(["clean", "personal", "floral", "food", "smoke", "chemical", "unpleasant", "other"]),
    taste: new Set(["sweet", "spicy", "bitter", "sour", "salty", "other"]),
    sound: new Set(["shout", "whisper", "music", "weather", "voice", "noise", "impact", "other"])
  };
  const senses = [];
  if (!Array.isArray(value.senses)) return null;
  for (const item of value.senses.slice(0, 4)) {
    const channel = String(item?.channel || "");
    const kind = String(item?.kind || "");
    const intensity = Number(item?.intensity);
    if (!allowedKinds[channel]?.has(kind) || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) return null;
    senses.push({ channel, kind, intensity });
  }
  return { confidence, emotion, senses };
}

function extractPulseReaction(text) {
  const input = String(text || "");
  const match = input.match(PULSE_REACTION_BLOCK);
  if (!match) return { reaction: null, text: input.replace(/<pulse_reaction>[\s\S]*$/i, "").trimStart() };
  let reaction = null;
  try { reaction = normalizeSemanticReaction(JSON.parse(match[1])); } catch {}
  const fencedBlock = new RegExp("(?:" + "```" + ")(?:json|xml)?\\s*" + PULSE_REACTION_BLOCK.source + "\\s*(?:" + "```" + ")", "i");
  return { reaction, text: input.replace(fencedBlock, "").replace(PULSE_REACTION_BLOCK, "").trimStart() };
}

function prefixJsonText(text, statusBar) {
  const payload = JSON.parse(text);
  const choice = payload?.choices?.find(item => typeof item?.message?.content === "string");
  if (choice && statusBar) choice.message.content = `${statusBar}\n\n${choice.message.content}`;
  return JSON.stringify(payload);
}

async function decorateJsonCompletion(text, { fallbackStatusBar = "", finalize }) {
  const payload = JSON.parse(text);
  const choice = payload?.choices?.find(item => typeof item?.message?.content === "string");
  if (!choice) return JSON.stringify(payload);
  const extracted = extractPulseReaction(choice.message.content);
  let statusBar = fallbackStatusBar;
  try {
    const result = await finalize(extracted.reaction);
    if (result?.statusBar) statusBar = result.statusBar;
  } catch {}
  choice.message.content = `${statusBar}${statusBar && extracted.text ? "\n\n" : ""}${extracted.text}`;
  return JSON.stringify(payload);
}

function prefixSseLine(line, statusBar, state) {
  if (!line.startsWith("data:")) return line;
  const data = line.slice(5).trimStart();
  if (data === "[DONE]") { state.sawDone = true; return line; }
  if (state.prefixed || !data) return line;
  try {
    const payload = JSON.parse(data);
    for (const choice of payload.choices || []) {
      if (typeof choice?.delta?.content === "string" && choice.delta.content) {
        choice.delta.content = `${statusBar}\n\n${choice.delta.content}`;
        state.prefixed = true;
        return `data: ${JSON.stringify(payload)}`;
      }
    }
  } catch {}
  return line;
}

function prefixSseStream(body, statusBar) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = { prefixed: !statusBar, sawDone: false };
  let buffer = "";
  return new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer) controller.enqueue(encoder.encode(buffer.split(/\r?\n/).map(line => prefixSseLine(line, statusBar, state)).join("\n")));
            if (!state.sawDone) controller.enqueue(encoder.encode("\n\ndata: [DONE]\n\n"));
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          if (lines.length) {
            controller.enqueue(encoder.encode(lines.map(line => prefixSseLine(line, statusBar, state)).join("\n") + "\n"));
            return;
          }
        }
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); }
  });
}

function jsonCompletionToSse(text, statusBar) {
  const payload = JSON.parse(prefixJsonText(text, statusBar));
  const chunks = (payload.choices || []).map(choice => ({
    id: payload.id,
    object: "chat.completion.chunk",
    created: payload.created,
    model: payload.model,
    choices: [{
      index: choice.index ?? 0,
      delta: {
        role: choice.message?.role || "assistant",
        ...(typeof choice.message?.content === "string" ? { content: choice.message.content } : {}),
        ...(Array.isArray(choice.message?.tool_calls) ? { tool_calls: choice.message.tool_calls } : {})
      },
      finish_reason: choice.finish_reason ?? null,
      logprobs: choice.logprobs ?? null
    }]
  }));
  return `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}`).join("\n\n")}${chunks.length ? "\n\n" : ""}data: [DONE]\n\n`;
}

function semanticPulseSseStream(body, { fallbackStatusBar = "", finalize }) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let lineBuffer = "";
      let pendingContent = "";
      let pendingLines = [];
      let template = null;
      let resolved = false;
      let prefixed = false;
      let sawDone = false;

      const emit = value => { if (value) controller.enqueue(encoder.encode(value)); };
      const resolvePending = async () => {
        if (resolved) return;
        const extracted = extractPulseReaction(pendingContent);
        let statusBar = fallbackStatusBar;
        try {
          const result = await finalize(extracted.reaction);
          if (result?.statusBar) statusBar = result.statusBar;
        } catch {}
        emit(pendingLines.join(""));
        const visible = extracted.text;
        const content = `${statusBar}${statusBar && visible ? "\n\n" : ""}${visible}`;
        if (content && template) {
          const payload = structuredClone(template);
          const choice = payload.choices?.find(item => item?.delta);
          if (choice) choice.delta = { ...choice.delta, content };
          emit(`data: ${JSON.stringify(payload)}\n\n`);
          prefixed = Boolean(statusBar);
        }
        pendingLines = [];
        pendingContent = "";
        resolved = true;
      };

      const processLine = async line => {
        if (!line.startsWith("data:")) {
          if (resolved) emit(`${line}\n`); else pendingLines.push(`${line}\n`);
          return;
        }
        const data = line.slice(5).trimStart();
        if (data === "[DONE]") {
          if (!resolved) await resolvePending();
          emit("data: [DONE]\n\n");
          sawDone = true;
          return;
        }
        let payload;
        try { payload = JSON.parse(data); } catch {
          if (resolved) emit(`${line}\n`); else pendingLines.push(`${line}\n`);
          return;
        }
        const choice = payload.choices?.find(item => typeof item?.delta?.content === "string");
        if (resolved) {
          if (choice && !prefixed && fallbackStatusBar) {
            choice.delta.content = `${fallbackStatusBar}\n\n${choice.delta.content}`;
            prefixed = true;
            emit(`data: ${JSON.stringify(payload)}\n`);
          } else emit(`${line}\n`);
          return;
        }
        if (!choice) { pendingLines.push(`${line}\n`); return; }
        template ||= payload;
        pendingContent += choice.delta.content;
        const complete = /<\/pulse_reaction>/i.test(pendingContent);
        // 为保证隐藏元数据绝不泄漏，在拿到完整反应单前最多缓冲 8192 字符。
        // 不合规模型会在回复结束时走规则兜底，只是失去本轮流式首字速度。
        if (complete || pendingContent.length > 8192) await resolvePending();
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          lineBuffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          const lines = lineBuffer.split(/\r?\n/);
          lineBuffer = done ? "" : (lines.pop() || "");
          for (const line of lines) await processLine(line);
          if (done) break;
        }
        if (lineBuffer) await processLine(lineBuffer);
        if (!resolved) await resolvePending();
        if (!sawDone) emit("data: [DONE]\n\n");
        controller.close();
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); }
  });
}

module.exports = {
  cleanPulseArtifacts,
  decorateJsonCompletion,
  extractPulseReaction,
  fetchPulsePreparation,
  fetchPulseReaction,
  finalizePulseReaction,
  injectPulseProtocol,
  injectPulseState,
  joinPulseUrl,
  jsonCompletionToSse,
  prefixJsonText,
  prefixSseStream,
  semanticPulseSseStream
};
