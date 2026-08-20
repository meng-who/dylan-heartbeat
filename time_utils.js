const DEFAULT_TIME_ZONE = "Asia/Shanghai";

function resolveTimeZone(raw = process.env.TIME_ZONE, fallback = DEFAULT_TIME_ZONE) {
  const zone = String(raw || "").trim() || fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
    return zone;
  } catch {
    console.warn(`TIME_ZONE=${zone} 无效，已回退到 ${fallback}`);
    return fallback;
  }
}

function getDatePartsInTimeZone(date = new Date(), timeZone = resolveTimeZone()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second || "00"
  };
}

function formatDateTimeInTimeZone(date = new Date(), timeZone = resolveTimeZone()) {
  const parts = getDatePartsInTimeZone(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function getHourInTimeZone(date = new Date(), timeZone = resolveTimeZone()) {
  return Number(getDatePartsInTimeZone(date, timeZone).hour);
}

function getChineseDayPeriod(date = new Date(), timeZone = resolveTimeZone()) {
  const hour = getHourInTimeZone(date, timeZone);
  if (hour < 5) return "凌晨";
  if (hour < 11) return "上午";
  if (hour < 13) return "中午";
  if (hour < 18) return "下午";
  return "晚上";
}

function getChineseWeekday(date = new Date(), timeZone = resolveTimeZone()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    weekday: "long"
  }).format(date);
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getDatePartsInTimeZone(date, timeZone);
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second || "00")
  );
  return asUTC - date.getTime();
}

function zonedWallTimeToDate({ year, month, day, hour, minute }, timeZone = resolveTimeZone()) {
  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0
  );
  let offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  let parsed = new Date(utcGuess - offset);
  const adjustedOffset = getTimeZoneOffsetMs(parsed, timeZone);
  if (adjustedOffset !== offset) parsed = new Date(utcGuess - adjustedOffset);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseLeadingZonedTimestamp(value, timeZone = resolveTimeZone()) {
  const text = String(value || "");
  // Kelivo 当前使用 "YYYY-MM-DD  HH:mm\n"（两个空格），旧版本也可能
  // 使用一个空格、T 或无分隔符，因此这里兼容所有这些前缀格式。
  const match = text.match(/^（?\s*(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:T|\s*)(\d{1,2})[:：](\d{2})/);
  if (!match) return null;
  const [, year, , month, day, hour, minute] = match;
  return zonedWallTimeToDate({ year, month, day, hour, minute }, timeZone);
}

module.exports = {
  DEFAULT_TIME_ZONE,
  formatDateTimeInTimeZone,
  getChineseDayPeriod,
  getChineseWeekday,
  getDatePartsInTimeZone,
  getHourInTimeZone,
  parseLeadingZonedTimestamp,
  resolveTimeZone,
  zonedWallTimeToDate
};
