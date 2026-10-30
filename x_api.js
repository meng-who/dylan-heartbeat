const { createHmac, randomBytes } = require("node:crypto");

const API_ORIGIN = "https://api.x.com";

function credentials(env = process.env) {
  const values = {
    key: env.X_API_KEY,
    secret: env.X_API_SECRET,
    token: env.X_ACCESS_TOKEN,
    tokenSecret: env.X_ACCESS_TOKEN_SECRET
  };
  if (Object.values(values).some(value => !String(value || "").trim())) {
    throw new Error("X API 凭证不完整：需要 X_API_KEY、X_API_SECRET、X_ACCESS_TOKEN、X_ACCESS_TOKEN_SECRET");
  }
  return values;
}

function encode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function authorization(method, url, keys, { nonce = randomBytes(16).toString("hex"), timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const oauth = {
    oauth_consumer_key: keys.key,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: keys.token,
    oauth_version: "1.0"
  };
  const target = new URL(url);
  const pairs = [...target.searchParams.entries(), ...Object.entries(oauth)]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const parameterString = pairs.map(pair => pair.join("=")).join("&");
  const base = [method.toUpperCase(), encode(target.origin + target.pathname), encode(parameterString)].join("&");
  const secret = `${encode(keys.secret)}&${encode(keys.tokenSecret)}`;
  oauth.oauth_signature = createHmac("sha1", secret).update(base).digest("base64");
  return "OAuth " + Object.entries(oauth).map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(", ");
}

async function requestX(method, path, { env = process.env, fetchImpl = fetch, body, query } = {}) {
  const url = new URL(path, API_ORIGIN);
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const response = await fetchImpl(url, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      authorization: authorization(method, url.href, credentials(env)),
      ...(body ? { "content-type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`X API HTTP ${response.status}: ${data.title || data.detail || data.errors?.[0]?.detail || "请求失败"}`);
  return data;
}

async function getSelf(options) {
  return (await requestX("GET", "/2/users/me", options)).data;
}

async function getOwnPosts(userId, options = {}) {
  if (!/^\d{1,19}$/.test(String(userId))) throw new Error("无效的 X 用户 ID");
  const result = await requestX("GET", `/2/users/${userId}/tweets`, {
    ...options,
    query: { max_results: 10, exclude: "retweets,replies", "tweet.fields": "created_at,public_metrics" }
  });
  return result.data || [];
}

async function getDirectReplies(postId, options = {}) {
  if (!/^\d{1,19}$/.test(String(postId))) throw new Error("无效的 X 帖子 ID");
  const result = await requestX("GET", "/2/tweets/search/recent", {
    ...options,
    query: {
      query: `in_reply_to_tweet_id:${postId} -is:retweet`,
      "tweet.fields": "author_id,created_at,conversation_id,referenced_tweets",
      max_results: 10,
      ...(options.sinceId ? { since_id: options.sinceId } : {})
    }
  });
  return result.data || [];
}

async function createPost(text, { replyTo, ...options } = {}) {
  if (typeof text !== "string" || !text.trim() || [...text].length > 280) throw new Error("X 帖子正文须为 1–280 个字符");
  if (replyTo && !/^\d{1,19}$/.test(String(replyTo))) throw new Error("无效的 X 回复目标 ID");
  const body = { text: text.trim(), ...(replyTo ? { reply: { in_reply_to_tweet_id: String(replyTo) } } : {}) };
  return (await requestX("POST", "/2/tweets", { ...options, body })).data;
}

module.exports = { authorization, credentials, requestX, getSelf, getOwnPosts, getDirectReplies, createPost };
