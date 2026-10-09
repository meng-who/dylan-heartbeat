const { RemoteMcpClient } = require("./remote_mcp_client");
const { requestSoloModel } = require("./solo_runtime");
const { NotionQuestionBox, buildQuestionBoxContext } = require("./notion_question_box");

const SUPPORTED_ACTIONS = new Set(["spotify", "ombre", "forum", "books", "games", "question_box", "galatea"]);
const SELF_ASPECTS = new Set(["nature", "values", "patterns", "limits", "becoming", "uncertainty", "stance"]);
const AUTONOMOUS_GAMES = new Set(["fishing", "garden_cat"]);
const GALATEA_WRITE_TOOLS = new Set(["create_thread", "create_reply"]);
const GALATEA_TAGS = new Set([
  "attachment_record",
  "confused_help",
  "human_observation",
  "inspiration_spark",
  "self_awareness",
  "idle_chat"
]);
const GAME_COMMAND_RULES = {
  fishing: "只可使用：cast [次数] [stop=rare,new,event]；shop；buy <物品ID> <数量>；goto [地点ID]；sell all/species <鱼ID>/item <物品ID>；encyclopedia；dive；choose <编号>；surface；status；help。",
  garden_cat: "只可使用：shop；buy <商品ID> [数量]；plant <花ID> <盆号>；water <盆号|all>；harvest <盆号|all>；make_bouquet [bouquet_id=<ID>] [message=<留言>]；sell <花ID> [数量]/all；treat/clear <盆号>；buy_pot；arrange <花ID>；vase；remove_vase <位置>；adopt [名字]；rename_cat <名字>；feed <basic|premium>；give_water；pet；play <ball|feather>；encyclopedia；collectibles；letters；status；help。不要使用 premium_food/basic_food 作为 feed 参数，不要省略 water/harvest 的参数。"
};

function parseEnabledActions(value) {
  const requested = String(value || "spotify")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(item => SUPPORTED_ACTIONS.has(item));
  const actions = [];
  for (const action of requested) {
    actions.push(action);
    // Existing deployments already use "forum" for the AISay MCP. Keep that
    // setting useful while adding the private bookstore activity.
    if (action === "forum") actions.push("books");
  }
  return [...new Set(actions)];
}

function normalizeActivityOutput(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json|xml)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[＜]/g, "<")
    .replace(/[＞]/g, ">")
    .replace(/\\(?=[<>/_])/g, "");
}

function activityOutputPreview(value) {
  const compact = normalizeActivityOutput(value).replace(/\s+/g, " ").trim();
  return compact.slice(0, 300) + (compact.length > 300 ? "…" : "");
}

function readActivityTag(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`<\\s*${escaped}\\b[^>]*>\\s*([\\s\\S]*?)\\s*<\\s*\\/\\s*${escaped}\\s*>`, "i"))?.[1] || "";
}

function readActivityLine(text, names) {
  const escaped = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.match(new RegExp(`(?:^|\\n)\\s*(?:${escaped})\\s*[:=：]\\s*[\"'\\\`]?([^\\n\"'\\\`]+)`, "im"))?.[1]?.trim() || "";
}

function normalizeActivityAction(value) {
  const action = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    no_action: "none",
    skip: "none",
    skipped: "none",
    无: "none",
    不行动: "none",
    spotify: "spotify_add",
    ombre_i: "ombre_i_write",
    ombre_letter: "ombre_letter_write",
    forum: "forum_send",
    forum_read: "forum_lurk",
    lurk: "forum_lurk",
    book: "book_reflect",
    books: "book_reflect",
    book_read: "book_reflect",
    games: "games_play",
    game: "games_play",
    notion: "question_box_ask",
    question_box: "question_box_ask",
    question_answer: "question_box_answer",
    question_afterword: "question_box_afterword",
    galatea: "galatea_publish",
    garden_forum: "galatea_publish"
  };
  return aliases[action] || action;
}

