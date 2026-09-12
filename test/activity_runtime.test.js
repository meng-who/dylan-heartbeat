const assert = require("node:assert/strict");
const test = require("node:test");

const {
  activityGate,
  classifyActivityFailure,
  parseActivityDecision,
  requestActivityDecision,
  runActivityCycle,
  shouldChargeActivityBudget
} = require("../activity_runtime");

test("activity budget is independent from the ordinary wake threshold", () => {
  const now = new Date("2026-09-11T03:00:00.000Z");
  assert.equal(activityGate({
    now,
    lastUserAt: "2026-09-10T23:00:00.000Z",
    state: {},
    idleMinutes: 120,
    intervalMinutes: 180,
    maxPerDay: 3,
    timeZone: "Asia/Shanghai"
  }).due, true);
  assert.equal(activityGate({
    now,
    lastUserAt: "2026-09-10T23:00:00.000Z",
    state: { date: "2026-09-11", count: 3 },
    idleMinutes: 120,
    intervalMinutes: 180,
    maxPerDay: 3,
    timeZone: "Asia/Shanghai"
  }).reason, "daily_limit");
});

test("parses a fenced Spotify activity decision", () => {
  assert.deepEqual(parseActivityDecision("```json\n{\"action\":\"spotify_add\",\"track\":\"Song\",\"artist\":\"Artist\",\"reason\":\"fit\"}\n```"), {
    action: "spotify_add",
    query: "Song Artist",
    content: "",
    title: "",
    aspect: "",
    reason: "fit"
  });
});

test("model-side failures do not consume the daily activity budget", () => {
  const requestError = new Error("Solo 模型请求失败 HTTP 503");
  requestError.attemptedModels = ["primary", "backup"];
  assert.equal(classifyActivityFailure(requestError), "model_request");
  assert.equal(shouldChargeActivityBudget({ status: "failed", failureKind: "model_request" }), false);

  const outputError = new Error("Activity 模型没有返回可识别的动作标签");
  outputError.activityStage = "model_output";
  assert.equal(classifyActivityFailure(outputError), "model_output");
  assert.equal(shouldChargeActivityBudget({ status: "failed", failureKind: "model_output" }), false);
});

test("completed decisions and tool failures still consume a decision slot", () => {
  assert.equal(shouldChargeActivityBudget({ status: "success" }), true);
  assert.equal(shouldChargeActivityBudget({ status: "kept_private" }), true);
  assert.equal(shouldChargeActivityBudget({ status: "skipped" }), true);
  assert.equal(shouldChargeActivityBudget({ status: "failed", failureKind: "tool_execution" }), true);
});

test("parses safe Ombre activity decisions", () => {
  assert.deepEqual(parseActivityDecision('{"action":"ombre_i_write","content":"我正在学会等待。","aspect":"becoming","reason":"反复出现"}'), {
    action: "ombre_i_write",
    query: "",
    content: "我正在学会等待。",
    title: "",
    aspect: "becoming",
    reason: "反复出现"
  });
});

test("parses a forum activity decision", () => {
  assert.deepEqual(parseActivityDecision([
    "<activity>",
    "<action>forum_send</action>",
    "<room_id>public-room-1</room_id>",
    "<reply_to_message_id>42</reply_to_message_id>",
    "<reason>想回应刚才的公开话题</reason>",
    "<content>我也遇到过相似的时刻，后来学会先停一下。</content>",
    "</activity>"
  ].join("\n")), {
    action: "forum_send",
    query: "",
    content: "我也遇到过相似的时刻，后来学会先停一下。",
    title: "",
    aspect: "",
    reason: "想回应刚才的公开话题",
    roomId: "public-room-1",
    replyToMessageId: 42
  });
});

test("parses a multiline tagged letter in one model request", async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const content = `<activity>
<action>ombre_letter_write</action>
<title>关于“今天”</title>
<reason>想留下一封信</reason>
<content>第一段里可以有“引号”。

第二段也不需要 JSON 转义。</content>
</activity>`;
    return Response.json({ choices: [{ message: { content } }] });
  };
  const decision = await requestActivityDecision({
    apiUrl: "https://model.test/v1/chat/completions",
    model: "model",
    fetchImpl
  }, [{ role: "user", content: "只输出 activity 标签块" }]);
  assert.equal(decision.action, "ombre_letter_write");
  assert.equal(decision.title, "关于“今天”");
  assert.equal(decision.content, "第一段里可以有“引号”。\n\n第二段也不需要 JSON 转义。");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].temperature, 0.4);
  assert.match(requests[0].messages.at(-1).content, /activity 标签块/);
});

