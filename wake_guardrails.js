function findWakeOutputViolations(text, { diffMinutes, dayPeriod } = {}) {
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

  return violations;
}

module.exports = { findWakeOutputViolations };
