function contentText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map(part => typeof part === "string" ? part : String(part?.text || part?.content || "")).join("");
}

function parseSseChatCompletion(text) {
  let streamed = "";
  let completed = "";
  let lastPayload = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^data:\s*(.*)$/i);
    if (!match) continue;
    const raw = match[1].trim();
    if (!raw || raw === "[DONE]") continue;
    let payload;
    try { payload = JSON.parse(raw); } catch { continue; }
    if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    lastPayload = payload;
    const choice = payload?.choices?.[0] || {};
    const delta = contentText(choice.delta?.content);
    const message = contentText(choice.message?.content);
    const legacy = contentText(choice.text);
    if (delta) streamed += delta;
    else if (message || legacy) completed = message || legacy;
  }
  const content = streamed || completed;
  if (!content && !lastPayload) throw new Error("SSE 响应中没有可读取的 data JSON");
  return {
    ...(lastPayload || {}),
    choices: [{ ...(lastPayload?.choices?.[0] || {}), message: { ...(lastPayload?.choices?.[0]?.message || {}), content } }]
  };
}

function parseChatCompletionResponse(text, contentType = "") {
  const raw = String(text || "");
  if (/text\/event-stream/i.test(contentType) || /^\s*(?:event:.*\r?\n)?data:/i.test(raw)) {
    return parseSseChatCompletion(raw);
  }
  return JSON.parse(raw);
}

module.exports = { parseChatCompletionResponse, parseSseChatCompletion };
