export function prefixChatCompletionJson(payload, statusBar) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.choices)) return payload;
  const output = structuredClone(payload);
  const choice = output.choices.find(item => item?.message && typeof item.message.content === "string");
  if (!choice) return output;
  choice.message.content = `${statusBar}\n\n${choice.message.content}`;
  return output;
}

function prefixSseDataLine(line, statusBar, state) {
  if (!line.startsWith("data:")) return line;
  const data = line.slice(5).trimStart();
  if (data === "[DONE]") {
    state.sawDone = true;
    return line;
  }
  if (state.prefixed || !data) return line;
  try {
    const payload = JSON.parse(data);
    for (const choice of payload.choices || []) {
      if (typeof choice?.delta?.content === "string" && choice.delta.content.length > 0) {
        choice.delta.content = `${statusBar}\n\n${choice.delta.content}`;
        state.prefixed = true;
        return `data: ${JSON.stringify(payload)}`;
      }
      if (typeof choice?.message?.content === "string" && choice.message.content.length > 0) {
        choice.message.content = `${statusBar}\n\n${choice.message.content}`;
        state.prefixed = true;
        return `data: ${JSON.stringify(payload)}`;
      }
    }
  } catch {
    return line;
  }
  return line;
}

export function prefixSseText(text, statusBar) {
  const state = { prefixed: !statusBar, sawDone: false };
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  let output = normalized
    .split("\n")
    .map(line => prefixSseDataLine(line, statusBar, state))
    .join("\n")
    .replace(/\n*$/, "");

  if (!state.sawDone) {
    output += `${output ? "\n\n" : ""}data: [DONE]`;
  }
  return `${output}\n\n`;
}

export function chatCompletionJsonToSse(payload, statusBar) {
  const prefixed = prefixChatCompletionJson(payload, statusBar);
  const chunks = (prefixed?.choices || []).map(choice => ({
    id: prefixed.id,
    object: "chat.completion.chunk",
    created: prefixed.created,
    model: prefixed.model,
    system_fingerprint: prefixed.system_fingerprint ?? null,
    choices: [{
      index: choice.index ?? 0,
      delta: {
        role: choice.message?.role || "assistant",
        ...(typeof choice.message?.content === "string" ? { content: choice.message.content } : {}),
        ...(Array.isArray(choice.message?.tool_calls) ? { tool_calls: choice.message.tool_calls } : {})
      },
      logprobs: choice.logprobs ?? null,
      finish_reason: choice.finish_reason ?? null
    }]
  }));
  return `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}`).join("\n\n")}${chunks.length ? "\n\n" : ""}data: [DONE]\n\n`;
}

export function prefixSseStream(body, statusBar) {
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
            if (buffer) {
              const lines = buffer.split(/\r?\n/).map(line => prefixSseDataLine(line, statusBar, state));
              controller.enqueue(encoder.encode(lines.join("\n")));
            }
            if (!state.sawDone) controller.enqueue(encoder.encode(`${buffer ? "\n\n" : ""}data: [DONE]\n\n`));
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          if (lines.length > 0) {
            const transformed = lines.map(line => prefixSseDataLine(line, statusBar, state)).join("\n") + "\n";
            controller.enqueue(encoder.encode(transformed));
            return;
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}
