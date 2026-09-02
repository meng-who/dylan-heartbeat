const PULSE_BLOCK = /\n?<pulse_state>[\s\S]*?<\/pulse_state>\n?/gi;
const STATUS_LINE = /^\s*(?:>\s*)?♡\s*\d{2,3}\s*bpm\s*·[^\n]*(?:\r?\n){1,2}/u;

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
      return { ...message, content: content.replace(PULSE_BLOCK, "").trimEnd() };
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

function prefixJsonText(text, statusBar) {
  const payload = JSON.parse(text);
  const choice = payload?.choices?.find(item => typeof item?.message?.content === "string");
  if (choice && statusBar) choice.message.content = `${statusBar}\n\n${choice.message.content}`;
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

module.exports = {
  cleanPulseArtifacts,
  fetchPulseReaction,
  injectPulseState,
  joinPulseUrl,
  jsonCompletionToSse,
  prefixJsonText,
  prefixSseStream
};
