const test = require("node:test");
const assert = require("node:assert/strict");
const { authorized, handleXMcP } = require("../x_mcp");

const env = {
  X_API_KEY: "app-key", X_API_SECRET: "app-secret",
  X_ACCESS_TOKEN: "user-token", X_ACCESS_TOKEN_SECRET: "user-secret"
};

test("X MCP requires its own bearer token", () => {
  assert.equal(authorized("Bearer long-secret", "long-secret"), true);
  assert.equal(authorized("Bearer wrong-secret", "long-secret"), false);
  assert.equal(authorized("Basic long-secret", "long-secret"), false);
});

test("X MCP exposes only three scoped tools", async () => {
  const initialized = await handleXMcP({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  assert.equal(initialized.body.result.protocolVersion, "2025-03-26");
  const newer = await handleXMcP({ jsonrpc: "2.0", id: 10, method: "initialize", params: { protocolVersion: "2025-11-25" } });
  assert.equal(newer.body.result.protocolVersion, "2025-11-25");
  const listed = await handleXMcP({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(listed.body.result.tools.map(tool => tool.name), ["x_get_context", "x_post", "x_reply"]);
  assert.equal(listed.body.result.tools[0].annotations.readOnlyHint, true);
  assert.equal((await handleXMcP({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
});

test("X MCP rejects reply ID absent from current own-post context without writing", async () => {
  let writes = 0;
  const fetchImpl = async (url, init) => {
    if (init.method === "POST") writes += 1;
    const data = String(url).endsWith("/2/users/me") ? { id: "12", username: "cy" } : [];
    return { ok: true, json: async () => ({ data }) };
  };
  const request = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "x_reply", arguments: { reply_id: "999", text: "你好" } } };
  const result = await handleXMcP(request, { env, fetchImpl });
  assert.equal(result.body.result.isError, true);
  assert.equal(writes, 0);
});
