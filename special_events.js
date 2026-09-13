const SPECIAL_EVENT_PREFIX = /^\s*[（(]\s*\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:[ T]\s*)?\d{1,2}[:：]\d{2}(?::\d{2})?\s+(?:自动唤醒：本次未发送(?:\s*(?:Bark|推送))?|刚刚发送了推送|刚刚给(?:宝宝|用户)发了\s*(?:Bark|ntfy)?\s*推送|刚刚给(?:宝宝|用户)发了\s*Bark|自主活动|Solo\s*独处)(?:[：:｜|）)]|\s|$)/i;

function isSpecialEventContent(content) {
  return SPECIAL_EVENT_PREFIX.test(String(content || ""));
}

function classifySpecialEventContent(content) {
  const text = String(content || "");
  if (!isSpecialEventContent(text)) return "";
  if (/\s自主活动[：:]/i.test(text)) return "activity";
  if (/\sSolo\s*独处[：:]/i.test(text)) return "solo";
  return "push";
}

module.exports = { classifySpecialEventContent, isSpecialEventContent, SPECIAL_EVENT_PREFIX };
