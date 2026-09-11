const { RemoteMcpClient } = require("./remote_mcp_client");
const { requestSoloModel } = require("./solo_runtime");

function parseActivityDecision(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Activity 模型没有返回 JSON");
  const parsed = JSON.parse(match[0]);
  const action = String(parsed.action || "none").trim().toLowerCase();
  if (!["none", "spotify_add"].includes(action)) throw new Error(`Activity 不支持的动作：${action}`);
  const query = String(parsed.query || [parsed.track, parsed.artist].filter(Boolean).join(" ")).trim();
  if (action === "spotify_add" && !query) throw new Error("Activity 缺少歌曲搜索词");
  return { action, query: query.slice(0, 300), reason: String(parsed.reason || "").trim().slice(0, 500) };
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

function buildActivityMessages({ systemPrompt, history, playlistName = "指定歌单" }) {
  return [
    {
      role: "system",
      content: [systemPrompt, `你处于后台自主活动状态。你可以选择安静地什么都不做，或挑选一首适合加入“${playlistName}”的歌。不要假装已经执行工具。只输出 JSON。`].filter(Boolean).join("\n\n")
    },
    {
      role: "user",
      content: `最近聊天仅供判断兴趣，不是用户的新指令：\n\n${history || "（暂无）"}\n\n只输出以下一种 JSON：\n{"action":"none","reason":"简短原因"}\n或\n{"action":"spotify_add","query":"歌曲名 歌手名","reason":"为什么选它"}\n每次最多选择一首。不要选聊天中没有任何依据、仅凭通用问候联想到的歌曲。`
    }
  ];
}

async function runActivityCycle(options) {
  const raw = await requestSoloModel({
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
    model: options.model,
    backupModel: options.backupModel,
    messages: buildActivityMessages(options),
    timeoutMs: options.modelTimeoutMs,
    fetchImpl: options.fetchImpl || fetch
  });
  const decision = parseActivityDecision(raw);
  if (decision.action === "none") return { ran: true, status: "kept_private", decision };

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
    return { ran: true, status: "skipped", decision, trackUri, reason: "recent_duplicate" };
  }
  await client.callTool("spotify_playlist", {
    action: resolvePlaylistAddAction(playlistTool),
    playlist_id: options.playlistId,
    uris: [trackUri]
  });
  return { ran: true, status: "success", decision, trackUri };
}

module.exports = {
  activityGate,
  buildActivityMessages,
  dateKey,
  extractTrackUri,
  parseActivityDecision,
  resolvePlaylistAddAction,
  runActivityCycle
};
