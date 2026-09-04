function findWakeOutputViolations(text, { diffMinutes, dayPeriod, weekday } = {}) {
  const value = String(text || "");
  const violations = [];

  if (Number(diffMinutes) < 24 * 60) {
    const unsupportedAbsence = [
      /好久(?:不见|没)/,
      /很久(?:不见|没)/,
      /(?:今天)?一整天(?:都)?没/,
      /今天一天都没/,
      /从早到晚.*没(?:来|找|消息|联系)/
    ];
    if (unsupportedAbsence.some(pattern => pattern.test(value))) {
      violations.push("unsupported_absence_claim");
    }
  }

  const incompatibleGreetings = {
    凌晨: /(?:早上好|上午好|下午好|晚上好)/,
    上午: /(?:下午好|晚上好|晚安)/,
    中午: /(?:早上好|上午好|晚上好|晚安)/,
    下午: /(?:早上好|早安|上午好|晚上好|晚安)/,
    晚上: /(?:早上好|早安|上午好|中午好|下午好)/
  };
  const greetingPattern = incompatibleGreetings[dayPeriod];
  if (greetingPattern?.test(value)) violations.push("wrong_local_greeting");

  const expectedWeekday = String(weekday || "").match(/[一二三四五六日天]/)?.[0];
  const statedWeekdays = [...value.matchAll(/今天(?:是|已经是|又是)?\s*(?:星期|周|礼拜)([一二三四五六日天])/g)]
    .map(match => match[1]);
  if (expectedWeekday && statedWeekdays.some(stated => stated !== expectedWeekday)) {
    violations.push("wrong_local_weekday");
  }

  const compact = value.replace(/\s+/g, "");
  const genericCalendarNudge = /今天是(?:\d{1,2}月\d{1,2}[日号]|星期[一二三四五六日天]|周[一二三四五六日天]).{0,20}(?:想你|来找我)/;
  if (genericCalendarNudge.test(compact)) violations.push("generic_calendar_nudge");

  return violations;
}

function parseNoActionDirective(text) {
  const value = String(text || "").trim();
  // 兼容 [NO_ACTION]、[NO\_ACTION]、[NO-ACTION]、[NO ACTION]，且不要求位于开头。
  const match = /\[\s*NO\s*(?:\\?_|-|\s+)\s*ACTION\s*\]/i.exec(value);
  if (!match) return { matched: false, reason: "" };

  const before = value.slice(0, match.index).trim();
  const after = value.slice(match.index + match[0].length).trim();
  const reason = (after || before)
    .replace(/^原因[：:]\s*/, "")
    .replace(/^[|｜,，。:：;；\s]+|[|｜,，。:：;；\s]+$/g, "")
    .slice(0, 20);
  return { matched: true, reason };
}

module.exports = { findWakeOutputViolations, parseNoActionDirective };
