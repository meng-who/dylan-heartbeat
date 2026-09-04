const test = require("node:test");
const assert = require("node:assert/strict");

const { OmbreMcpClient, hasRecallEvidence, normalizeMcpUrl } = require("../ombre_mcp_client");

test("normalizes an Ombre service URL to its MCP endpoint", () => {
  assert.equal(normalizeMcpUrl("https://ombre.example.com"), "https://ombre.example.com/mcp");
  assert.equal(normalizeMcpUrl("https://ombre.example.com/mcp"), "https://ombre.example.com/mcp");
});

test("initializes stateless MCP and calls only the high-arousal read tool", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ body, headers: init.headers });
    if (body.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } });
    }
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    return Response.json({
      jsonrpc: "2.0", id: body.id,
      result: { content: [{ type: "text", text: "真实记忆：很长的一段高唤醒回忆，包含足够的上下文证据。".repeat(4) }] }
    });
  };
  const client = new OmbreMcpClient({ url: "https://ombre.example.com", token: "secret", fetchImpl });
  const result = await client.recallHighArousal({ query: "拥抱" });

  assert.equal(calls[0].headers.authorization, "Bearer secret");
  assert.equal(calls[2].body.method, "tools/call");
  assert.equal(calls[2].body.params.name, "breath_advanced");
  assert.equal(calls[2].body.params.arguments.arousal, 0.85);
  assert.match(result, /真实记忆/);
});

test("rejects write tools even when a caller asks for one", async () => {
  const client = new OmbreMcpClient({ url: "https://ombre.example.com", token: "secret", fetchImpl: async () => { throw new Error("should not fetch"); } });
  await assert.rejects(() => client.callReadTool("hold", { content: "不要写" }), /不允许调用写工具/);
});

test("detects whether Ombre returned usable recall evidence", () => {
  assert.equal(hasRecallEvidence("暂无相关记忆"), false);
  assert.equal(hasRecallEvidence("一段有明确来龙去脉的真实记忆。".repeat(10)), true);
});
