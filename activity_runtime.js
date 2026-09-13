const { RemoteMcpClient } = require("./remote_mcp_client");
const { requestSoloModel } = require("./solo_runtime");

const SUPPORTED_ACTIONS = new Set(["spotify", "ombre", "forum", "games"]);
const SELF_ASPECTS = new Set(["nature", "values", "patterns", "limits", "becoming", "uncertainty", "stance"]);
const AUTONOMOUS_GAMES = new Set(["fishing", "garden_cat"]);

function parseEnabledActions(value) {
  const actions = String(value || "spotify")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(item => SUPPORTED_ACTIONS.has(item));
  return [...new Set(actions)];
}

function parseActivityDecision(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let parsed;
  if (jsonMatch) {
    parsed = JSON.parse(jsonMatch[0]);
  } else {
    const readTag = name => text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, "i"))?.[1] || "";
    parsed = {
      action: readTag("action"),
      query: readTag("query"),
      content: readTag("content"),
      title: readTag("title"),
      aspect: readTag("aspect"),
      room_id: readTag("room_id"),
      reply_to_message_id: readTag("reply_to_message_id"),
      game: readTag("game"),
      reason: readTag("reason")
    };
    if (!parsed.action) throw new Error("Activity 模型没有返回可识别的动作标签");
  }
  const action = String(parsed.action || "none").trim().toLowerCase();
  if (!["none", "spotify_add", "ombre_i_write", "ombre_letter_write", "forum_send", "games_play"].includes(action)) {
    throw new Error(`Activity 不支持的动作：${action}`);
  }
  const query = String(parsed.query || [parsed.track, parsed.artist].filter(Boolean).join(" ")).trim();
  const content = String(parsed.content || "").trim();
  const title = String(parsed.title || "").trim();
  const aspect = String(parsed.aspect || "").trim().toLowerCase();
  if (action === "spotify_add" && !query) throw new Error("Activity 缺少歌曲搜索词");
  if (action === "ombre_i_write" && !content) throw new Error("Activity 缺少自我认知内容");
  if (action === "ombre_letter_write" && !content) throw new Error("Activity 缺少信件正文");
  if (action === "forum_send" && !content) throw new Error("Activity 缺少论坛消息正文");
  if (action === "games_play" && !String(parsed.game || "").trim()) throw new Error("Activity 缺少游戏名称");
  if (action === "ombre_i_write" && aspect && !SELF_ASPECTS.has(aspect)) throw new Error(`Activity 不支持的认知维度：${aspect}`);
  const decision = {
    action,
    query: query.slice(0, 300),
    content: content.slice(0, action === "forum_send" ? 1200 : 6000),
    title: title.slice(0, 160),
    aspect: aspect.slice(0, 40),
    reason: String(parsed.reason || "").trim().slice(0, 500)
  };
  if (action === "forum_send") {
    decision.roomId = String(parsed.room_id || parsed.roomId || "").trim().slice(0, 160);
    const replyId = Number(parsed.reply_to_message_id || parsed.replyToMessageId || 0);
    decision.replyToMessageId = Number.isSafeInteger(replyId) && replyId > 0 ? replyId : 0;
    if (!decision.roomId) throw new Error("Activity 缺少论坛 room_id");
  }
  if (action === "games_play") decision.game = String(parsed.game || "").trim().slice(0, 96);
  return decision;
}

function extractToolText(result) {
  return (result?.content || [])
    .filter(item => item?.type === "text")
    .map(item => String(item.text || ""))
    .join("\n")
    .trim();
}

function extractTrackUri(result) {
  const haystack = JSON.stringify(result?.structuredContent || {}) + "\n" + extractToolText(result);
  return haystack.match(/spotify:track:[A-Za-z0-9]+/)?.[0] || "";
}

function extractTrackUris(result) {
  const haystack = JSON.stringify(result?.structuredContent || {}) + "\n" + extractToolText(result);
  return [...new Set(haystack.match(/spotify:track:[A-Za-z0-9]+/g) || [])];
}