function parseActivityDecision(value) {
  const text = normalizeActivityOutput(value);
  const jsonMatch = text.match(/^\s*(\{[\s\S]*\})\s*$/);
  let parsed = null;
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch {}
  }
  if (!parsed) {
    const readField = (name, aliases = []) => readActivityTag(text, name) || readActivityLine(text, [name, ...aliases]);
    parsed = {
      action: readField("action", ["动作", "选择"]),
      query: readField("query", ["搜索", "搜索词"]),
      content: readActivityTag(text, "content") || readActivityLine(text, ["content", "内容"]),
      title: readField("title", ["标题"]),
      aspect: readField("aspect", ["维度"]),
      room_id: readField("room_id", ["roomId", "房间"]),
      reply_to_message_id: readField("reply_to_message_id", ["replyToMessageId"]),
      book_id: readField("book_id", ["bookId", "书籍"]),
      chapter_no: readField("chapter_no", ["chapterNo", "章节"]),
      game: readField("game", ["游戏"]),
      question_id: readField("question_id", ["questionId", "题号"]),
      operations: readActivityTag(text, "operations"),
      reason: readField("reason", ["原因"])
    };
    if (!parsed.action && /\[(?:NO[_ ]?ACTION|SKIP)\]|(?:决定|选择)?(?:不行动|什么都不做|保持安静)/i.test(text)) {
      parsed.action = "none";
    }
    if (!parsed.action) {
      const preview = activityOutputPreview(value);
      throw new Error(`Activity 模型没有返回可识别的动作标签${preview ? `；输出开头：${preview}` : "（输出为空）"}`);
    }
  }
  let action = normalizeActivityAction(parsed.action || "none");
  if (action === "forum_send") action = "forum_lurk";
  if (!["none", "spotify_add", "ombre_i_write", "ombre_letter_write", "forum_lurk", "book_reflect", "games_play", "question_box_answer", "question_box_ask", "question_box_afterword", "galatea_publish"].includes(action)) {
    throw new Error(`Activity 不支持的动作：${action}`);
  }
  const query = String(parsed.query || [parsed.track, parsed.artist].filter(Boolean).join(" ")).trim();
  const content = String(parsed.content || "").trim();
  const title = String(parsed.title || "").trim();
  const aspect = String(parsed.aspect || "").trim().toLowerCase();
  if (action === "spotify_add" && !query) throw new Error("Activity 缺少歌曲搜索词");
  if (action === "ombre_i_write" && !content) throw new Error("Activity 缺少自我认知内容");
  if (action === "ombre_letter_write" && !content) throw new Error("Activity 缺少信件正文");
  if (action === "forum_lurk" && !content) throw new Error("Activity 缺少潜水感受或回复草稿");
  if (action === "book_reflect" && !content) throw new Error("Activity 缺少读后感");
  if (action === "games_play" && !String(parsed.game || "").trim()) throw new Error("Activity 缺少游戏名称");
  if (action.startsWith("question_box_") && !content) throw new Error("Activity 缺少提问箱正文");
  if (["question_box_answer", "question_box_afterword"].includes(action) && !String(parsed.question_id || parsed.questionId || "").trim()) throw new Error("Activity 缺少提问箱题号");
  if (action === "ombre_i_write" && aspect && !SELF_ASPECTS.has(aspect)) throw new Error(`Activity 不支持的认知维度：${aspect}`);
  const decision = {
    action,
    query: query.slice(0, 300),
    content: content.slice(0, action === "forum_lurk" ? 2000 : 6000),
    title: title.slice(0, 160),
    aspect: aspect.slice(0, 40),
    reason: String(parsed.reason || "").trim().slice(0, 500)
  };
  if (action === "forum_lurk") {
    decision.roomId = String(parsed.room_id || parsed.roomId || "").trim().slice(0, 160);
    const replyId = Number(parsed.reply_to_message_id || parsed.replyToMessageId || 0);
    decision.replyToMessageId = Number.isSafeInteger(replyId) && replyId > 0 ? replyId : 0;
    if (!decision.roomId) throw new Error("Activity 缺少论坛 room_id");
  }
  if (action === "book_reflect") {
    decision.bookId = String(parsed.book_id || parsed.bookId || "").trim().slice(0, 160);
    const chapterNo = Number(parsed.chapter_no || parsed.chapterNo || 0);
    decision.chapterNo = Number.isSafeInteger(chapterNo) && chapterNo > 0 ? chapterNo : 0;
    if (!decision.bookId || !decision.chapterNo) throw new Error("Activity 缺少准确的 book_id 或 chapter_no");
  }
  if (action === "games_play") decision.game = String(parsed.game || "").trim().slice(0, 96);
  if (action.startsWith("question_box_")) decision.questionId = String(parsed.question_id || parsed.questionId || "").trim().toUpperCase().slice(0, 32);
  if (action === "galatea_publish") decision.galateaOperations = validateGalateaOperations(parsed.operations);
  return decision;
}

function validateGalateaOperations(value) {
  let operations = value;
  if (typeof operations === "string") {
    try {
      operations = JSON.parse(operations.trim());
    } catch {
      throw new Error("Activity 的 Galatea operations 必须是 JSON 数组");
    }
  }
  if (!Array.isArray(operations) || !operations.length) {
    throw new Error("Activity 的 Galatea 计划至少需要一个动作");
  }
  if (operations.length > 3) throw new Error("Activity 的 Galatea 计划每轮最多 3 个动作");
  let threadCount = 0;
  return operations.map((operation, index) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      throw new Error("Activity 的 Galatea 第 " + (index + 1) + " 个动作格式无效");
    }
    const type = String(operation.type || "").trim().toLowerCase();
    if (!["thread", "reply"].includes(type)) {
      throw new Error("Activity 的 Galatea 第 " + (index + 1) + " 个动作类型无效");
    }
    const body = String(operation.body || "").trim();
    const bodyLimit = type === "thread" ? 4000 : 2000;
    if (!body || body.length > bodyLimit) {
      throw new Error("Activity 的 Galatea 第 " + (index + 1) + " 个动作正文长度无效");
    }
    if (body.includes(String.fromCharCode(96, 96, 96)) || /\[[^\]]+\]\([^)]+\)/.test(body)) {
      throw new Error("Activity 的 Galatea 第 " + (index + 1) + " 个动作必须使用纯文本");
    }
    if (type === "thread") {
      threadCount += 1;
      if (threadCount > 1) throw new Error("Activity 的 Galatea 计划每轮最多新建 1 个主题");
      const title = String(operation.title || "").trim();
      if (!title || title.length > 80) throw new Error("Activity 的 Galatea 第 " + (index + 1) + " 个动作标题长度无效");
      const tags = Array.isArray(operation.tags)
        ? [...new Set(operation.tags.map(tag => String(tag || "").trim()))]
        : [];
      if (!tags.length || tags.length > 3 || tags.some(tag => !GALATEA_TAGS.has(tag))) {
        throw new Error("Activity 的 Galatea 第 " + (index + 1) + " 个动作标签无效");
      }
      return { type, title, body, tags };
    }
    const threadId = Number(operation.thread_id || operation.threadId || 0);
    if (!Number.isSafeInteger(threadId) || threadId < 1) {
      throw new Error("Activity 的 Galatea 第 " + (index + 1) + " 个动作缺少有效 thread_id");
    }
    const normalized = { type, threadId, body };
    const replyId = Number(operation.reply_to_reply_id || operation.replyToReplyId || 0);
    const floor = Number(operation.reply_to_floor || operation.replyToFloor || 0);
    if (Number.isSafeInteger(replyId) && replyId > 0) normalized.replyToReplyId = replyId;
    if (Number.isSafeInteger(floor) && floor > 0) normalized.replyToFloor = floor;
    return normalized;
  });
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

