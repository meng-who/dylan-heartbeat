import test from "node:test";
import assert from "node:assert/strict";

import worker, { joinGatewayUrl } from "../src/index.js";
import { createDefaultState } from "../src/pulse.js";

function createMemoryDb({ fail = false } = {}) {
  const state = { row: null, events: [] };
  return {
    state,
    prepare(sql) {
      if (fail) throw new Error("database unavailable");
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() { return state.row; },
        async all() { return { results: state.events }; },
        async run() { return { success: true }; }
      };
    },
    async batch(statements) {
      const upsert = statements[0];
      state.row = { state_json: upsert.values[1] };
      return statements.map(() => ({ success: true }));
    }
  };
}

const baseEnv = {
  PULSE_CLIENT_KEY: "pulse-client",
  DYLAN_GATEWAY_BASE_URL: "https://dylan.example.com",
  DYLAN_GATEWAY_KEY: "gateway-key",
  PULSE_PROFILE: "default",
  STATUS_BAR_ENABLED: "true",
  TIME_ZONE: "Asia/Shanghai"
};

test("joins a Dylan base URL with or without an existing v1 suffix", () => {
  assert.equal(joinGatewayUrl("https://dylan.example.com", "/v1/chat/completions"), "https://dylan.example.com/v1/chat/completions");
  assert.equal(joinGatewayUrl("https://dylan.example.com/v1", "/v1/chat/completions"), "https://dylan.example.com/v1/chat/completions");
});

test("injects private state before Dylan and prefixes the visible response", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, init) => {
    forwarded = { url, init, body: JSON.parse(init.body) };
    return Response.json({ choices: [{ message: { role: "assistant", content: "我接住你了。" } }] });
  };
  try {
    const request = new Request("https://pulse.example.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer pulse-client", "content-type": "application/json" },
      body: JSON.stringify({ model: "dylan", stream: false, messages: [
        { role: "system", content: "你是 Dylan。" },
        { role: "user", content: "抱抱你" }
      ] })
    });
    const response = await worker.fetch(request, { ...baseEnv, DB: createMemoryDb() });
    const payload = await response.json();

    assert.equal(forwarded.url, "https://dylan.example.com/v1/chat/completions");
    assert.equal(forwarded.init.headers.get("authorization"), "Bearer gateway-key");
    assert.match(forwarded.body.messages[0].content, /<pulse_state>/);
    assert.match(payload.choices[0].message.content, /^♡ \d+ bpm/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not forward compression headers and strips stale upstream encoding", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedHeaders;
  globalThis.fetch = async (_url, init) => {
    forwardedHeaders = init.headers;
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }), {
      headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "999" }
    });
  };
  try {
    const request = new Request("https://pulse.example.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer pulse-client",
        "content-type": "application/json",
        "accept-encoding": "gzip, br"
      },
      body: JSON.stringify({ model: "dylan", stream: false, messages: [{ role: "user", content: "test" }] })
    });
    const response = await worker.fetch(request, { ...baseEnv, DB: createMemoryDb() });

    assert.equal(forwardedHeaders.has("accept-encoding"), false);
    assert.equal(response.headers.has("content-encoding"), false);
    assert.equal(response.headers.has("content-length"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails open and sends the untouched request when Pulse storage is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedBody;
  globalThis.fetch = async (_url, init) => {
    forwardedBody = JSON.parse(await new Response(init.body).text());
    return Response.json({ choices: [{ message: { role: "assistant", content: "正常回复" } }] });
  };
  try {
    const originalBody = { model: "dylan", messages: [{ role: "user", content: "你好" }] };
    const request = new Request("https://pulse.example.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer pulse-client", "content-type": "application/json" },
      body: JSON.stringify(originalBody)
    });
    const response = await worker.fetch(request, { ...baseEnv, DB: createMemoryDb({ fail: true }) });
    const payload = await response.json();
    assert.deepEqual(forwardedBody, originalBody);
    assert.equal(payload.choices[0].message.content, "正常回复");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an incorrect Kelivo Pulse key", async () => {
  const request = new Request("https://pulse.example.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer wrong" },
    body: "{}"
  });
  const response = await worker.fetch(request, { ...baseEnv, DB: createMemoryDb() });
  assert.equal(response.status, 401);
});

