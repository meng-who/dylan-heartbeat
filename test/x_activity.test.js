const test = require("node:test");
const assert = require("node:assert/strict");
const { authorization, getSelf, getDirectReplies, createPost } = require("../x_api");
const { validateXDecision, executeXDecision } = require("../x_activity");

const env = { X_API_KEY: "app-key", X_API_SECRET: "app-secret", X_ACCESS_TOKEN: "user-token", X_ACCESS_TOKEN_SECRET: "user-secret" };
const response = data => ({ ok: true, status: 200, json: async () => ({ data }) });

test("OAuth signature changes when request target changes without exposing secrets", () => {
  const keys = { key: env.X_API_KEY, secret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_TOKEN_SECRET };
  const one = authorization("GET", "https://api.x.com/2/users/me", keys, { nonce: "fixed", timestamp: 123 });
  const two = authorization("GET", "https://api.x.com/2/tweets/search/recent?query=hello", keys, { nonce: "fixed", timestamp: 123 });
  assert.match(one, /^OAuth /);
  assert.notEqual(one, two);
  assert.doesNotMatch(one, /app-secret|user-secret/);
});

test("read-only account and direct reply lookup use scoped endpoints", async () => {
  const paths = [];
  const fetchImpl = async url => {
    paths.push(String(url));
    return response(paths.length === 1 ? { id: "12", username: "cy" } : [{ id: "34", text: "hi" }]);
  };
  assert.equal((await getSelf({ env, fetchImpl })).username, "cy");
  assert.equal((await getDirectReplies("123", { env, fetchImpl }))[0].id, "34");
  assert.match(paths[1], /in_reply_to_tweet_id%3A123/);
});

test("reply must target a comment read in this cycle", () => {
  assert.throws(() => validateXDecision({ action: "x_reply", replyId: "999", content: "你好" }, { replies: [{ id: "123" }] }), /本轮/);
});

test("failed privacy review never calls the X write endpoint", async () => {
  let called = false;
  const fetchImpl = async url => {
    if (String(url).includes("api.x.com")) called = true;
    return { ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ decision: "block", text: "" }) }] } }] }) };
  };
  await assert.rejects(() => executeXDecision({ action: "x_post", content: "一条公开想法" }, { self: { username: "cy" }, replies: [] }, { env, fetchImpl, geminiApiKey: "key" }), /未通过/);
  assert.equal(called, false);
});

test("post sends reply target in official API body", async () => {
  let body;
  const fetchImpl = async (_url, init) => { body = JSON.parse(init.body); return response({ id: "456" }); };
  assert.equal((await createPost("你好", { replyTo: "123", env, fetchImpl })).id, "456");
  assert.equal(body.reply.in_reply_to_tweet_id, "123");
});
