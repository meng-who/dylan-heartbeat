function parseValidDate(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stampLatestUserActivity(messages, receivedAt) {
  const list = Array.isArray(messages) ? messages.map(message => ({ ...message })) : [];
  const activityTime = parseValidDate(receivedAt);
  if (!activityTime) return list;

  for (let index = list.length - 1; index >= 0; index--) {
    if (list[index]?.role !== "user") continue;
    list[index].gateway_activity_at = activityTime.toISOString();
    break;
  }
  return list;
}

function createUserActivityRecord(messages, receivedAt) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.some(message => message?.role === "user")) return null;
  const activityTime = parseValidDate(receivedAt);
  if (!activityTime) return null;
  return {
    last_user_at: activityTime.toISOString(),
    source: "gateway_request"
  };
}

function parseUserActivityRecord(record) {
  const activityTime = parseValidDate(record?.last_user_at);
  if (!activityTime) return null;
  return {
    time: activityTime,
    source: String(record?.source || "activity_file")
  };
}

function getLatestUserActivity(messages, parseContentTimestamp) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index--) {
    const message = list[index];
    if (message?.role !== "user") continue;

    const gatewayActivity = parseValidDate(message.gateway_activity_at);
    if (gatewayActivity) return { time: gatewayActivity, source: "gateway_activity_at" };

    const contentTime = typeof parseContentTimestamp === "function"
      ? parseContentTimestamp(message.content)
      : null;
    if (contentTime && !Number.isNaN(contentTime.getTime())) {
      return { time: contentTime, source: "content_timestamp" };
    }

    for (const [field, source] of [
      ["received_at", "received_at"],
      ["created_at", "created_at"],
      ["timestamp", "timestamp"]
    ]) {
      const fallback = parseValidDate(message[field]);
      if (fallback) return { time: fallback, source };
    }
  }
  return null;
}

module.exports = {
  createUserActivityRecord,
  getLatestUserActivity,
  parseUserActivityRecord,
  stampLatestUserActivity
};
