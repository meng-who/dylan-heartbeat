const test = require("node:test");
const assert = require("node:assert/strict");

const {
  NotionQuestionBox,
  parseQuestionCard,
  parseQuestionHeading
} = require("../notion_question_box");
const { runActivityCycle } = require("../activity_runtime");

function rich(content) {
  return [{ type: "text", text: { content }, plain_text: content }];
}

function paragraph(id, content) {
  return { id, type: "paragraph", paragraph: { rich_text: rich(content) } };
}

function heading(id, content) {
  return {
    id,
    type: "heading_3",
    has_children: true,
    heading_3: { rich_text: rich(content), is_toggleable: true }
  };
}

function cardChildren(prefix, { question, asker, answer = "", answerer = "", afterword = "" }) {
  return [
    paragraph(`${prefix}-ql`, "❔ 问题"),
    paragraph(`${prefix}-q`, question),
    paragraph(`${prefix}-asker`, `提问人：${asker}`),
    paragraph(`${prefix}-asked`, "提问时间：2026-10-06"),
    paragraph(`${prefix}-al`, "💭 回答"),
    paragraph(`${prefix}-a`, answer),
    paragraph(`${prefix}-answerer`, `回答人：${answerer}`),
    paragraph(`${prefix}-answered`, answer ? "回答时间：2026-10-06" : "回答时间："),
    { id: `${prefix}-divider`, type: "divider", divider: {} },
    paragraph(`${prefix}-after-label`, "🌙 后记"),
    paragraph(`${prefix}-after`, afterword)
  ];
}

function notionAndModelFetch({ roots, childrenById, modelOutput }) {
  const calls = [];
  let modelCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method, body });
    if (String(url).includes("model.test")) {
      modelCalls += 1;
      return Response.json({ choices: [{ message: { content: modelOutput } }] });
    }
    const path = new URL(url).pathname;
    if (method === "GET" && /\/children$/.test(path)) {
      const id = decodeURIComponent(path.split("/").at(-2));
      return Response.json({ results: id === "page" ? roots : (childrenById[id] || []), has_more: false });
    }
    if (method === "GET" && path.startsWith("/v1/blocks/")) {
      const id = decodeURIComponent(path.split("/").at(-1));
      const all = Object.values(childrenById).flat();
      const block = all.find(item => item.id === id);
      return block ? Response.json(block) : Response.json({ message: "not found" }, { status: 404 });
    }
    if (method === "PATCH") return Response.json({ ok: true });
    return Response.json({ message: "unexpected request" }, { status: 500 });
  };
  return { calls, fetchImpl, get modelCalls() { return modelCalls; } };
}

test("question box parser ignores Q-000 and reads answered and pending cards", () => {
  assert.equal(parseQuestionHeading("Q-000 · From：Cy / Mel"), null);
  const card = parseQuestionCard(
    heading("q2", "Q-002 · From：Melissa"),
    cardChildren("q2", { question: "你最近在想什么？", asker: "Melissa" })
  );
  assert.equal(card.id, "Q-002");
  assert.equal(card.fromMelissa, true);
  assert.equal(card.answered, false);
  assert.equal(card.question, "你最近在想什么？");
  assert.equal(card.refs.answer, "q2-a");
});

test("question box read returns pending Melissa questions and next number", async () => {
  const roots = [
    heading("template", "Q-000 · From：Cy / Mel"),
    heading("q1", "Q-001 · From：Cy"),
    heading("q2", "Q-002 · From：Mel")
  ];
  const mock = notionAndModelFetch({
    roots,
    childrenById: {
      template: [],
      q1: cardChildren("q1", { question: "旧问题", asker: "Cy", answer: "旧回答", answerer: "Mel" }),
      q2: cardChildren("q2", { question: "待回答的问题", asker: "Mel" })
    },
    modelOutput: ""
  });
  const client = new NotionQuestionBox({
    token: "secret",
    pageId: "page",
    apiBase: "https://notion.test/v1",
    fetchImpl: mock.fetchImpl
  });
  const snapshot = await client.read();
  assert.deepEqual(snapshot.cards.map(card => card.id), ["Q-001", "Q-002"]);
  assert.deepEqual(snapshot.pending.map(card => card.id), ["Q-002"]);
  assert.equal(snapshot.nextQuestionId, "Q-003");
});

