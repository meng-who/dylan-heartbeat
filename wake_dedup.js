const PUSH_EVENT_PAYLOAD = /刚刚给(?:宝宝|用户)发了\s*(?:Bark|ntfy)?\s*(?:推送)?[：:]\s*([\s\S]*?)[）)]?\s*$/i;

function extractSentPush(content) {
  const match = String(content || "").match(PUSH_EVENT_PAYLOAD);
  if (!match) return null;
  const payload = match[1].trim();
  const separator = payload.search(/[｜|]/);
  if (separator < 0) return { title: "", body: payload };
  return {
    title: payload.slice(0, separator).trim(),
    body: payload.slice(separator + 1).trim()
  };
}

function getRecentSentPushes(messages = [], limit = 5) {
  return (Array.isArray(messages) ? messages : [])
    .map(message => extractSentPush(message?.content))
    .filter(Boolean)
    .slice(-Math.max(1, Number(limit) || 5));
}

function normalizePushText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g, "")
    .replace(/\d{1,2}月\d{1,2}[日号]/g, "")
    .replace(/(?:星期|周)[一二三四五六日天]/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function bigrams(value) {
  const text = normalizePushText(value);
  if (text.length < 2) return new Set(text ? [text] : []);
  const result = new Set();
  for (let i = 0; i < text.length - 1; i++) result.add(text.slice(i, i + 2));
  return result;
}

function diceSimilarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}

const TOPIC_PATTERNS = {
  sleep: /睡|熬夜|休息|困|晚安/,
  food: /吃饭|早餐|午饭|晚饭|饿|饭点/,
  hydration: /喝水|补水|水杯|口渴/,
  longing: /想你|来找我|陪我|看看我|想见你/,
  work: /工作|上班|下班|加班|忙完|摸鱼/,
  weather: /天气|下雨|降温|升温|冷|热|带伞/
};

function topics(value) {
  const text = normalizePushText(value);
  return Object.entries(TOPIC_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

function findSimilarRecentPush(candidate, recentPushes = []) {
  const candidateText = `${candidate?.title || ""} ${candidate?.body || ""}`.trim();
  const candidateTopics = topics(candidateText);

  for (let i = recentPushes.length - 1; i >= 0; i--) {
    const previous = recentPushes[i];
    const previousText = `${previous.title || ""} ${previous.body || ""}`.trim();
    const similarity = diceSimilarity(candidateText, previousText);
    if (similarity >= 0.55) return { matched: true, reason: "similar_text", similarity };

    const sharedTopics = candidateTopics.filter(topic => topics(previousText).includes(topic));
    if (sharedTopics.length > 0 && normalizePushText(candidateText).length <= 60 && normalizePushText(previousText).length <= 60) {
      return { matched: true, reason: `repeated_topic:${sharedTopics[0]}`, similarity };
    }
  }

  return { matched: false, reason: "", similarity: 0 };
}

module.exports = {
  diceSimilarity,
  extractSentPush,
  findSimilarRecentPush,
  getRecentSentPushes,
  normalizePushText,
  topics
};
