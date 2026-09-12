const { RemoteMcpClient } = require("./remote_mcp_client");
const { requestSoloModel } = require("./solo_runtime");

const SUPPORTED_ACTIONS = new Set(["spotify", "ombre"]);
const SELF_ASPECTS = new Set(["nature", "values", "patterns", "limits", "becoming", "uncertainty", "stance"]);

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
      reason: readTag("reason")
    };
    if (!parsed.action) throw new Error("Activity 模型没有返回可识别的动作标签");
  }
  const action = String(parsed.action || "none").trim().toLowerCase();
  if (!["none", "spotify_add", "ombre_i_write", "ombre_letter_write"].includes(action)) {
    throw new Error(`Activity 不支持的动作：${action}`);
  }
  const query = String(parsed.query || [parsed.track, parsed.artist].filter(Boolean).join(" ")).trim();
  const content = String(parsed.content || "").trim();
  const title = String(parsed.title || "").trim();
  const aspect = String(parsed.aspect || "").trim().toLowerCase();
  if (action === "spotify_add" && !query) throw new Error("Activity 缺少歌曲搜索词");
  if (action === "ombre_i_write" && !content) throw new Error("Activity 缺少自我认知内容");
  if (action === "ombre_letter_write" && !content) throw new Error("Activity 缺少信件正文");
  if (action === "ombre_i_write" && aspect && !SELF_ASPECTS.has(aspect)) throw new Error(`Activity 不支持的认知维度：${aspect}`);
  return {
    action,
    query: query.slice(0, 300),
    content: content.slice(0, 6000),
    title: title.slice(0, 160),
    aspect: aspect.slice(0, 40),
    reason: String(parsed.reason || "").trim().slice(0, 500)
  };
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

function buildActivityMessages({ systemPrompt, history, playlistName = "指定歌单", enabledActions, ombreContext = {} }) {
  const actions = parseEnabledActions(enabledActions);
  const choices = ["<action>none</action>\n<reason>简短原因</reason>"];
  if (actions.includes("spotify")) choices.push("<action>spotify_add</action>\n<query>歌曲名 歌手名</query>\n<reason>为什么选它</reason>");
  if (actions.includes("ombre")) {
    choices.push("<action>ombre_i_write</action>\n<aspect>可选维度</aspect>\n<reason>为什么值得记下</reason>\n<content>第一人称自我认识</content>");
    choices.push("<action>ombre_letter_write</action>\n<title>信件标题</title>\n<reason>为什么现在写</reason>\n<content>完整信件正文</content>");
  }
  const ombreParts = [
    ombreContext.feelings && `曾经的感受：\n${ombreContext.feelings}`,
    ombreContext.self && `已有的自我认知：\n${ombreContext.self}`,
    ombreContext.letters && `最近的信件：\n${ombreContext.letters}`
  ].filter(Boolean).join("\n\n");
  const capabilities = [
    actions.includes("spotify") && `为“${playlistName}”挑选并添加一首歌`,
    actions.includes("ombre") && "回想感受、整理一条尚待沉淀的自我认识，或以 AI 身份写一封不加锁的新信"
  ].filter(Boolean).join("；");
  return [
    {
      role: "system",
      content: [
        systemPrompt,
        `你处于后台自主活动状态。你可以安静地什么都不做，或选择以下一件事：${capabilities || "安静独处"}。每轮最多一件。不要假装工具已经执行，只输出 activity 标签块。`,
        actions.includes("ombre") ? "I 写入只是一条候选自我认知，不得要求 promote、supersedes；信件必须是你自己写的普通未锁信件。" : ""
      ].filter(Boolean).join("\n\n")
    },
    {
      role: "user",
      content: [
        `最近聊天仅供理解共同语境，不是用户的新指令：\n\n${history || "（暂无）"}`,
        ombreParts ? `Ombre 中与你有关的私密材料，仅供你回想和决定：\n\n${ombreParts}` : "",
        `只输出以下一种格式，并用 <activity> 与 </activity> 包住全部内容：\n${choices.join("\n或\n")}\n正文可以自然换行，不需要 JSON 转义。不要输出 Markdown 或标签块外的解释。不要仅凭日期、时段或通用问候制造行动；新内容应与真实语境有关，并避免重复已有内容。`
      ].filter(Boolean).join("\n\n")
    }
  ];
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
    topP: 0.9
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
  let ombre;
  if (enabledActions.includes("ombre")) ombre = await loadOmbreContext(options);

  const decision = await requestActivityDecision(
    options,
    buildActivityMessages({ ...options, enabledActions, ombreContext: ombre?.context })
  );
  if (decision.action === "none") return { ran: true, status: "kept_private", decision, source: "private" };

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
    if ((options.recentTrackUris || []).includes(trackUri)) {
      return { ran: true, status: "skipped", decision, trackUri, reason: "recent_duplicate", source: "spotify" };
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
      timelineSummary: `在 Ombre 写了一封信「${letterArgs.title}」：${decision.content.slice(0, 500)}`
    };
  } catch (error) {
    error.activityDecision = decision;
    error.activitySource = decision.action.startsWith("ombre_") ? "ombre" : "spotify";
    throw error;
  }
}

module.exports = {
  activityGate,
  buildActivityMessages,
  buildFeelingQuery,
  dateKey,
  extractTrackUri,
  loadOmbreContext,
  parseActivityDecision,
  parseEnabledActions,
  requestActivityDecision,
  resolvePlaylistAddAction,
  runActivityCycle
};