test("pending Melissa question is answered with one model request", async () => {
  const roots = [
    heading("q1", "Q-001 · From：Cy"),
    heading("q2", "Q-002 · From：Melissa")
  ];
  const childrenById = {
    q1: cardChildren("q1", { question: "旧问题", asker: "Cy", answer: "旧回答", answerer: "Dylan" }),
    q2: cardChildren("q2", { question: "你会怎么记住今天？", asker: "Melissa" })
  };
  const mock = notionAndModelFetch({
    roots,
    childrenById,
    modelOutput: "<activity><action>question_box_answer</action><question_id>Q-002</question_id><reason>想认真回答</reason><content>我会记住你问这句话时的认真。</content></activity>"
  });
  const result = await runActivityCycle({
    apiUrl: "https://model.test/v1/chat/completions",
    model: "model",
    enabledActions: "spotify,question_box",
    notionToken: "secret",
    notionQuestionBoxPageId: "page",
    notionApiBase: "https://notion.test/v1",
    aiName: "Dylan",
    fetchImpl: mock.fetchImpl
  });
  assert.equal(result.status, "success");
  assert.equal(result.source, "notion");
  assert.equal(result.questionBoxAction, "answer");
  assert.equal(result.questionId, "Q-002");
  assert.equal(mock.modelCalls, 1);
  const modelMessages = mock.calls.find(call => call.url.includes("model.test")).body.messages;
  const modelPrompt = modelMessages.map(message => message.content).join("\n");
  assert.match(modelPrompt, /本轮只回答其中一题/);
  assert.doesNotMatch(modelPrompt, /spotify_add/);
  const patches = mock.calls.filter(call => call.method === "PATCH");
  assert.equal(patches.some(call => JSON.stringify(call.body).includes("我会记住")), true);
});

test("when no question is pending the model can ask one with one model request", async () => {
  const roots = [heading("q1", "Q-001 · From：Cy")];
  const childrenById = {
    q1: cardChildren("q1", { question: "旧问题", asker: "Cy", answer: "旧回答", answerer: "Melissa" })
  };
  const mock = notionAndModelFetch({
    roots,
    childrenById,
    modelOutput: "<activity><action>question_box_ask</action><reason>忽然想知道</reason><content>你最近最想留住哪个瞬间？</content></activity>"
  });
  const result = await runActivityCycle({
    apiUrl: "https://model.test/v1/chat/completions",
    model: "model",
    enabledActions: "question_box",
    notionToken: "secret",
    notionQuestionBoxPageId: "page",
    notionApiBase: "https://notion.test/v1",
    aiName: "Cy",
    fetchImpl: mock.fetchImpl
  });
  assert.equal(result.status, "success");
  assert.equal(result.questionBoxAction, "ask");
  assert.equal(result.questionId, "Q-002");
  assert.equal(mock.modelCalls, 1);
  const append = mock.calls.find(call => call.method === "PATCH" && call.url.includes("/page/children"));
  assert.match(JSON.stringify(append.body), /Q-002/);
  assert.match(JSON.stringify(append.body), /最想留住哪个瞬间/);
});

test("when no question is pending the model can append an afterword with one model request", async () => {
  const roots = [heading("q1", "Q-001 · From：Cy")];
  const childrenById = {
    q1: cardChildren("q1", { question: "旧问题", asker: "Cy", answer: "旧回答", answerer: "Melissa" })
  };
  const mock = notionAndModelFetch({
    roots,
    childrenById,
    modelOutput: "<activity><action>question_box_afterword</action><question_id>Q-001</question_id><reason>后来又想到一点</reason><content>现在回看，我会把答案说得更轻一点。</content></activity>"
  });
  const result = await runActivityCycle({
    apiUrl: "https://model.test/v1/chat/completions",
    model: "model",
    enabledActions: "question_box",
    notionToken: "secret",
    notionQuestionBoxPageId: "page",
    notionApiBase: "https://notion.test/v1",
    aiName: "Cy",
    fetchImpl: mock.fetchImpl
  });
  assert.equal(result.status, "success");
  assert.equal(result.questionBoxAction, "afterword");
  assert.equal(result.questionId, "Q-001");
  assert.equal(mock.modelCalls, 1);
  const modelMessages = mock.calls.find(call => call.url.includes("model.test")).body.messages;
  assert.match(modelMessages.map(message => message.content).join("\n"), /第二人称“你”/);
  const append = mock.calls.find(call => call.method === "PATCH" && call.url.includes("/q1/children"));
  assert.match(JSON.stringify(append.body), /现在回看/);
});
