function retainTimelineMessages(messages = [], {
  maxRealMessages = 50,
  maxSpecialEvents = 20,
  isSpecialEvent = () => false
} = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const system = list.filter(message => message?.role === "system").slice(-1);
  const indexed = list
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message?.role !== "system");
  const real = indexed.filter(({ message }) => !isSpecialEvent(message)).slice(-maxRealMessages);
  const events = indexed.filter(({ message }) => isSpecialEvent(message)).slice(-maxSpecialEvents);
  const keptIndexes = new Set([...real, ...events].map(({ index }) => index));

  return [...system, ...indexed.filter(({ index }) => keptIndexes.has(index)).map(({ message }) => message)];
}

module.exports = { retainTimelineMessages };