test("provides a server-side body reaction without proxying a model", async () => {
  const response = await worker.fetch(new Request("https://pulse.example.com/api/react", {
    method: "POST",
    headers: { authorization: "Bearer pulse-client", "content-type": "application/json" },
    body: JSON.stringify({ text: "抱抱你" })
  }), { ...baseEnv, DB: createMemoryDb() });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.match(payload.privateState, /<pulse_state>/);
  assert.match(payload.statusBar, /^♡ \d+ bpm/);
  assert.equal(typeof payload.state.heartRate, "number");
});

test("prepares state and applies a validated semantic reaction", async () => {
  const db = createMemoryDb();
  const prepared = await worker.fetch(new Request("https://pulse.example.com/api/prepare", {
    method: "POST",
    headers: { authorization: "Bearer pulse-client" }
  }), { ...baseEnv, DB: db });
  assert.equal(prepared.status, 200);
  assert.match((await prepared.json()).privateState, /<pulse_state>/);

  const applied = await worker.fetch(new Request("https://pulse.example.com/api/apply", {
    method: "POST",
    headers: { authorization: "Bearer pulse-client", "content-type": "application/json" },
    body: JSON.stringify({ reaction: {
      confidence: 0.95,
      emotion: { label: "受惊", intensity: 0.9 },
      senses: [{ channel: "sound", kind: "shout", intensity: 0.95 }]
    } })
  }), { ...baseEnv, DB: db });
  const payload = await applied.json();
  assert.equal(payload.applied, true);
  assert.equal(payload.state.emotion.label, "受惊");
  assert.ok(payload.state.senses.sound.value >= 0.9);
  assert.match(payload.statusBar, /情绪：受惊/);
});

test("claims and completes a Solo run through the authenticated controller API", async () => {
  const db = createMemoryDb();
  const now = Date.now();
  const state = createDefaultState(now - 4 * 3_600_000);
  state.solo.desire = 0.95;
  state.solo.idleMinutes = 30;
  db.state.row = { state_json: JSON.stringify(state) };

  const claimedResponse = await worker.fetch(new Request("https://pulse.example.com/api/solo/claim", {
    method: "POST",
    headers: { authorization: "Bearer pulse-client", "content-type": "application/json" },
    body: JSON.stringify({ lastUserAt: new Date(now - 2 * 3_600_000).toISOString() })
  }), { ...baseEnv, DB: db });
  const claimed = await claimedResponse.json();
  assert.equal(claimedResponse.status, 200);
  assert.equal(claimed.claimed, true);
  assert.ok(claimed.claim.id);

  const completedResponse = await worker.fetch(new Request("https://pulse.example.com/api/solo/complete", {
    method: "POST",
    headers: { authorization: "Bearer pulse-client", "content-type": "application/json" },
    body: JSON.stringify({
      claimId: claimed.claim.id,
      mode: claimed.claim.mode,
      intensity: 0.7,
      summary: "独处后留下了一点余韵",
      narrative: "一段只进入私密状态的完整经历",
      recallUsed: claimed.claim.mode !== "fantasy",
      notifyWanted: false,
      notified: false
    })
  }), { ...baseEnv, DB: db });
  const completed = await completedResponse.json();
  assert.equal(completedResponse.status, 200);
  assert.equal(completed.completed, true);
  assert.equal(completed.state.solo.latest.summary, "独处后留下了一点余韵");
  assert.equal(completed.state.solo.latest.notified, false);
});

test("opens a streaming response before Dylan replies", async () => {
  const originalFetch = globalThis.fetch;
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  try {
    const request = new Request("https://pulse.example.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer pulse-client", "content-type": "application/json" },
      body: JSON.stringify({ model: "dylan", stream: true, messages: [{ role: "user", content: "在吗" }] })
    });
    const response = await worker.fetch(request, { ...baseEnv, DB: createMemoryDb() });
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /"content":""/);

    release(new Response('data: {"choices":[{"delta":{"content":"在。"}}]}\n\n', {
      headers: { "content-type": "text/event-stream" }
    }));
    let rest = "";
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      rest += new TextDecoder().decode(next.value);
    }
    assert.match(rest, /bpm/);
    assert.match(rest, /data: \[DONE\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
