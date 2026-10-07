const DEFAULT_NOTION_API_BASE = "https://api.notion.com/v1";
const DEFAULT_NOTION_VERSION = "2022-06-28";

function blockText(block) {
  const value = block?.[block?.type];
  const richText = value?.rich_text || value?.title || [];
  return richText.map(item => item?.plain_text || item?.text?.content || "").join("").trim();
}

function normalizePerson(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

function isMelissa(value) {
  return /^(?:mel|melissa|梅丽莎)$/.test(normalizePerson(value));
}

function parseQuestionHeading(value) {
  const match = String(value || "").match(/^Q-(\d+)\s*[·•]\s*From\s*[:：]\s*(.+?)\s*$/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { id: `Q-${String(number).padStart(3, "0")}`, number, from: match[2].trim() };
}

function fieldKind(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (/^❔?\s*问题\s*[:：]?$/u.test(text)) return "question";
  if (/^提问人\s*[:：]/u.test(text)) return "asker";
  if (/^提问时间\s*[:：]/u.test(text)) return "askedAt";
  if (/^💭?\s*回答\s*[:：]?$/u.test(text)) return "answer";
  if (/^回答人\s*[:：]/u.test(text)) return "answerer";
  if (/^回答时间\s*[:：]/u.test(text)) return "answeredAt";
  if (/^🌙?\s*后记\s*[:：]?$/u.test(text)) return "afterword";
  return "";
}

function inlineFieldValue(value) {
  return String(value || "").match(/^[^:：]+[:：]\s*(.*)$/u)?.[1]?.trim() || "";
}

function parseQuestionCard(block, children = []) {
  const heading = parseQuestionHeading(blockText(block));
  if (!heading) return null;
  const card = {
    ...heading, blockId: block.id, question: "", asker: "", askedAt: "",
    answer: "", answerer: "", answeredAt: "", afterword: "", refs: {}
  };
  let section = "";
  for (const child of children) {
    const text = blockText(child);
    const kind = fieldKind(text);
    if (kind) {
      section = kind;
      card.refs[`${kind}Label`] = child.id;
      const inline = inlineFieldValue(text);
      if (inline && !["question", "answer", "afterword"].includes(kind)) card[kind] = inline;
      continue;
    }
    if (!section || child.type === "divider") continue;
    if (!card.refs[section]) card.refs[section] = child.id;
    if (!text) continue;
    if (["question", "answer", "afterword"].includes(section)) {
      card[section] = [card[section], text].filter(Boolean).join("\n");
    } else if (!card[section]) {
      card[section] = text;
    }
  }
  card.answered = Boolean(card.answer.trim());
  card.fromMelissa = isMelissa(card.from) || isMelissa(card.asker);
  return card;
}

function richText(content) {
  const text = String(content || "");
  if (!text) return [];
  return (text.match(/.{1,1900}/gs) || []).map(part => ({
    type: "text",
    text: { content: part }
  }));
}

function paragraph(content) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText(content) } };
}

