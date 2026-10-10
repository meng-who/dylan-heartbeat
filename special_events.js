const SPECIAL_EVENT_PREFIX = /^\s*[（(]\s*\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:[ T]\s*)?\d{1,2}[:：]\d{2}(?::\d{2})?\s+(?:自动唤醒：本次未发送(?:\s*(?:Bark|推送))?|刚刚发送了推送|刚刚给(?:宝宝|用户)发了\s*(?:Bark|ntfy)?\s*推送|刚刚给(?:宝宝|用户)发了\s*Bark|自主活动|Solo\s*独处|梦境)(?:[：:｜|）)]|\s|$)/i;

function isSpecialEventContent(content) {
  return SPECIAL_EVENT_PREFIX.test(String(content || ""));
}

function classifySpecialEventContent(content) {
  const text = String(content || "");
  if (!isSpecialEventContent(text)) return "";
  if (/\s自主活动[：:]/i.test(text)) return "activity";
  if (/\sSolo\s*独处[：:]/i.test(text)) return "solo";
  if (/\s梦境[：:]/i.test(text)) return "dream";
  return "push";
}

function selectRecentAutomationEvents(events = [], {
  maxPushEvents = 10,
  maxActivityEvents = 8,
  maxSoloEvents = 4,
  maxDreamEvents = 2,
  getTimestamp = () => null
} = {}) {
  const indexed = events.map((event, index) => {
    const value = getTimestamp(event);
    const timestamp = value instanceof Date ? value.getTime() : Number(value);
    return { event, index, timestamp: Number.isFinite(timestamp) ? timestamp : null };
  });
  const byRecency = (a, b) => {
    if (a.timestamp != null && b.timestamp != null && a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a.index - b.index;
  };
  const takeLatest = (kind, limit) => indexed
    .filter(({ event }) => classifySpecialEventContent(event?.content) === kind)
    .sort(byRecency)
    .slice(-Math.max(0, limit));
  return [
    ...takeLatest("push", maxPushEvents),
    ...takeLatest("activity", maxActivityEvents),
    ...takeLatest("solo", maxSoloEvents),
    ...takeLatest("dream", maxDreamEvents)
  ].sort(byRecency).map(({ event }) => event);
}

module.exports = {
  classifySpecialEventContent,
  isSpecialEventContent,
  selectRecentAutomationEvents,
  SPECIAL_EVENT_PREFIX
};