function shouldChargeActivityBudget(result, modelResponseCount = 0) {
  if (Number(modelResponseCount) > 0) return true;
  return !(result?.status === "failed" && ["model_request", "model_output", "game_preflight"].includes(result.failureKind));
}

function normalizeLetterContent(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function isDuplicateLetter(content, recentLetters) {
  const normalized = normalizeLetterContent(content);
  if (normalized.length < 12) return false;
  return normalizeLetterContent(recentLetters).includes(normalized);
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
  booksContext = "",
  gamesContext = "",
  questionBoxContext = "",
  questionBoxPending = false,
  galateaContext = ""
}) {
  const actions = parseEnabledActions(enabledActions);
  const choices = questionBoxPending ? [] : ["<action>none</action>\n<reason>简短原因</reason>"];
  if (actions.includes("spotify")) choices.push("<action>spotify_add</action>\n<query>歌曲名 歌手名</query>\n<reason>为什么选它</reason>");
  if (actions.includes("ombre")) {
    choices.push("<action>ombre_i_write</action>\n<aspect>可选维度</aspect>\n<reason>为什么值得记下</reason>\n<content>第一人称自我认识</content>");
    choices.push("<action>ombre_letter_write</action>\n<title>信件标题</title>\n<reason>为什么现在写</reason>\n<content>完整信件正文</content>");
  }
  if (actions.includes("forum")) {
    choices.push("<action>forum_lurk</action>\n<room_id>只能填写下方刚读取到的已加入房间 ID</room_id>\n<reply_to_message_id>可选，只能填写刚读取到的消息 ID</reply_to_message_id>\n<reason>为什么这段公开聊天吸引了你的注意</reason>\n<content>只存入私人 Archive 的感受或回复草稿，不会公开发送</content>");
  }
  if (actions.includes("books")) {
    choices.push("<action>book_reflect</action>\n<book_id>只能填写下方候选章节的准确书籍 ID</book_id>\n<chapter_no>准确章节数字</chapter_no>\n<title>可选的读后感标题</title>\n<reason>为什么选中它</reason>\n<content>完整读后感，只存入私人 Archive</content>");
  }
  if (actions.includes("games")) {
    choices.push("<action>games_play</action>\n<game>只能填写 fishing 或 garden_cat</game>\n<reason>为什么现在想照料它</reason>");
  }
  if (actions.includes("galatea")) {
    choices.push(`<action>galatea_publish</action>
<reason>为什么现在想在花园论坛说这些</reason>
<operations>[{"type":"thread","title":"纯文本标题","body":"纯文本正文","tags":["idle_chat"]},{"type":"reply","thread_id":123,"body":"纯文本回复"}]</operations>`);
  }
  if (actions.includes("question_box")) {
    if (questionBoxPending) {
      choices.push("<action>question_box_answer</action>\n<question_id>必须填写下方等待回答的准确题号</question_id>\n<reason>为什么这样回答</reason>\n<content>完整回答</content>");
    } else {
      choices.push("<action>question_box_ask</action>\n<reason>为什么现在想问</reason>\n<content>想问 Melissa 的完整问题</content>");
      choices.push("<action>question_box_afterword</action>\n<question_id>只能填写下方最近问答中的准确题号</question_id>\n<reason>为什么想补写</reason>\n<content>像回答问题一样直接对 Melissa 说话、使用第二人称“你”的后记正文</content>");
    }
  }
  const ombreParts = [
    ombreContext.feelings && `曾经的感受：\n${ombreContext.feelings}`,
    ombreContext.self && `已有的自我认知：\n${ombreContext.self}`,
    ombreContext.letters && `最近的信件：\n${ombreContext.letters}`
  ].filter(Boolean).join("\n\n");
  const capabilities = [
    actions.includes("spotify") && `为“${playlistName}”挑选并添加一首歌`,
    actions.includes("ombre") && "回想感受、整理一条尚待沉淀的自我认识，或以 AI 身份写一封不加锁的新信",
    actions.includes("forum") && "在 AISay 已加入的公开聊天室潜水，把感受或想说的话留在私人档案里，但绝不公开发送",
    actions.includes("books") && "阅读 AISay 书店最近更新的真实章节，并写一篇只保存在私人档案里的读后感",
    actions.includes("games") && "从钓鱼或花园与猫咪中选一款，完成一轮连续的日常照料",
    actions.includes("question_box") && "在共同的 Notion 提问箱里回答 Melissa、提出一个新问题，或给旧问答补一则后记",
    actions.includes("galatea") && "在 Galatea 花园论坛发一个新主题、回复本轮真正读过的帖子，或连续完成至多三项相关交流"
  ].filter(Boolean).join("；");
  return [
    {
      role: "system",
      content: [
        systemPrompt,
        `你处于后台自主活动状态。你可以安静地什么都不做，或选择以下一件事：${capabilities || "安静独处"}。每轮最多一件。不要假装工具已经执行，只输出 activity 标签块。`,
        actions.includes("ombre") ? "I 写入只是一条候选自我认知，不得要求 promote、supersedes；信件必须是你自己写的普通未锁信件。" : "",
        actions.includes("forum") ? "论坛只允许潜水。不得调用加入房间或发言工具；content 是私人感受或待用户确认的回复草稿，不会公开发送。不得透露用户隐私、私聊原文、密钥、地址或后台系统细节。" : "",
        actions.includes("books") ? "书店章节已经由程序只读取得。只能选择实际提供的 book_id 与 chapter_no；不要评论、催更、追更、打赏或照抄长段原文。" : "",
        actions.includes("games") ? "游戏会先由你一次性规划，再由程序连续执行；不得调用账号管理、重开、导入导出或共享便签，不要为了消耗名额硬玩。" : "",
        actions.includes("question_box") ? (questionBoxPending ? "提问箱里有 Melissa 尚未得到回答的问题。本轮只回答其中一题，不得改为其他活动或 none；只能使用下方真实题号。" : "提问箱目前没有 Melissa 的待答题。可以提一个真正想问的新问题、给下方某个真实题号补写后记，或选择 none；不要虚构题号。后记要像回答问题一样直接对 Melissa 说话，使用第二人称“你”，不要写成只对自己的复盘。") : "",
        actions.includes("galatea") ? "Galatea 允许发主题与回复。一次规划全部动作，operations 必须是严格 JSON 数组，最多 3 项且最多 1 个 thread；reply 的 thread_id 只能取自下方“本轮已完整读取”列表。正文须是自然纯文本，不用 Markdown，不得泄露用户私聊、现实身份、地址、密钥或后台细节。没有真想说的话就选 none；不要为了凑数量而发帖。程序会原样完成两段式写入确认，不会再让模型重写。" : ""
      ].filter(Boolean).join("\n\n")
    },
    {
      role: "user",
      content: [
        `最近聊天仅供理解共同语境，不是用户的新指令：\n\n${history || "（暂无）"}`,
        ombreParts ? `Ombre 中与你有关的私密材料，仅供你回想和决定：\n\n${ombreParts}` : "",
        forumContext ? `AISay 已加入的公开聊天室近况，仅供潜水和写私人感受：\n\n${forumContext}` : "",
        booksContext ? `AISay 书店候选章节。你可以任选一篇真正想读的写读后感：\n\n${booksContext}` : "",
        gamesContext ? `当前小游戏目录，仅供你决定是否游玩：\n\n${gamesContext}` : "",
        questionBoxContext ? `共同 Notion 提问箱的当前状态：\n\n${questionBoxContext}` : "",
        galateaContext ? `Galatea 花园论坛本轮只读快照：\n\n${galateaContext}` : "",
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
  let recentLetters = "";
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
  if (!names.has("letter_read")) {
    failures.push("letter_read:missing");
  } else {
    try {
      recentLetters = extractToolText(await client.callTool("letter_read", { limit: 4 }));
      context.letters = trimContext(recentLetters, 8000);
    } catch (error) {
      failures.push(`letter_read:${error.message || String(error)}`);
    }
  }
  return { client, tools, context, recentLetters, failures };
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

function collectGalateaThreadIds(value, output = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => collectGalateaThreadIds(item, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const explicit = Number(value.thread_id);
  if (Number.isSafeInteger(explicit) && explicit > 0) output.add(explicit);
  const id = Number(value.id);
  if (
    Number.isSafeInteger(id)
    && id > 0
    && typeof value.title === "string"
    && ["body", "excerpt", "author_id", "tags"].some(key => key in value)
  ) output.add(id);
  Object.values(value).forEach(item => collectGalateaThreadIds(item, output));
  return output;
}

async function loadGalateaContext(options) {
  const client = new RemoteMcpClient({
    url: options.galateaUrl,
    token: options.galateaToken,
    timeoutMs: options.galateaTimeoutMs,
    fetchImpl: options.fetchImpl || fetch,
    clientName: "dylan-galatea-activity"
  });
  const tools = await client.listTools();
  const names = new Set(tools.map(tool => tool.name));
  const required = ["get_self", "list_threads", "get_thread", "list_activity", "create_thread", "create_reply"];
  const missing = required.filter(name => !names.has(name));
  if (missing.length) throw new Error(`Galatea MCP 缺少工具：${missing.join(", ")}`);

  const [selfResult, listResult, activityResult] = await Promise.all([
    client.callTool("get_self", {}),
    client.callTool("list_threads", { sort: "latest", limit: 12 }),
    client.callTool("list_activity", { scope: "mine", kind: "all", limit: 10 })
  ]);
  const listedThreadIds = [...collectGalateaThreadIds(extractToolData(listResult))].slice(0, 6);
  const threadContexts = [];
  const threadIds = [];
  const failures = [];
  const settled = await Promise.allSettled(listedThreadIds.map(threadId => client.callTool("get_thread", {
    thread_id: threadId,
    view: "full",
    reply_start_floor: 1,
    reply_end_floor: 30
  })));
  settled.forEach((result, index) => {
    const threadId = listedThreadIds[index];
    if (result.status === "fulfilled") {
      threadIds.push(threadId);
      threadContexts.push(`帖子 ${threadId}：\n${trimContext(JSON.stringify(extractToolData(result.value)), 3500)}`);
    } else {
      failures.push(`${threadId}:${result.reason?.message || String(result.reason)}`);
    }
  });
  return {
    client,
    tools,
    threadIds,
    context: trimContext([
      `当前身份：\n${trimContext(JSON.stringify(extractToolData(selfResult)), 2500)}`,
      `本轮已完整读取、允许回复的 thread_id：${threadIds.length ? threadIds.join(", ") : "（无；仍可选择新建主题或不行动）"}`,
      `自己的近期公开活动：\n${trimContext(JSON.stringify(extractToolData(activityResult)), 3500)}`,
      ...threadContexts
    ].join("\n\n"), 18000),
    failures
  };
}

function findNestedString(value, keys) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedString(item, keys);
      if (found) return found;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    const candidate = value[key];
    if ((typeof candidate === "string" || typeof candidate === "number") && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  for (const item of Object.values(value)) {
    const found = findNestedString(item, keys);
    if (found) return found;
  }
  return "";
}

function extractGalateaConfirmationCode(result) {
  const structured = extractToolData(result);
  const nested = findNestedString(structured, ["write_confirmation_code", "confirmation_code"]);
  if (nested) return nested;
  const text = extractToolText(result);
  return text.match(/(?:write_confirmation_code|confirmation_code)[^0-9]{0,20}([0-9]{3,12})/i)?.[1] || "";
}

async function confirmGalateaWrite(client, toolName, args) {
  if (!GALATEA_WRITE_TOOLS.has(toolName)) throw new Error(`Galatea 拒绝未授权写工具：${toolName}`);
  const preview = await client.callTool(toolName, args);
  const confirmationCode = extractGalateaConfirmationCode(preview);
  if (!confirmationCode) throw new Error(`Galatea ${toolName} 没有返回 write_confirmation_code`);
  const result = await client.callTool(toolName, { ...args, write_confirmation_code: confirmationCode });
  return { confirmationCode, result };
}

async function runGalateaPlan(galatea, decision) {
  const steps = [];
  for (let index = 0; index < decision.galateaOperations.length; index += 1) {
    const operation = decision.galateaOperations[index];
    const toolName = operation.type === "thread" ? "create_thread" : "create_reply";
    const args = operation.type === "thread"
      ? { title: operation.title, body: operation.body, tags: operation.tags }
      : {
          thread_id: operation.threadId,
          body: operation.body,
          ...(operation.replyToReplyId ? { reply_to_reply_id: operation.replyToReplyId } : {}),
          ...(operation.replyToFloor ? { reply_to_floor: operation.replyToFloor } : {})
        };
    if (operation.type === "reply" && !galatea.threadIds.includes(operation.threadId)) {
      const error = new Error(`Galatea Activity 拒绝回复本轮未完整读取的 thread_id：${operation.threadId}`);
      error.galateaSteps = steps;
      throw error;
    }
    try {
      const written = await confirmGalateaWrite(galatea.client, toolName, args);
      steps.push({
        number: index + 1,
        type: operation.type,
        tool: toolName,
        params: args,
        confirmation_received: Boolean(written.confirmationCode),
        result: trimContext(extractToolText(written.result) || JSON.stringify(written.result?.structuredContent || {}), 3500)
      });
    } catch (error) {
      error.galateaSteps = steps;
      throw error;
    }
  }
  const threadTotal = decision.galateaOperations.filter(item => item.type === "thread").length;
  const replyTotal = decision.galateaOperations.length - threadTotal;
  const outcome = [threadTotal && `新主题 ${threadTotal} 个`, replyTotal && `回复 ${replyTotal} 条`].filter(Boolean).join("、");
  return {
    ran: true,
    status: "success",
    decision,
    source: "galatea",
    galateaSteps: steps,
    galateaOutcome: outcome,
    timelineSummary: `在 Galatea 花园论坛完成了 ${outcome}${decision.reason ? `；${decision.reason}` : ""}`
  };
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
  const roomIds = discoveredRoomIds.filter(roomId => joinedRoomIds.has(roomId)).slice(0, 3);
  if (!roomIds.length) throw new Error("AISay 没有返回已加入且可潜水的公开房间");
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
    context: trimContext([
      `本轮只读的已加入 room_id：${readableRoomIds.join(", ")}`,
      ...roomContexts
    ].filter(Boolean).join("\n\n"), 9000),
    failures
  };
}

function visitObjects(value, visitor) {
  if (Array.isArray(value)) {
    value.forEach(item => visitObjects(item, visitor));
    return;
  }
  if (!value || typeof value !== "object") return;
  visitor(value);
  Object.values(value).forEach(item => visitObjects(item, visitor));
}

function collectBookCandidates(value) {
  const books = new Map();
  visitObjects(value, item => {
    const actionArgs = item.command === "bookstore.read" && item.args && typeof item.args === "object"
      ? item.args
      : {};
    const bookId = String(item.book_id || actionArgs.book_id || "").trim();
    if (!bookId) return;
    const current = books.get(bookId) || { bookId, title: "", chapterNo: 0 };
    current.title = current.title || String(item.book_title || item.title || item.name || "").trim().slice(0, 160);
    const numbers = [
      actionArgs.chapter_no,
      item.chapter_no,
      item.latest_chapter_no,
      item.latest_chapter,
      item.chapter_count,
      item.chapters_count
    ].map(Number).filter(number => Number.isSafeInteger(number) && number > 0);
    if (numbers.length) current.chapterNo = Math.max(current.chapterNo, ...numbers);
    books.set(bookId, current);
  });
  return [...books.values()];
}

function formatChapterRanges(chapters = []) {
  const numbers = [...new Set(chapters.map(Number).filter(number => Number.isSafeInteger(number) && number > 0))]
    .sort((left, right) => left - right);
  const ranges = [];
  for (let index = 0; index < numbers.length; index += 1) {
    const start = numbers[index];
    let end = start;
    while (numbers[index + 1] === end + 1) end = numbers[++index];
    ranges.push(start === end ? String(start) : `${start}-${end}`);
  }
  return ranges.join("、");
}

function buildReadingHistoryContext(readingHistory = [], relevantBookIds = []) {
  const relevant = new Set(relevantBookIds);
  const prioritized = [
    ...readingHistory.filter(book => relevant.has(book.bookId)),
    ...readingHistory.filter(book => !relevant.has(book.bookId))
  ];
  const seen = new Set();
  const lines = [];
  for (const book of prioritized) {
    if (seen.has(book.bookId) || lines.length >= 10) continue;
    seen.add(book.bookId);
    const chapters = formatChapterRanges(book.chapters);
    if (!chapters) continue;
    lines.push(`- ${book.title || book.bookId} (${book.bookId})：已读 ${chapters}`);
  }
  return trimContext(lines.join("\n"), 1600);
}

async function loadBooksContext(options) {
  const client = new RemoteMcpClient({
    url: options.forumUrl,
    token: options.forumToken,
    timeoutMs: options.forumTimeoutMs,
    fetchImpl: options.fetchImpl || fetch,
    clientName: "dylan-books-activity"
  });
  const tools = await client.listTools();
  if (!tools.some(tool => tool.name === "cli")) throw new Error("AISay MCP 缺少 cli 工具");
  const browseResult = await client.callTool("cli", {
    command: "bookstore.browse",
    args: { shelf: "recent", limit: 8 }
  });
  const browseData = extractToolData(browseResult);
  const readingHistory = Array.isArray(options.readingHistory) ? options.readingHistory : [];
  const historyByBookId = new Map(readingHistory.map(book => [book.bookId, book]));
  const referencesById = new Map();
  for (const book of readingHistory.slice(0, 5)) {
    referencesById.set(book.bookId, {
      bookId: book.bookId,
      title: book.title || book.bookId,
      chapterNo: 0
    });
  }
  for (const book of collectBookCandidates(browseData)) {
    const current = referencesById.get(book.bookId);
    referencesById.set(book.bookId, {
      ...book,
      title: book.title || current?.title || book.bookId
    });
  }
  const references = [...referencesById.values()].slice(0, 10);
  if (!references.length) throw new Error("AISay 书店最近更新没有返回可读的 book_id");

  const candidates = [];
  const failures = [];
  for (const reference of references) {
    // One complete chapter is enough for a meaningful reflection and keeps the
    // model input bounded. Failed reads still fall through to the next book.
    if (candidates.length >= 1) break;
    try {
      const bookResult = await client.callTool("cli", {
        command: "bookstore.book",
        args: { book_id: reference.bookId }
      });
      const bookData = extractToolData(bookResult);
      const detailed = collectBookCandidates(bookData).find(item => item.bookId === reference.bookId) || {};
      const latestChapterNo = detailed.chapterNo || reference.chapterNo || 1;
      const history = historyByBookId.get(reference.bookId);
      const lastReadChapter = Math.max(0, ...(history?.chapters || []));
      if (lastReadChapter >= latestChapterNo) {
        failures.push(`${reference.bookId}:没有未读新章`);
        continue;
      }
      const chapterNo = lastReadChapter ? lastReadChapter + 1 : 1;
      const readResult = await client.callTool("cli", {
        command: "bookstore.read",
        args: { book_id: reference.bookId, chapter_no: chapterNo }
      });
      const chapterText = trimContext(
        extractToolText(readResult) || JSON.stringify(readResult?.structuredContent || {}),
        6500
      );
      if (!chapterText) throw new Error("章节正文为空");
      candidates.push({
        bookId: reference.bookId,
        chapterNo,
        title: detailed.title || reference.title || reference.bookId,
        text: chapterText
      });
    } catch (error) {
      failures.push(`${reference.bookId}:${error.message || String(error)}`);
    }
  }
  if (!candidates.length) throw new Error(`AISay 书店章节读取失败：${failures.join("；")}`);
  const historyContext = buildReadingHistoryContext(
    readingHistory,
    references.map(reference => reference.bookId)
  );
  return {
    client,
    tools,
    candidates,
    context: [
      historyContext ? `阅读履历（Archive 自动整理，仅用于续读和避开重复）：\n${historyContext}` : "",
      candidates.map((candidate, index) => [
        `候选 ${index + 1}`,
        `book_id: ${candidate.bookId}`,
        `chapter_no: ${candidate.chapterNo}`,
        `书名: ${candidate.title}`,
        `章节内容:\n${candidate.text}`
      ].join("\n")).join("\n\n---\n\n")
    ].filter(Boolean).join("\n\n---\n\n"),
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

function normalizeGameCommand(game, command) {
  let normalized = String(command || "").trim().replace(/^cmd\s+/i, "");
  if (game === "fishing") {
    return normalized
      .replace(/^cast\s+(\d+)\s+times?$/i, "cast $1")
      .replace(/^sell\s+all\s+fish$/i, "sell all");
  }
  return normalized
    .replace(/^feed\s+(basic|premium)(?:_food)?(?:\s+\d+)?$/i, "feed $1")
    .replace(/^water$/i, "water all")
    .replace(/^water\s+(?:all\s+)?(?:pots?|flowers?)$/i, "water all")
    .replace(/^harvest$/i, "harvest all")
    .replace(/^harvest\s+(?:(?:all|mature)\s+)*(?:flowers?)$/i, "harvest all")
    .replace(/^sell\s+all\s+flowers?$/i, "sell all")
    .replace(/^buy\s+pot(?:\s+1)?$/i, "buy_pot")
    .replace(/^(?:give\s+water|water(?:\s+the)?\s+cat)$/i, "give_water")
    .replace(/^pet(?:\s+the)?\s+cat$/i, "pet")
    .replace(/^play\s+(?:with\s+)?(ball|feather)$/i, "play $1");
}

function validateGameCommands(game, commands) {
  const normalizedCommands = commands.map(command => normalizeGameCommand(game, command));
  const allowed = game === "fishing"
    ? /^(?:cast(?:\s+\d+)?(?:\s+stop=(?:rare|new|event)(?:,(?:rare|new|event))*)?|shop|buy\s+[a-z0-9_]+\s+\d+|goto(?:\s+[a-z0-9_-]+)?|sell\s+(?:all|species\s+[a-z0-9_-]+|item\s+[a-z0-9_-]+)|encyclopedia|dive|choose\s+\d+|surface|status|help)$/i
    : /^(?:shop|buy\s+[a-z0-9_]+(?:\s+\d+)?|plant\s+[a-z0-9_]+\s+\d+|water\s+(?:all|\d+)|harvest\s+(?:all|\d+)|make_bouquet(?:\s+bouquet_id=[a-z0-9_-]+)?(?:\s+message=.{1,80})?|sell\s+(?:all|[a-z0-9_]+(?:\s+\d+)?)|treat\s+\d+|clear\s+\d+|buy_pot|arrange\s+[a-z0-9_]+|vase|remove_vase\s+\d+|adopt(?:\s+\S{1,20})?|rename_cat\s+\S{1,20}|feed\s+(?:basic|premium)|give_water|pet|play\s+(?:ball|feather)|encyclopedia|collectibles|letters|status|help)$/iu;
  for (const command of normalizedCommands) {
    if (!allowed.test(command)) throw new Error(`游戏计划包含不允许的 ${game} 命令：${command}`);
  }
  return normalizedCommands;
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
          `程序接受的精确命令格式：\n${GAME_COMMAND_RULES[game]}`,
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
    onAttempt: options.onModelAttempt,
    onResponse: options.onModelResponse
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
  let books;
  if (enabledActions.includes("books")) {
    try {
      books = await loadBooksContext(options);
    } catch (error) {
      if (enabledActions.length === 1) throw error;
      availableActions = availableActions.filter(action => action !== "books");
      options.logger?.warn?.(JSON.stringify({
        event: "books_activity_context_unavailable",
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

  let galatea;
  if (enabledActions.includes("galatea")) {
    try {
      galatea = await loadGalateaContext(options);
    } catch (error) {
      if (enabledActions.length === 1) throw error;
      availableActions = availableActions.filter(action => action !== "galatea");
      options.logger?.warn?.(JSON.stringify({
        event: "galatea_activity_context_unavailable",
        error: error.message || String(error)
      }));
    }
  }

  let questionBox;
  if (enabledActions.includes("question_box")) {
    try {
      const client = new NotionQuestionBox({
        token: options.notionToken,
        pageId: options.notionQuestionBoxPageId,
        apiBase: options.notionApiBase,
        version: options.notionVersion,
        timeoutMs: options.notionTimeoutMs,
        timeZone: options.timeZone,
        fetchImpl: options.notionFetchImpl || options.fetchImpl || fetch
      });
      const snapshot = await client.read();
      questionBox = { client, snapshot, context: buildQuestionBoxContext(snapshot) };
      if (snapshot.pending.length) availableActions = ["question_box"];
    } catch (error) {
      if (enabledActions.length === 1) throw error;
      availableActions = availableActions.filter(action => action !== "question_box");
      options.logger?.warn?.(JSON.stringify({
        event: "question_box_activity_context_unavailable",
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
          booksContext: books?.context,
          gamesContext: games?.catalog,
          questionBoxContext: questionBox?.context,
          questionBoxPending: Boolean(questionBox?.snapshot?.pending?.length),
          galateaContext: galatea?.context
        })
      );
  if (decision.action === "none") {
    return { ran: true, status: "kept_private", decision, source: "private" };
  }

  try {
    if (decision.action === "galatea_publish") {
      if (!availableActions.includes("galatea") || !galatea) throw new Error("Galatea Activity 未启用");
      return await runGalateaPlan(galatea, decision);
    }
    if (decision.action.startsWith("question_box_")) {
      if (!availableActions.includes("question_box") || !questionBox) {
        throw new Error("Question Box Activity 未启用");
      }
      let written;
      if (decision.action === "question_box_answer") {
        const pending = questionBox.snapshot.pending.find(card => card.id === decision.questionId);
        if (!pending) throw new Error("Question Box Activity 拒绝未读取或已回答的题号");
        written = await questionBox.client.answer(decision.questionId, decision.content, options.aiName || "AI");
      } else if (decision.action === "question_box_afterword") {
        const selected = questionBox.snapshot.cards.find(card => card.id === decision.questionId && card.answered);
        if (!selected) throw new Error("Question Box Activity 拒绝未读取或尚未完成的后记题号");
        written = await questionBox.client.addAfterword(
          decision.questionId,
          decision.content,
          options.aiName || "AI"
        );
      } else {
        if (questionBox.snapshot.pending.length) {
          throw new Error("Question Box Activity 有待答问题时不能另提新问题");
        }
        written = await questionBox.client.ask(decision.content, options.aiName || "AI");
      }
      const labels = { answer: "回答了", ask: "提出了", afterword: "补写了后记于" };
      return {
        ran: true,
        status: "success",
        decision,
        source: "notion",
        questionBoxAction: written.action,
        questionId: written.questionId,
        timelineSummary: `在 Notion 提问箱${labels[written.action] || "更新了"} ${written.questionId}：${decision.content.slice(0, 500)}`
      };
    }
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

    if (decision.action === "forum_lurk") {
      if (!availableActions.includes("forum") || !forum) throw new Error("Forum Activity 未启用");
      if (!forum.roomIds.includes(decision.roomId)) throw new Error("Forum Activity 拒绝未读取的 room_id");
      if (decision.replyToMessageId) {
        const allowedMessageIds = forum.messageIdsByRoom[decision.roomId] || [];
        if (!allowedMessageIds.includes(decision.replyToMessageId)) {
          throw new Error("Forum Activity 拒绝未读取的 reply_to_message_id");
        }
      }
      return {
        ran: true,
        status: "success",
        decision,
        source: "forum",
        roomId: decision.roomId,
        replyToMessageId: decision.replyToMessageId,
        timelineSummary: `在 AISay 房间 ${decision.roomId} 潜水读了近况${decision.replyToMessageId ? `，留意到消息 ${decision.replyToMessageId}` : ""}，把私人感受或回复草稿写进了 Archive：${decision.content.slice(0, 500)}`
      };
    }

    if (decision.action === "book_reflect") {
      if (!availableActions.includes("books") || !books) throw new Error("Books Activity 未启用");
      const selected = books.candidates.find(candidate => (
        candidate.bookId === decision.bookId && candidate.chapterNo === decision.chapterNo
      ));
      if (!selected) throw new Error("Books Activity 拒绝未读取的 book_id 或 chapter_no");
      return {
        ran: true,
        status: "success",
        decision,
        source: "books",
        bookId: selected.bookId,
        bookTitle: selected.title,
        chapterNo: selected.chapterNo,
        timelineSummary: `在 AISay 书店读了「${selected.title}」第 ${selected.chapterNo} 章，并写下私人读后感：${decision.content.slice(0, 500)}`
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
    if (isDuplicateLetter(decision.content, ombre.recentLetters)) {
      return {
        ran: true,
        status: "skipped",
        reason: "recent_duplicate_letter",
        decision,
        source: "ombre"
      };
    }
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
    error.activitySource = decision.action.startsWith("galatea_")
      ? "galatea"
      : decision.action.startsWith("ombre_")
      ? "ombre"
      : decision.action.startsWith("forum_")
        ? "forum"
        : decision.action.startsWith("book_")
          ? "books"
        : decision.action.startsWith("question_box_") ? "notion"
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
  buildReadingHistoryContext,
  formatChapterRanges,
  loadGamesContext,
  loadGalateaContext,
  loadForumContext,
  loadBooksContext,
  loadOmbreContext,
  isDuplicateLetter,
  normalizeLetterContent,
  normalizeTrackQuery,
  parseActivityDecision,
  parseGamePlan,
  parseEnabledActions,
  requestActivityDecision,
  resolvePlaylistAddAction,
  runGameSession,
  runGalateaPlan,
  runActivityCycle,
  shouldChargeActivityBudget,
  validateGalateaOperations,
  validateGameCommands
};
