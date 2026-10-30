const { getSelf, getOwnPosts, getDirectReplies, createPost } = require("./x_api");

async function loadXContext({ env = process.env, fetchImpl = fetch, seenReplies = [] } = {}) {
  const api = { env, fetchImpl };
  const self = await getSelf(api);
  if (!self?.id) throw new Error("X API 未返回当前账号");
  const posts = (await getOwnPosts(self.id, api)).slice(0, 3);
  const replies = [];
  for (const post of posts) {
    const found = await getDirectReplies(post.id, api);
    for (const reply of found) {
      if (reply.author_id !== self.id && !seenReplies.includes(reply.id)) {
        replies.push({ id: reply.id, post_id: post.id, text: reply.text, author_id: reply.author_id });
      }
    }
  }
  return { self: { id: self.id, username: self.username }, posts: posts.map(post => ({ id: post.id, text: post.text })), replies: replies.slice(0, 15) };
}

function validateXDecision(decision, context) {
  if (!["x_post", "x_reply"].includes(decision.action)) throw new Error("无效的 X 动作");
  if (typeof decision.content !== "string" || !decision.content.trim() || [...decision.content].length > 280) {
    throw new Error("X 正文须为 1–280 字符");
  }
  if (decision.action === "x_reply" && !context.replies.some(reply => reply.id === decision.replyId)) {
    throw new Error("只能回复本轮刚读取到的自己帖子下的新评论");
  }
}

async function executeXDecision(decision, context, { env = process.env, fetchImpl = fetch } = {}) {
  validateXDecision(decision, context);
  const posted = await createPost(decision.content, { env, fetchImpl, ...(decision.action === "x_reply" ? { replyTo: decision.replyId } : {}) });
  if (!posted?.id) throw new Error("X 未返回已发布帖子 ID，不能确认发布结果");
  return {
    ran: true, status: "success", source: "x", decision,
    xPostId: posted.id, xReplyId: decision.action === "x_reply" ? decision.replyId : "",
    timelineSummary: `${decision.action === "x_reply" ? "回复了自己帖子下的评论" : "发布了 X 帖子"}：https://x.com/${context.self.username}/status/${posted.id}`
  };
}

module.exports = { loadXContext, validateXDecision, executeXDecision };