function localDate(date = new Date(), timeZone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

class NotionQuestionBox {
  constructor(options = {}) {
    this.token = String(options.token || "").trim();
    this.pageId = String(options.pageId || "").trim();
    this.apiBase = String(options.apiBase || DEFAULT_NOTION_API_BASE).replace(/\/+$/, "");
    this.version = String(options.version || DEFAULT_NOTION_VERSION);
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20_000;
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeZone = options.timeZone || "Asia/Shanghai";
    if (!this.token) throw new Error("NOTION_TOKEN 未配置");
    if (!this.pageId) throw new Error("NOTION_QUESTION_BOX_PAGE_ID 未配置");
  }

  async request(path, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.apiBase}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": this.version,
          "Content-Type": "application/json",
          ...(init.headers || {})
        },
        signal: init.signal || controller.signal
      });
      const text = await response.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
      if (!response.ok) {
        throw new Error(`Notion HTTP ${response.status}: ${body.message || body.code || text || "请求失败"}`);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async listChildren(blockId) {
    const results = [];
    let cursor = "";
    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (cursor) query.set("start_cursor", cursor);
      const page = await this.request(`/blocks/${encodeURIComponent(blockId)}/children?${query}`);
      results.push(...(Array.isArray(page.results) ? page.results : []));
      cursor = page.has_more ? String(page.next_cursor || "") : "";
    } while (cursor && results.length < 500);
    if (results.length >= 500) throw new Error("Notion 提问箱块数量超过安全上限 500");
    return results;
  }

  async read() {
    const roots = await this.listChildren(this.pageId);
    const cards = [];
    for (const block of roots) {
      if (!parseQuestionHeading(blockText(block))) continue;
      const children = block.has_children ? await this.listChildren(block.id) : [];
      const card = parseQuestionCard(block, children);
      if (card) cards.push(card);
    }
    cards.sort((left, right) => left.number - right.number);
    return {
      cards,
      pending: cards.filter(card => card.fromMelissa && !card.answered),
      nextQuestionId: `Q-${String((cards.at(-1)?.number || 0) + 1).padStart(3, "0")}`
    };
  }

  async updateRichText(blockId, content) {
    if (!blockId) return false;
    const block = await this.request(`/blocks/${encodeURIComponent(blockId)}`);
    const type = block.type;
    if (!type || !block[type] || !Array.isArray(block[type].rich_text)) return false;
    await this.request(`/blocks/${encodeURIComponent(blockId)}`, {
      method: "PATCH",
      body: JSON.stringify({ [type]: { rich_text: richText(content) } })
    });
    return true;
  }

  async appendChildren(blockId, children) {
    return this.request(`/blocks/${encodeURIComponent(blockId)}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children })
    });
  }

  async answer(questionId, content, answerer) {
    const snapshot = await this.read();
    const card = snapshot.cards.find(item => item.id === questionId);
    if (!card) throw new Error(`Notion 提问箱没有找到 ${questionId}`);
    if (!card.fromMelissa) throw new Error(`Notion 提问箱拒绝回答非 Melissa 提问：${questionId}`);
    if (card.answered) throw new Error(`Notion 提问箱 ${questionId} 已经回答，已停止重复写入`);
    const date = localDate(new Date(), this.timeZone);
    const updates = [
      [card.refs.answer, content],
      [card.refs.answerer || card.refs.answererLabel, `回答人：${answerer}`],
      [card.refs.answeredAt || card.refs.answeredAtLabel, `回答时间：${date}`]
    ];
    let updatedAnswer = false;
    for (const [blockId, value] of updates) {
      const updated = await this.updateRichText(blockId, value);
      if (blockId === card.refs.answer) updatedAnswer = updated;
    }
    if (!updatedAnswer) {
      await this.appendChildren(card.blockId, [
        paragraph("💭 回答"),
        paragraph(content),
        paragraph(`回答人：${answerer}`),
        paragraph(`回答时间：${date}`)
      ]);
    }
    return { action: "answer", questionId: card.id };
  }

  async ask(content, asker) {
    const snapshot = await this.read();
    const id = snapshot.nextQuestionId;
    const date = localDate(new Date(), this.timeZone);
    await this.appendChildren(this.pageId, [{
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: richText(`${id} · From：${asker}`),
        is_toggleable: true,
        children: [
          paragraph("❔ 问题"),
          paragraph(content),
          paragraph(`提问人：${asker}`),
          paragraph(`提问时间：${date}`),
          paragraph("💭 回答"),
          paragraph(""),
          paragraph("回答人："),
          paragraph("回答时间："),
          { object: "block", type: "divider", divider: {} },
          paragraph("🌙 后记")
        ]
      }
    }]);
    return { action: "ask", questionId: id };
  }

  async addAfterword(questionId, content, author) {
    const snapshot = await this.read();
    const card = snapshot.cards.find(item => item.id === questionId);
    if (!card) throw new Error(`Notion 提问箱没有找到 ${questionId}`);
    await this.appendChildren(card.blockId, [paragraph(`${author}：${content}`)]);
    return { action: "afterword", questionId: card.id };
  }
}

function buildQuestionBoxContext(snapshot, maxRecent = 6) {
  const pending = snapshot.pending.map(card => (
    `${card.id} | From ${card.from || card.asker || "Melissa"} | ${card.question}`
  ));
  const recent = snapshot.cards.filter(card => card.answered).slice(-maxRecent).reverse().map(card => [
    `${card.id} | From ${card.from || card.asker || "未知"}`,
    `问：${card.question || "（未识别）"}`,
    `答：${card.answer || "（未识别）"}`,
    card.afterword ? `后记：${card.afterword}` : ""
  ].filter(Boolean).join("\n"));
  return [
    pending.length
      ? `等待你回答的 Melissa 提问：\n${pending.join("\n")}`
      : "目前没有 Melissa 留下的未回答问题。",
    recent.length
      ? `最近问答（可从中选择一题写后记）：\n${recent.join("\n\n")}`
      : "目前还没有已完成问答。",
    `若提新问题，程序将使用下一个编号 ${snapshot.nextQuestionId}。`
  ].join("\n\n");
}

module.exports = {
  NotionQuestionBox,
  blockText,
  buildQuestionBoxContext,
  isMelissa,
  localDate,
  parseQuestionCard,
  parseQuestionHeading
};
