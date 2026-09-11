const assert = require("node:assert/strict");
const test = require("node:test");

const { RemoteMcpClient, authorizationHeader, parseMcpPayload } = require("../remote_mcp_client");

test("keeps an exact remote MCP URL and uses bearer authorization", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26" } }), {
        headers: { "content-type": "application/json", "mcp-session-id": "session-1" }
      });
    }
    if (calls.length === 2) return new Response(null, { status: 202 });
    return new Response("data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"spotify_search\"}]}}\n\n", {
      headers: { "content-type": "text/event-stream" }
    });
  };
  const client = new RemoteMcpClient({ url: "https://example.test/custom/mcp?tenant=one", token: "secret", fetchImpl });
  const tools = await client.listTools();

  assert.deepEqual(tools.map(tool => tool.name), ["spotify_search"]);
  assert.equal(calls[0].url, "https://example.test/custom/mcp?tenant=one");
  assert.equal(calls[0].init.headers.authorization, "Bearer secret");
  assert.equal(calls[2].init.headers["mcp-session-id"], "session-1");
});

test("accepts a complete authorization value and parses SSE", () => {
  assert.equal(authorizationHeader("Token abc"), "Token abc");
  assert.deepEqual(parseMcpPayload("data: {\"result\":{\"ok\":true}}\n\n", "text/event-stream"), {
    result: { ok: true }
  });
});