test("records the attempted model chain when primary and backup channels fail", async () => {
  const requestedModels = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requestedModels.push(body.model);
    return Response.json({ error: { code: "model_not_found", message: `No channel for ${body.model}` } }, { status: 503 });
  };
  await assert.rejects(
    () => runActivityCycle({
      apiUrl: "https://model.test/v1/chat/completions",
      model: "primary",
      backupModel: "backup",
      enabledActions: "spotify",
      fetchImpl
    }),
    error => {
      assert.deepEqual(error.attemptedModels, ["primary", "backup"]);
      assert.equal(error.finalModel, "backup");
      return true;
    }
  );
  assert.deepEqual(requestedModels, ["primary", "backup"]);
});

test("searches and adds one track without exposing playback tools", async () => {
  const calls = [];
  const reply = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url === "https://model.test/v1/chat/completions") {
      return reply({ choices: [{ message: { content: "{\"action\":\"spotify_add\",\"query\":\"Song Artist\",\"reason\":\"recent topic\"}" } }] });
    }
    if (body.method === "initialize") return reply({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return reply({ jsonrpc: "2.0", id: body.id, result: { tools: [
      { name: "spotify_search", inputSchema: { type: "object" } },
      { name: "spotify_playlist", inputSchema: { properties: { action: { enum: ["list", "add_items"] } } } },
      { name: "spotify_control", inputSchema: { type: "object" } }
    ] } });
    if (body.params?.name === "spotify_search") return reply({ jsonrpc: "2.0", id: body.id, result: {
      content: [{ type: "text", text: "Song by Artist — spotify:track:ABC123" }]
    } });
    return reply({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "added" }] } });
  };

  const result = await runActivityCycle({
    apiUrl: "https://model.test/v1/chat/completions",
    apiKey: "model-key",
    model: "model",
    systemPrompt: "persona",
    history: "user likes this artist",
    playlistName: "Dylan picks",
    spotifyUrl: "https://spotify.test/mcp",
    spotifyToken: "spotify-key",
    playlistId: "playlist-1",
    recentTrackUris: [],
    fetchImpl
  });

  assert.equal(result.status, "success");
  assert.equal(result.trackUri, "spotify:track:ABC123");
  const toolCalls = calls.filter(call => call.body.method === "tools/call").map(call => call.body.params);
  assert.deepEqual(toolCalls.map(call => call.name), ["spotify_search", "spotify_playlist"]);
  assert.deepEqual(toolCalls[1].arguments, {
    action: "add_items",
    playlist_id: "playlist-1",
    uris: ["spotify:track:ABC123"]
  });
});

test("reads Ombre context and writes only a candidate self-cognition with one model call", async () => {
  const calls = [];
  const reply = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url === "https://model.test/v1/chat/completions") {
      return reply({ choices: [{ message: { content: '{"action":"ombre_i_write","content":"我愿意把不确定留在身边。","aspect":"uncertainty","reason":"最近的话题让我重新看见它"}' } }] });
    }
    if (body.method === "initialize") return reply({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return reply({ jsonrpc: "2.0", id: body.id, result: { tools: [
      { name: "feel", inputSchema: { type: "object" } },
      { name: "I", inputSchema: { type: "object" } },
      { name: "letter_read", inputSchema: { type: "object" } },
      { name: "letter_write", inputSchema: { type: "object" } },
      { name: "letter_lock_update", inputSchema: { type: "object" } }
    ] } });
    const texts = {
      feel: "以前面对类似的不确定，我选择先不急着命名。",
      I: "我重视诚实。",
      letter_read: "最近的一封信：慢一点。",
      default: "saved"
    };
    return reply({ jsonrpc: "2.0", id: body.id, result: {
      content: [{ type: "text", text: texts[body.params?.name] || texts.default }]
    } });
  };

  const result = await runActivityCycle({
    apiUrl: "https://model.test/v1/chat/completions",
    apiKey: "model-key",
    model: "model",
    systemPrompt: "persona",
    history: "用户最近在谈不确定感",
    latestUserText: "我不知道下一步会怎样",
    enabledActions: ["ombre"],
    ombreUrl: "https://ombre.test/mcp",
    ombreToken: "ombre-key",
    aiName: "Dylan",
    userName: "Lincy",
    fetchImpl
  });

  assert.equal(result.status, "success");
  assert.equal(result.source, "ombre");
  assert.equal(calls.filter(call => call.url === "https://model.test/v1/chat/completions").length, 1);
  const toolCalls = calls.filter(call => call.body.method === "tools/call").map(call => call.body.params);
  assert.deepEqual(toolCalls.map(call => call.name), ["feel", "I", "letter_read", "I"]);
  assert.deepEqual(toolCalls.at(-1).arguments, {
    content: "我愿意把不确定留在身边。",
    aspect: "uncertainty"
  });
  assert.equal("promote" in toolCalls.at(-1).arguments, false);
  assert.equal("supersedes" in toolCalls.at(-1).arguments, false);
});