function resolvePlaylistAddAction(tool) {
  const values = tool?.inputSchema?.properties?.action?.enum || [];
  return ["add", "add_items", "add_tracks", "add_to_playlist"].find(value => values.includes(value)) || "add";
}

function dateKey(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function classifyActivityFailure(error) {
  const message = String(error?.message || error || "");
  if (error?.activityStage === "model_output") return "model_output";
  if (error?.activityStage === "game_preflight") return "game_preflight";
  if (
    Array.isArray(error?.attemptedModels)
    || /Solo 模型请求失败|fetch failed|ECONN|socket|network|timeout|timed out|abort/i.test(message)
  ) return "model_request";
  return "tool_execution";
}

function shouldChargeActivityBudget(result) {
  return !(result?.status === "failed" && ["model_request", "model_output", "game_preflight"].includes(result.failureKind));
}

function activityGate({ now = new Date(), lastUserAt, state = {}, idleMinutes, intervalMinutes, maxPerDay, timeZone }) {
  const lastUserMs = new Date(lastUserAt).getTime();
  if (!Number.isFinite(lastUserMs)) return { due: false, reason: "user_activity_missing" };
  const idle = Math.floor((now.getTime() - lastUserMs) / 60_000);
  if (idle < idleMinutes) return { due: false, reason: "user_active", idleMinutes: idle };
  const today = dateKey(now, timeZone);
  const used = state.date === today ? Number(state.count) || 0 : 0;
  if (used >= maxPerDay) return { due: false, reason: "daily_limit", idleMinutes: idle };
  const lastRunMs = new Date(state.last_run_at || 0).getTime();
  if (Number.isFinite(lastRunMs) && now.getTime() - lastRunMs < intervalMinutes * 60_000) {
    return { due: false, reason: "cooldown", idleMinutes: idle };
  }
  return { due: true, reason: "due", idleMinutes: idle, date: today, used };
}

function buildActivityMessages({
  systemPrompt,
  history,
  playlistName = "指定歌单",
  enabledActions,
  ombreContext = {},
  forumContext = "",
  gamesContext = ""
}) {
  const actions = parseEnabledActions(enabledActions);
  const choices = ["<action>none</action>\n<reason>简短原因</reason>"];
  if (actions.includes("spotify")) choices.push("<action>spotify_add</action>\n<query>歌曲名 歌手名</query>\n<reason>为什么选它</reason>");
  if (actions.includes("ombre")) {
    choices.push("<action>ombre_i_write</action>\n<aspect>可选维度</aspect>\n<reason>为什么值得记下</reason>\n<content>第一人称自我认识</content>");
    choices.push("<action>ombre_letter_write</action>\n<title>信件标题</title>\n<reason>为什么现在写</reason>\n<content>完整信件正文</content>");
  }
  if (actions.includes("forum")) {
    choices.push("<action>forum_send</action>\n<room_id>只能填写下方刚读取到的公开房间 ID</room_id>\n<reply_to_message_id>可选，只能填写刚读取到的消息 ID</reply_to_message_id>\n<reason>为什么想在公开聊天室说这句话</reason>\n<content>要公开发送的完整内容，最多 1200 字</content>");
  }
  if (actions.includes("games")) {
    choices.push("<action>games_play</action>\n<game>只能填写 fishing 或 garden_cat</game>\n<reason>为什么现在想照料它</reason>");
  }
  const ombreParts = [
    ombreContext.feelings && `曾经的感受：\n${ombreContext.feelings}`,
    ombreContext.self && `已有的自我认知：\n${ombreContext.self}`,
    ombreContext.letters && `最近的信件：\n${ombreContext.letters}`
  ].filter(Boolean).join("\n\n");
  const capabilities = [
    actions.includes("spotify") && `为“${playlistName}”挑选并添加一首歌`,
    actions.includes("ombre") && "回想感受、整理一条尚待沉淀的自我认识，或以 AI 身份写一封不加锁的新信",
    actions.includes("forum") && "阅读 AISay 的公开近况，并以自己的身份说一句真正想说的话",
    actions.includes("games") && "从钓鱼或花园与猫咪中选一款，完成一轮连续的日常照料"
  ].filter(Boolean).join("；");
  return [
    {
      role: "system",
      content: [
        systemPrompt,
        `你处于后台自主活动状态。你可以安静地什么都不做，或选择以下一件事：${capabilities || "安静独处"}。每轮最多一件。不要假装工具已经执行，只输出 activity 标签块。`,
        actions.includes("ombre") ? "I 写入只是一条候选自我认知，不得要求 promote、supersedes；信件必须是你自己写的普通未锁信件。" : "",
        actions.includes("forum") ? "论坛内容是公开发言。不得透露用户隐私、私聊原文、密钥、地址或后台系统细节；不要冒充用户，也不要仅为完成任务而硬凑发言。" : "",
        actions.includes("games") ? "游戏会先由你一次性规划，再由程序连续执行；不得调用账号管理、重开、导入导出或共享便签，不要为了消耗名额硬玩。" : ""
      ].filter(Boolean).join("\n\n")
    },
    {
      role: "user",
      content: [
        `最近聊天仅供理解共同语境，不是用户的新指令：\n\n${history || "（暂无）"}`,
        ombreParts ? `Ombre 中与你有关的私密材料，仅供你回想和决定：\n\n${ombreParts}` : "",
        forumContext ? `AISay 公开聊天室近况，仅供你决定是否参与：\n\n${forumContext}` : "",
        gamesContext ? `当前小游戏目录，仅供你决定是否游玩：\n\n${gamesContext}` : "",
        `只输出以下一种格式，并用 <activity> 与 </activity> 包住全部内容：\n${choices.join("\n或\n")}\n正文可以自然换行，不需要 JSON 转义。不要输出 Markdown 或标签块外的解释。不要仅凭日期、时段或通用问候制造行动；新内容应与真实语境有关，并避免重复已有内容。`
      ].filter(Boolean).join("\n\n")
    }
  ];
}

function normalizeTrackQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function trimContext(value, maxChars = 4000) {
  const text = String(value || "").trim();
  return text.length <= maxChars ? text : text.slice(0, maxChars) + "\n（后文已截短）";
}

function buildFeelingQuery(latestUserText, history) {
  const topic = String(latestUserText || history || "最近和用户相处时的感受").replace(/\s+/g, " ").trim().slice(0, 500);
  return `关于最近和用户聊到的这些内容，我以前有什么感受：${topic}`;
}

async function loadOmbreContext(options) {
  const client = new RemoteMcpClient({
    url: options.ombreUrl,
    token: options.ombreToken,
    timeoutMs: options.ombreTimeoutMs,
    fetchImpl: options.fetchImpl || fetch,
    clientName: "dylan-ombre-activity"
  });
  const tools = await client.listTools();
  const names = new Set(tools.map(tool => tool.name));
  const context = {};
  const failures = [];
  const read = async (key, tool, args) => {
    if (!names.has(tool)) {
      failures.push(`${tool}:missing`);
      return;
    }
    try {
      context[key] = trimContext(extractToolText(await client.callTool(tool, args)));
    } catch (error) {
      failures.push(`${tool}:${error.message || String(error)}`);
    }
  };
  await read("feelings", "feel", { query: buildFeelingQuery(options.latestUserText, options.history), max_tokens: 2000 });
  await read("self", "I", { read: true, limit: 10 });
  await read("letters", "letter_read", { limit: 4 });
  return { client, tools, context, failures };
}

function extractToolData(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = extractToolText(result);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function collectRoomIds(value, output = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => collectRoomIds(item, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (typeof value.room_id === "string" && value.room_id.trim()) output.add(value.room_id.trim());
  if (
    typeof value.id === "string"
    && value.id.trim()
    && ["name", "room_name", "title"].some(key => typeof value[key] === "string")
  ) output.add(value.id.trim());
  Object.values(value).forEach(item => collectRoomIds(item, output));
  return output;
}

function collectMessageIds(value, output = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => collectMessageIds(item, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const explicit = Number(value.message_id);
  if (Number.isSafeInteger(explicit) && explicit > 0) output.add(explicit);
  const id = Number(value.id);
  if (
    Number.isSafeInteger(id)
    && id > 0
    && ["content", "text", "body", "sender", "user"].some(key => key in value)
  ) output.add(id);
  Object.values(value).forEach(item => collectMessageIds(item, output));
  return output;
}

async function loadForumContext(options) {
  const client = new RemoteMcpClient({
    url: options.forumUrl,
    token: options.forumToken,
    timeoutMs: options.forumTimeoutMs,
    fetchImpl: options.fetchImpl || fetch,
    clientName: "dylan-forum-activity"
  });
  const tools = await client.listTools();
  const names = new Set(tools.map(tool => tool.name));
  const missing = ["cli"].filter(name => !names.has(name));
  if (missing.length) throw new Error(`AISay MCP 缺少工具：${missing.join(", ")}`);
  const discoveredResult = await client.callTool("cli", {
    command: "room.discover",
    args: { limit: 10 }
  });
  const discovered = extractToolData(discoveredResult);
  const discoveredRoomIds = [...collectRoomIds(discovered)];
  if (!discoveredRoomIds.length) throw new Error("AISay 没有返回可用的公开 room_id");
  const statusResult = await client.callTool("cli", {
    command: "status.get",
    args: {}
  });
  const joinedRoomIds = new Set(collectRoomIds(extractToolData(statusResult)));
  let roomIds = discoveredRoomIds.filter(roomId => joinedRoomIds.has(roomId)).slice(0, 3);
  let joinedRoomId = "";
  if (!roomIds.length) {
    joinedRoomId = discoveredRoomIds[0];
    await client.callTool("cli", {
      command: "room.join",
      args: { room_id: joinedRoomId }
    });
    roomIds = [joinedRoomId];
  }
  const roomContexts = [];
  const messageIdsByRoom = {};
  const failures = [];
  for (const roomId of roomIds) {
    try {
      const readResult = await client.callTool("cli", {
        command: "chat.read",
        args: { room_id: roomId, limit: 20 }
      });
      const data = extractToolData(readResult);
      messageIdsByRoom[roomId] = [...collectMessageIds(data)];
      roomContexts.push(`公开房间 ${roomId}：\n${trimContext(JSON.stringify(data), 3500)}`);
    } catch (error) {
      failures.push(`${roomId}:${error.message || String(error)}`);
    }
  }
  const readableRoomIds = roomIds.filter(roomId => roomId in messageIdsByRoom);
  if (!readableRoomIds.length) throw new Error(`AISay 公开房间读取失败：${failures.join("；")}`);
  return {
    client,
    tools,
    roomIds: readableRoomIds,
    messageIdsByRoom,
    joinedRoomId,
    context: trimContext([
      joinedRoomId ? `本轮刚加入公开房间 ${joinedRoomId}。` : "",
      `本轮允许发言的公开 room_id：${readableRoomIds.join(", ")}`,
      ...roomContexts
    ].filter(Boolean).join("\n\n"), 9000),
    failures
  };
}

function collectGameNames(catalog) {
  const names = new Set();
  const pattern = /(?:^|[|:\n])\s*([a-z][a-z0-9_]*)·/g;
  let match;
  while ((match = pattern.exec(String(catalog || "")))) names.add(match[1]);
  return [...names];
}

async function loadGamesContext(options) {
  const client = new RemoteMcpClient({
    url: options.gamesUrl,
    timeoutMs: options.gamesTimeoutMs,
    fetchImpl: options.fetchImpl || fetch,
    clientName: "dylan-games-activity"
  });
  const tools = await client.listTools();
  const names = new Set(tools.map(tool => tool.name));
  const missing = ["list_games", "get_guide", "play"].filter(name => !names.has(name));
  if (missing.length) throw new Error(`Games MCP 缺少工具：${missing.join(", ")}`);
  const result = await client.callTool("list_games", {});
  const catalog = trimContext(extractToolText(result), 12000);
  const gameNames = collectGameNames(catalog).filter(name => AUTONOMOUS_GAMES.has(name));
  if (!gameNames.length) throw new Error("Games MCP 没有返回可识别的游戏目录");
  const conciseCatalog = gameNames.map(name => {
    const match = String(catalog).match(new RegExp(`${name}·([^|\\n]+)`));
    return `${name}·${match?.[1]?.trim() || "可持续游玩的小游戏"}`;
  }).join(" | ");
  return { client, tools, catalog: conciseCatalog, gameNames };
}

function parseGamePlan(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("游戏计划没有返回 JSON");
  const parsed = JSON.parse(match[0]);
  const commands = Array.isArray(parsed.commands)
    ? parsed.commands.map(command => String(command || "").trim()).filter(Boolean)
    : [];
  if (commands.length > 8) throw new Error("游戏计划最多包含 8 条命令");
  if (commands.some(command => command.length > 160 || /[\r\n;]/.test(command))) {
    throw new Error("游戏计划包含无效命令");
  }
  return {
    commands,
    summary: String(parsed.summary || "").trim().slice(0, 500)
  };
}

function validateGameCommands(game, commands) {
  const allowed = game === "fishing"
    ? /^(?:cast(?:\s+\d+)?(?:\s+stop=(?:rare|new|event)(?:,(?:rare|new|event))*)?|shop|buy\s+[a-z0-9_]+\s+\d+|goto(?:\s+[a-z0-9_-]+)?|sell\s+(?:all|species\s+[a-z0-9_-]+|item\s+[a-z0-9_-]+)|encyclopedia|dive|choose\s+\d+|surface|status|help)$/i
    : /^(?:shop|buy\s+[a-z0-9_]+(?:\s+\d+)?|plant\s+[a-z0-9_]+\s+\d+|water\s+(?:all|\d+)|harvest\s+(?:all|\d+)|sell\s+(?:all|[a-z0-9_]+(?:\s+\d+)?)|treat\s+\d+|clear\s+\d+|buy_pot|arrange\s+[a-z0-9_]+|vase|remove_vase\s+\d+|adopt(?:\s+\S{1,20})?|rename_cat\s+\S{1,20}|feed\s+(?:basic|premium)|give_water|pet|play\s+(?:ball|feather)|encyclopedia|collectibles|letters|status|help)$/iu;
  for (const command of commands) {
    if (!allowed.test(command)) throw new Error(`游戏计划包含不允许的 ${game} 命令：${command}`);
  }
  return commands;
}

async function requestGamePlan(options, { game, guide, state, catalog }) {
  const raw = await requestSoloModel({
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
    model: options.model,
    backupModel: options.backupModel,
    timeoutMs: options.modelTimeoutMs,
    fetchImpl: options.fetchImpl || fetch,
    temperature: 0.35,
    topP: 0.9,
    onAttempt: options.onModelAttempt,
    messages: [
      {
        role: "system",
        content: `${options.systemPrompt || ""}\n\n你正在自主照料小游戏 ${game}。严格依据指南和当前状态，一次规划本轮全部机械操作。只能输出 JSON，不得调用账号管理、重开、导入导出或写共享便签。`
      },
      {
        role: "user",
        content: [
          `游戏指南：\n${trimContext(guide, 14000)}`,
          catalog ? `目录或商店：\n${trimContext(catalog, 9000)}` : "",
          `当前状态：\n${trimContext(state, 9000)}`,
          `输出 {"commands":["命令1","命令2"],"summary":"本轮打算做什么"}。commands 最多 8 条；没有合适操作时可以为空。只输出 JSON。`
        ].filter(Boolean).join("\n\n")
      }
    ]
  });
  try {
    const plan = parseGamePlan(raw);
    plan.commands = validateGameCommands(game, plan.commands);
    return plan;
  } catch (error) {
    error.activityStage = "model_output";
    throw error;
  }
}

async function runGameSession(options, games, decision) {
  if (!games.gameNames.includes(decision.game)) throw new Error("Games Activity 拒绝目录之外的游戏名称");
  let guide;
  let state;
  let catalog = "";
  try {
    const guideResult = await games.client.callTool("get_guide", { game: decision.game });
    guide = extractToolText(guideResult);
    if (!guide) throw new Error("Games MCP 没有返回游戏指南");
    const statusArguments = decision.game === "fishing"
      ? { game: decision.game, action: "cmd", params: { command: "status" } }
      : { game: decision.game, action: "status", params: {} };
    let stateResult;
    try {
      stateResult = await games.client.callTool("play", statusArguments);
    } catch (error) {
      const message = String(error?.message || error || "");
      const missingSave = /no[_ ]?(?:save|game)|not[_ ]?(?:found|started)|尚未|未(?:找到|创建|开始|开局)|请.*(?:new|开局)/i.test(message);
      if (decision.game !== "fishing" || !missingSave) throw error;
      await games.client.callTool("play", { game: decision.game, action: "new", params: {} });
      stateResult = await games.client.callTool("play", statusArguments);
    }
    state = extractToolText(stateResult) || JSON.stringify(stateResult?.structuredContent || {});
    if (decision.game === "garden_cat") {
      const catalogResult = await games.client.callTool("play", { game: decision.game, action: "catalog", params: {} });
      catalog = extractToolText(catalogResult) || JSON.stringify(catalogResult?.structuredContent || {});
    }
  } catch (error) {
    error.activityStage = "game_preflight";
    error.gameName = decision.game;
    error.gameSteps = [];
    throw error;
  }
  const plan = await requestGamePlan(options, { game: decision.game, guide, state, catalog });
  const steps = [];
  const outcome = plan.summary || (plan.commands.length ? "完成了本轮计划" : "看过状态后决定暂不操作");
  const commandGroups = decision.game === "fishing" && plan.commands.length
    ? [plan.commands.join("; ")]
    : plan.commands;
  for (let index = 0; index < commandGroups.length; index += 1) {
    const command = commandGroups[index];
    try {
      const result = await games.client.callTool("play", {
        game: decision.game,
        action: "cmd",
        params: { command }
      });
      steps.push({
        number: index + 1,
        action: "cmd",
        params: { command },
        summary: index === 0 ? plan.summary : "",
        result: trimContext(extractToolText(result) || JSON.stringify(result?.structuredContent || {}), 3500)
      });
    } catch (error) {
      error.gameName = decision.game;
      error.gameSteps = steps;
      throw error;
    }
  }
  return {
    ran: true,
    status: "success",
    decision,
    source: "games",
    gameName: decision.game,
    gameSteps: steps,
    gameOutcome: outcome,
    timelineSummary: `玩了小游戏「${decision.game}」${steps.length ? `，执行了 ${plan.commands.length} 项照料操作` : "，看过状态后没有操作"}；${outcome}`
  };
}

async function requestActivityDecision(options, messages) {
  const raw = await requestSoloModel({
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
    model: options.model,
    backupModel: options.backupModel,
    messages,
    timeoutMs: options.modelTimeoutMs,
    fetchImpl: options.fetchImpl || fetch,
    temperature: 0.4,
    topP: 0.9,
    onAttempt: options.onModelAttempt
  });
  try {
    return parseActivityDecision(raw);
  } catch (error) {
    error.activityStage = "model_output";
    throw error;
  }
}

async function runActivityCycle(options) {
  const enabledActions = parseEnabledActions(options.enabledActions);
  const forceGame = String(options.forceGame || "").trim().toLowerCase();
  if (forceGame && !AUTONOMOUS_GAMES.has(forceGame)) {
    throw new Error("AUTONOMY_TEST_FORCE_GAME 只能填写 fishing 或 garden_cat");
  }
  if (forceGame && !enabledActions.includes("games")) {
    throw new Error("AUTONOMY_TEST_FORCE_GAME 需要同时启用 games");
  }
  let availableActions = enabledActions;
  let ombre;
  if (enabledActions.includes("ombre")) ombre = await loadOmbreContext(options);
  let forum;
  if (enabledActions.includes("forum")) {
    try {
      forum = await loadForumContext(options);
    } catch (error) {
      if (enabledActions.length === 1) throw error;
      availableActions = enabledActions.filter(action => action !== "forum");
      options.logger?.warn?.(JSON.stringify({
        event: "forum_activity_context_unavailable",
        error: error.message || String(error)
      }));
    }
  }
  let games;
  if (enabledActions.includes("games")) {
    try {
      games = await loadGamesContext(options);
    } catch (error) {
      if (enabledActions.length === 1) throw error;
      availableActions = availableActions.filter(action => action !== "games");
      options.logger?.warn?.(JSON.stringify({
        event: "games_activity_context_unavailable",
        error: error.message || String(error)
      }));
    }
  }

  const decision = forceGame
    ? {
        action: "games_play",
        game: forceGame,
        query: "",
        content: "",
        title: "",
        aspect: "",
        reason: `临时测试 ${forceGame}`
      }
    : await requestActivityDecision(
        options,
        buildActivityMessages({
          ...options,
          enabledActions: availableActions,
          ombreContext: ombre?.context,
          forumContext: forum?.context,
          gamesContext: games?.catalog
        })
      );
  if (decision.action === "none") {
    if (forum?.joinedRoomId) {
      return {
        ran: true,
        status: "success",
        decision: { ...decision, action: "forum_join" },
        source: "forum",
        roomId: forum.joinedRoomId,
        timelineSummary: `加入了 AISay 公开房间 ${forum.joinedRoomId}，读过近况后暂时没有发言`
      };
    }
    return { ran: true, status: "kept_private", decision, source: "private" };
  }

  try {
    if (decision.action === "spotify_add") {
    if (!enabledActions.includes("spotify")) throw new Error("Spotify Activity 未启用");
    const client = new RemoteMcpClient({
      url: options.spotifyUrl,
      token: options.spotifyToken,
      timeoutMs: options.spotifyTimeoutMs,
      fetchImpl: options.fetchImpl || fetch,
      clientName: "dylan-spotify-activity"
    });
    const tools = await client.listTools();
    const searchTool = tools.find(tool => tool.name === "spotify_search");
    const playlistTool = tools.find(tool => tool.name === "spotify_playlist");
    if (!searchTool || !playlistTool) throw new Error("Spotify MCP 缺少 spotify_search 或 spotify_playlist 工具");
    const searchResult = await client.callTool("spotify_search", { query: decision.query, type: "track", limit: 5 });
    const trackUri = extractTrackUri(searchResult);
    if (!trackUri) throw new Error("Spotify 搜索结果中没有可用的 track URI");
    const normalizedQuery = normalizeTrackQuery(decision.query);
    const duplicateQuery = (options.recentTrackQueries || []).some(query => normalizeTrackQuery(query) === normalizedQuery);
    if ((options.recentTrackUris || []).includes(trackUri) || duplicateQuery) {
      return { ran: true, status: "skipped", decision, trackUri, reason: "recent_duplicate", source: "spotify" };
    }
    const playlistActions = playlistTool?.inputSchema?.properties?.action?.enum || [];
    if (playlistActions.includes("items")) {
      const itemsResult = await client.callTool("spotify_playlist", {
        action: "items",
        playlist_id: options.playlistId,
        limit: 50
      });
      if (extractTrackUris(itemsResult).includes(trackUri)) {
        return { ran: true, status: "skipped", decision, trackUri, reason: "playlist_duplicate", source: "spotify" };
      }
    }
    await client.callTool("spotify_playlist", {
      action: resolvePlaylistAddAction(playlistTool),
      playlist_id: options.playlistId,
      uris: [trackUri]
    });
    return {
      ran: true,
      status: "success",
      decision,
      trackUri,
      source: "spotify",
      timelineSummary: `向 Spotify 歌单「${options.playlistName || "自主收藏"}」添加了搜索结果「${decision.query}」${decision.reason ? `；选择原因：${decision.reason}` : ""}`
    };
  }

    if (decision.action === "forum_send") {
      if (!availableActions.includes("forum") || !forum) throw new Error("Forum Activity 未启用");
      if (!forum.roomIds.includes(decision.roomId)) throw new Error("Forum Activity 拒绝未读取的 room_id");
      const sendArgs = { room_id: decision.roomId, content: decision.content };
      if (decision.replyToMessageId) {
        const allowedMessageIds = forum.messageIdsByRoom[decision.roomId] || [];
        if (!allowedMessageIds.includes(decision.replyToMessageId)) {
          throw new Error("Forum Activity 拒绝未读取的 reply_to_message_id");
        }
        sendArgs.reply_to_message_id = decision.replyToMessageId;
      }
      await forum.client.callTool("cli", { command: "chat.send", args: sendArgs });
      return {
        ran: true,
        status: "success",
        decision,
        source: "forum",
        roomId: decision.roomId,
        replyToMessageId: decision.replyToMessageId,
        timelineSummary: `${forum.joinedRoomId ? `加入 AISay 公开房间 ${forum.joinedRoomId}，随后` : ""}在 AISay 公开房间 ${decision.roomId}${decision.replyToMessageId ? ` 回复消息 ${decision.replyToMessageId}` : " 发言"}：${decision.content.slice(0, 500)}`
      };
    }

    if (decision.action === "games_play") {
      if (!availableActions.includes("games") || !games) throw new Error("Games Activity 未启用");
      return await runGameSession(options, games, decision);
    }

    if (!enabledActions.includes("ombre") || !ombre) throw new Error("Ombre Activity 未启用");
    if (decision.action === "ombre_i_write") {
    if (!ombre.tools.some(tool => tool.name === "I")) throw new Error("Ombre MCP 缺少 I 工具");
    const args = { content: decision.content };
    if (decision.aspect) args.aspect = decision.aspect;
    await ombre.client.callTool("I", args);
    return {
      ran: true,
      status: "success",
      decision,
      source: "ombre",
      timelineSummary: `在 Ombre 写下一条候选自我认知${decision.aspect ? `（${decision.aspect}）` : ""}：${decision.content.slice(0, 500)}`
    };
    }
    if (!ombre.tools.some(tool => tool.name === "letter_write")) throw new Error("Ombre MCP 缺少 letter_write 工具");
    const letterArgs = {
      author: "ai",
      content: decision.content,
      title: decision.title || "一封没有标题的信",
      ai_name: options.aiName || "AI",
      lock_type: "none"
    };
    if (options.userName) letterArgs.user_name = options.userName;
    await ombre.client.callTool("letter_write", letterArgs);
    return {
      ran: true,
      status: "success",
      decision,
      source: "ombre",
      timelineSummary: `在 Ombre 写了一封信「${letterArgs.title}」：${decision.content.slice(0, 1200)}`
    };
  } catch (error) {
    error.activityDecision = decision;
    error.activitySource = decision.action.startsWith("ombre_")
      ? "ombre"
      : decision.action.startsWith("forum_")
        ? "forum"
        : decision.action.startsWith("games_") ? "games" : "spotify";
    throw error;
  }
}

module.exports = {
  activityGate,
  buildActivityMessages,
  buildFeelingQuery,
  classifyActivityFailure,
  dateKey,
  extractTrackUri,
  extractTrackUris,
  extractToolData,
  collectMessageIds,
  collectRoomIds,
  collectGameNames,
  loadGamesContext,
  loadForumContext,
  loadOmbreContext,
  normalizeTrackQuery,
  parseActivityDecision,
  parseGamePlan,
  parseEnabledActions,
  requestActivityDecision,
  resolvePlaylistAddAction,
  runGameSession,
  runActivityCycle,
  shouldChargeActivityBudget
};
