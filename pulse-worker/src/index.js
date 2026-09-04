import { dashboardPage, createSessionCookie, hasValidSession, loginPage } from "./dashboard.js";
import { formatPrivateState, injectPrivateState, latestUserText, visibleStatusBar } from "./messages.js";
import { applySemanticReaction, decayState, publicSnapshot, reactToText } from "./pulse.js";
import { cancelSolo, claimSolo, completeSolo, updateSoloSettings } from "./solo.js";
import { listEvents, loadState, saveState } from "./storage.js";
import { chatCompletionJsonToSse, prefixChatCompletionJson, prefixSseStream, prefixSseText } from "./status.js";

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const STREAM_HEARTBEAT_MS = 8_000;
const EMPTY_SSE_CHUNK = 'data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":""},"finish_reason":null}]}\n\n';

function responseHtml(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers }
  });
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function bearerToken(request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function clientAuthorized(request, env) {
  return Boolean(env.PULSE_CLIENT_KEY) && bearerToken(request) === env.PULSE_CLIENT_KEY;
}

function profileId(env) {
  return String(env.PULSE_PROFILE || "default").slice(0, 80);
}

function joinGatewayUrl(base, pathname, search = "") {
  const target = new URL(base);
  const basePath = target.pathname.replace(/\/$/, "");
  const requestPath = pathname.startsWith("/v1/") && basePath.endsWith("/v1")
    ? pathname.slice(3)
    : pathname;
  target.pathname = `${basePath}${requestPath.startsWith("/") ? "" : "/"}${requestPath}`.replace(/\/{2,}/g, "/");
  target.search = search;
  return target.toString();
}

function gatewayHeaders(request, env, hasJsonBody) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (lower === "authorization" || lower === "host" || lower === "content-length" || lower === "accept-encoding" || lower.startsWith("cf-")) continue;
    headers.set(name, value);
  }
  if (hasJsonBody) headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${env.DYLAN_GATEWAY_KEY}`);
  headers.set("x-gateway-api-key", env.DYLAN_GATEWAY_KEY);
  return headers;
}

async function forwardToDylan(request, env, body) {
  if (!env.DYLAN_GATEWAY_BASE_URL || !env.DYLAN_GATEWAY_KEY) {
    return json({ error: "Pulse 尚未配置 Dylan Gateway" }, 503);
  }
  const incoming = new URL(request.url);
  const target = joinGatewayUrl(env.DYLAN_GATEWAY_BASE_URL, incoming.pathname, incoming.search);
  const hasBody = !["GET", "HEAD"].includes(request.method);
  const bodyIsJson = typeof body === "string";
  return fetch(target, {
    method: request.method,
    headers: gatewayHeaders(request, env, bodyIsJson),
    body: hasBody ? (body ?? request.body) : undefined,
    redirect: "manual"
  });
}

function responseHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");
  return headers;
}

function copyResponse(response, body = response.body) {
  const headers = responseHeaders(response);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function liveSseResponse(request, env, transformedBody, statusBar) {
  const encoder = new TextEncoder();
  let heartbeat;
  let upstreamReader;
  let stopped = false;

  const body = new ReadableStream({
    start(controller) {
      const enqueue = value => {
        if (stopped) return false;
        try {
          controller.enqueue(typeof value === "string" ? encoder.encode(value) : value);
          return true;
        } catch {
          stopped = true;
          clearInterval(heartbeat);
          return false;
        }
      };

      // 立即给 Kelivo 一个合法的空数据块，先把连接建立起来。
      enqueue(EMPTY_SSE_CHUNK);
      heartbeat = setInterval(() => enqueue(EMPTY_SSE_CHUNK), STREAM_HEARTBEAT_MS);

      (async () => {
        try {
          const upstream = await forwardToDylan(request, env, transformedBody);
          const contentType = upstream.headers.get("content-type") || "";
          if (!upstream.ok) {
            const message = (await upstream.text()).slice(0, 500) || `Dylan 返回 ${upstream.status}`;
            enqueue(`data: ${JSON.stringify({ error: { message, status: upstream.status } })}\n\ndata: [DONE]\n\n`);
            return;
          }

          if (contentType.includes("text/event-stream") && upstream.body) {
            upstreamReader = prefixSseStream(upstream.body, statusBar).getReader();
            while (!stopped) {
              const { value, done } = await upstreamReader.read();
              if (done) break;
              if (!enqueue(value)) break;
            }
            return;
          }

          const text = await upstream.text();
          try {
            const payload = JSON.parse(text);
            if (Array.isArray(payload?.choices)) enqueue(chatCompletionJsonToSse(payload, statusBar));
            else enqueue(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
          } catch {
            enqueue(prefixSseText(text, statusBar));
          }
        } catch (error) {
          enqueue(`data: ${JSON.stringify({ error: { message: String(error?.message || error) } })}\n\ndata: [DONE]\n\n`);
        } finally {
          clearInterval(heartbeat);
          if (!stopped) {
            stopped = true;
            controller.close();
          }
        }
      })();
    },
    cancel(reason) {
      stopped = true;
      clearInterval(heartbeat);
      return upstreamReader?.cancel(reason);
    }
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive"
    }
  });
}

async function handleModels(request, env) {
  if (!clientAuthorized(request, env)) return json({ error: "Pulse API Key 无效或缺失" }, 401);
  return copyResponse(await forwardToDylan(request, env));
}

async function handleChat(request, env) {
  if (!clientAuthorized(request, env)) return json({ error: "Pulse API Key 无效或缺失" }, 401);

  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) {
    console.log(JSON.stringify({ event: "pulse_passthrough", reason: "large_multimodal_request", bytes: length }));
    return copyResponse(await forwardToDylan(request, env));
  }

  const untouched = request.clone();
  let state;
  let transformedBody;
  let requestedStream = false;
  try {
    const body = await request.json();
    if (!Array.isArray(body.messages)) throw new Error("messages must be an array");
    requestedStream = body.stream === true;
    const now = Date.now();
    const oldState = await loadState(env.DB, profileId(env), now);
    const reaction = reactToText(oldState, latestUserText(body.messages), now, env.TIME_ZONE || "Asia/Shanghai");
    state = reaction.state;
    await saveState(env.DB, profileId(env), state, reaction.events);
    transformedBody = JSON.stringify({
      ...body,
      messages: injectPrivateState(body.messages, state)
    });
    console.log(JSON.stringify({
      event: "pulse_updated",
      heart_rate: state.heartRate,
      emotion: state.emotion.label,
      event_types: reaction.events.map(item => item.type)
    }));
  } catch (error) {
    console.warn(JSON.stringify({ event: "pulse_fail_open", stage: "request", error: String(error?.message || error) }));
    return copyResponse(await forwardToDylan(untouched, env));
  }

  if (requestedStream) {
    const showStatus = String(env.STATUS_BAR_ENABLED || "true").toLowerCase() !== "false";
    return liveSseResponse(untouched, env, transformedBody, showStatus ? visibleStatusBar(state) : "");
  }

  const upstream = await forwardToDylan(untouched, env, transformedBody);
  if (!upstream.ok || String(env.STATUS_BAR_ENABLED || "true").toLowerCase() === "false") {
    return copyResponse(upstream);
  }

  const statusBar = visibleStatusBar(state);
  const contentType = upstream.headers.get("content-type") || "";
  try {
    if (contentType.includes("text/event-stream") && upstream.body) {
      // Kelivo 对不完整或边界异常的 SSE 很敏感。先收完整，再统一换行并保证 [DONE] 收尾。
      const text = await upstream.text();
      const headers = responseHeaders(upstream);
      headers.set("content-type", "text/event-stream; charset=utf-8");
      headers.set("cache-control", "no-cache, no-transform");
      return new Response(prefixSseText(text, statusBar), { status: upstream.status, headers });
    }
    if (contentType.includes("application/json")) {
      const payload = await upstream.clone().json();
      if (requestedStream && Array.isArray(payload?.choices)) {
        const headers = responseHeaders(upstream);
        headers.set("content-type", "text/event-stream; charset=utf-8");
        headers.set("cache-control", "no-cache, no-transform");
        return new Response(chatCompletionJsonToSse(payload, statusBar), { status: upstream.status, headers });
      }
      const prefixed = prefixChatCompletionJson(payload, statusBar);
      const headers = responseHeaders(upstream);
      return new Response(JSON.stringify(prefixed), { status: upstream.status, headers });
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: "pulse_fail_open", stage: "response", error: String(error?.message || error) }));
  }
  return copyResponse(upstream);
}

async function handleBody(request, env) {
  if (!await hasValidSession(request, env.SESSION_SECRET)) return responseHtml(loginPage());
  return responseHtml(dashboardPage(), 200, { "cache-control": "no-store" });
}

async function handleLogin(request, env) {
  const form = await request.formData();
  if (!env.DASHBOARD_PASSWORD || form.get("password") !== env.DASHBOARD_PASSWORD) {
    return responseHtml(loginPage("密码不正确，请再试一次。"), 401);
  }
  const cookie = await createSessionCookie(env.SESSION_SECRET);
  return new Response(null, { status: 303, headers: { location: "/body", "set-cookie": cookie } });
}

async function handleStateApi(request, env) {
  if (!await hasValidSession(request, env.SESSION_SECRET)) return json({ error: "Unauthorized" }, 401);
  const now = Date.now();
  const stored = await loadState(env.DB, profileId(env), now);
  const current = decayState(stored, now, env.TIME_ZONE || "Asia/Shanghai");
  const events = await listEvents(env.DB, profileId(env), 30);
  return json({ state: publicSnapshot(current), events });
}

async function handleReactApi(request, env) {
  if (!clientAuthorized(request, env)) return json({ error: "Pulse API Key 无效或缺失" }, 401);
  const body = await request.json().catch(() => ({}));
  const now = Date.now();
  const oldState = await loadState(env.DB, profileId(env), now);
  const reaction = reactToText(oldState, String(body?.text || ""), now, env.TIME_ZONE || "Asia/Shanghai");
  await saveState(env.DB, profileId(env), reaction.state, reaction.events);
  return json({
    privateState: formatPrivateState(reaction.state),
    statusBar: visibleStatusBar(reaction.state),
    state: publicSnapshot(reaction.state)
  });
}

function pulsePayload(state) {
  return {
    privateState: formatPrivateState(state),
    statusBar: visibleStatusBar(state),
    state: publicSnapshot(state)
  };
}

async function handlePrepareApi(request, env) {
  if (!clientAuthorized(request, env)) return json({ error: "Pulse API Key 无效或缺失" }, 401);
  const now = Date.now();
  const stored = await loadState(env.DB, profileId(env), now);
  const state = decayState(stored, now, env.TIME_ZONE || "Asia/Shanghai");
  await saveState(env.DB, profileId(env), state, []);
  return json(pulsePayload(state));
}

async function handleApplyApi(request, env) {
  if (!clientAuthorized(request, env)) return json({ error: "Pulse API Key 无效或缺失" }, 401);
  const body = await request.json().catch(() => ({}));
  const now = Date.now();
  const stored = await loadState(env.DB, profileId(env), now);
  const result = applySemanticReaction(stored, body?.reaction, now, env.TIME_ZONE || "Asia/Shanghai");
  await saveState(env.DB, profileId(env), result.state, result.events);
  return json({ ...pulsePayload(result.state), applied: result.applied });
}

function parseTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function handleSoloClaimApi(request, env) {
  if (!clientAuthorized(request, env)) return json({ error: "Pulse API Key 无效或缺失" }, 401);
  const body = await request.json().catch(() => ({}));
  const now = Date.now();
  const stored = await loadState(env.DB, profileId(env), now);
  const result = claimSolo(stored, {
    lastUserAt: parseTime(body?.lastUserAt),
    claimId: crypto.randomUUID()
  }, now, env.TIME_ZONE || "Asia/Shanghai");
  await saveState(env.DB, profileId(env), result.state, []);
  return json({ claimed: result.claimed, reason: result.reason, claim: result.claim || null, state: publicSnapshot(result.state) });
}

async function handleSoloCompleteApi(request, env) {
  if (!clientAuthorized(request, env)) return json({ error: "Pulse API Key 无效或缺失" }, 401);
  const body = await request.json().catch(() => ({}));
  const now = Date.now();
  const stored = await loadState(env.DB, profileId(env), now);
  const result = completeSolo(stored, body, now, env.TIME_ZONE || "Asia/Shanghai");
  await saveState(env.DB, profileId(env), result.state, result.events);
  return json({ completed: result.completed, reason: result.reason, ...pulsePayload(result.state) }, result.completed ? 200 : 409);
}

async function handleSoloCancelApi(request, env) {
  if (!clientAuthorized(request, env)) return json({ error: "Pulse API Key 无效或缺失" }, 401);
  const body = await request.json().catch(() => ({}));
  const now = Date.now();
  const stored = await loadState(env.DB, profileId(env), now);
  const result = cancelSolo(stored, body?.claimId, now, env.TIME_ZONE || "Asia/Shanghai");
  await saveState(env.DB, profileId(env), result.state, result.events);
  return json({ cancelled: result.cancelled, reason: result.reason, state: publicSnapshot(result.state) }, result.cancelled ? 200 : 409);
}

async function handleSoloSettingsApi(request, env) {
  if (!await hasValidSession(request, env.SESSION_SECRET)) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const now = Date.now();
  const stored = await loadState(env.DB, profileId(env), now);
  const state = updateSoloSettings(stored, body, now, env.TIME_ZONE || "Asia/Shanghai");
  await saveState(env.DB, profileId(env), state, [{ type: "solo", summary: "Solo 设置已更新" }]);
  return json({ state: publicSnapshot(state) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ ok: true, service: "dylan-pulse" });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return Response.redirect(`${url.origin}/body`, 302);
    }
    if (request.method === "GET" && url.pathname === "/body") return handleBody(request, env);
    if (request.method === "POST" && url.pathname === "/body/login") return handleLogin(request, env);
    if (request.method === "GET" && url.pathname === "/api/state") return handleStateApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/prepare") return handlePrepareApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/apply") return handleApplyApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/react") return handleReactApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/solo/claim") return handleSoloClaimApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/solo/complete") return handleSoloCompleteApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/solo/cancel") return handleSoloCancelApi(request, env);
    if (request.method === "POST" && url.pathname === "/api/solo/settings") return handleSoloSettingsApi(request, env);
    if (request.method === "GET" && url.pathname === "/v1/models") return handleModels(request, env);
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") return handleChat(request, env);
    return json({ error: "Not found" }, 404);
  }
};

export { forwardToDylan, handleChat, joinGatewayUrl };