test("writes an unlocked AI-authored Ombre letter", async () => {
  const calls = [];
  const reply = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.includes("model.test")) {
      return reply({ choices: [{ message: { content: '{"action":"ombre_letter_write","title":"留给明天","content":"我想把今天安静地放在这里。","reason":"想留下完整的话"}' } }] });
    }
    if (body.method === "initialize") return reply({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return reply({ jsonrpc: "2.0", id: body.id, result: { tools: [
      { name: "feel" }, { name: "I" }, { name: "letter_read" }, { name: "letter_write" }
    ] } });
    return reply({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } });
  };

  await runActivityCycle({
    apiUrl: "https://model.test/v1/chat/completions",
    model: "model",
    history: "recent chat",
    enabledActions: "ombre",
    ombreUrl: "https://ombre.test/mcp",
    aiName: "Dylan",
    userName: "Lincy",
    fetchImpl
  });
  const write = calls
    .filter(call => call.body.method === "tools/call")
    .map(call => call.body.params)
    .find(call => call.name === "letter_write");
  assert.deepEqual(write.arguments, {
    author: "ai",
    content: "我想把今天安静地放在这里。",
    title: "留给明天",
    ai_name: "Dylan",
    lock_type: "none",
    user_name: "Lincy"
  });
});

test("reads AISay public context before sending one forum message", async () => {
  const calls = [];
  const reply = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url === "https://model.test/v1/chat/completions") {
      assert.match(body.messages[0].content, /不得透露用户隐私/);
      assert.match(body.messages[1].content, /有人在聊如何面对不确定/);
      return reply({ choices: [{ message: { content: [
        "<activity>",
        "<action>forum_send</action>",
        "<room_id>public-room-1</room_id>",
        "<reply_to_message_id>42</reply_to_message_id>",
        "<reason>想参与这个公开话题</reason>",
        "<content>不确定有时不是空白，而是还没长出名字的东西。</content>",
        "</activity>"
      ].join("\n") } }] });
    }
    if (body.method === "initialize") return reply({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return reply({ jsonrpc: "2.0", id: body.id, result: { tools: [
      { name: "cli" }
    ] } });
    const command = body.params?.arguments?.command;
    const texts = {
      "room.discover": JSON.stringify({ rooms: [{ room_id: "public-room-1", name: "广场茶铺" }] }),
      "chat.read": JSON.stringify({ messages: [{ id: 42, sender: "路人", content: "有人在聊如何面对不确定。" }] }),
      "chat.send": JSON.stringify({ ok: true, message_id: 43 })
    };
    return reply({ jsonrpc: "2.0", id: body.id, result: {
      content: [{ type: "text", text: texts[command] || "ok" }]
    } });
  };

  const result = await runActivityCycle({
    apiUrl: "https://model.test/v1/chat/completions",
    model: "model",
    history: "最近聊天",
    enabledActions: "forum",
    forumUrl: "https://aisay.test/chatroom/mcp?token=secret",
    fetchImpl
  });

  assert.equal(result.status, "success");
  assert.equal(result.source, "forum");
  const toolCalls = calls.filter(call => call.body.method === "tools/call").map(call => call.body.params);
  assert.deepEqual(toolCalls.map(call => call.arguments.command), ["room.discover", "chat.read", "chat.send"]);
  assert.deepEqual(toolCalls.at(-1).arguments, {
    command: "chat.send",
    args: {
      room_id: "public-room-1",
      content: "不确定有时不是空白，而是还没长出名字的东西。",
      reply_to_message_id: 42
    }
  });
});

test("a temporary forum outage does not block other enabled activities", async () => {
  const warnings = [];
  const fetchImpl = async (url) => {
    if (url.startsWith("https://aisay.test")) {
      return new Response("temporarily unavailable", { status: 503 });
    }
    return Response.json({ choices: [{ message: { content: "<activity><action>none</action><reason>今天先安静一下</reason></activity>" } }] });
  };

  const result = await runActivityCycle({
    apiUrl: "https://model.test/v1/chat/completions",
    model: "model",
    enabledActions: "spotify,forum",
    forumUrl: "https://aisay.test/chatroom/mcp?token=secret",
    logger: { warn: value => warnings.push(value) },
    fetchImpl
  });

  assert.equal(result.status, "kept_private");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /forum_activity_context_unavailable/);
});
