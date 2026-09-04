const READ_ONLY_TOOLS = new Set(["breath", "breath_search", "breath_advanced"]);

function normalizeMcpUrl(value) {
  const url = new URL(String(value || "").trim());
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/mcp`.replace(/\/mcp\/mcp$/, "/mcp");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseMcpPayload(text, contentType = "") {
  const input = String(text || "").trim();
  if (!input) return null;
  if (contentType.includes("text/event-stream") || input.startsWith("data:")) {
    const payloads = input
      .split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim())
      .filter(data => data && data !== "[DONE]")
      .map(data => { try { return JSON.parse(data); } catch { return null; } })
      .filter(Boolean);
    return payloads.find(item => item.result || item.error) || payloads[0] || null;
  }
  return JSON.parse(input);
}

class OmbreMcpClient {
  constructor({ url, token, timeoutMs = 12_000, fetchImpl = fetch }) {
    this.url = normalizeMcpUrl(url);
    this.token = String(token || "").trim();
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 12_000);
    this.fetchImpl = fetchImpl;
    this.nextId = 1;
    this.initialized = false;
    this.sessionId = "";
  }

  async post(method, params = {}, notification = false) {
    const id = notification ? undefined : this.nextId++;
    const payload = { jsonrpc: "2.0", ...(id == null ? {} : { id }), method, params };
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const response = await this.fetchImpl(this.url, {
      method: "POST",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers,
      body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Ombre MCP HTTP ${response.status}: ${responseText.slice(0, 240)}`);
    const returnedSession = response.headers.get("mcp-session-id");
    if (returnedSession) this.sessionId = returnedSession;
    if (notification || !responseText.trim()) return null;
    const decoded = parseMcpPayload(responseText, response.headers.get("content-type") || "");
    if (decoded?.error) throw new Error(`Ombre MCP ${decoded.error.code || "error"}: ${decoded.error.message || "调用失败"}`);
    return decoded?.result ?? decoded;
  }

  async initialize() {
    if (this.initialized) return;
    await this.post("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "dylan-solo", version: "1.0.0" }
    });
    await this.post("notifications/initialized", {}, true);
    this.initialized = true;
  }

  async callReadTool(name, args = {}) {
    if (!READ_ONLY_TOOLS.has(name)) throw new Error(`Solo 不允许调用写工具：${name}`);
    await this.initialize();
    const result = await this.post("tools/call", { name, arguments: args });
    if (result?.isError) throw new Error(`Ombre 工具 ${name} 返回错误`);
    return (result?.content || [])
      .filter(item => item?.type === "text")
      .map(item => String(item.text || ""))
      .join("\n")
      .trim();
  }

  async recallHighArousal({ query = "", maxResults = 3, maxTokens = 6000 } = {}) {
    return this.callReadTool("breath_advanced", {
      query: String(query || "").slice(0, 300),
      arousal: 0.85,
      max_results: Math.max(1, Math.min(5, Number(maxResults) || 3)),
      max_tokens: Math.max(500, Math.min(10_000, Number(maxTokens) || 6000))
    });
  }
}

function hasRecallEvidence(value) {
  const text = String(value || "").trim();
  if (text.length < 80) return false;
  return !/(?:没有找到|没有符合|暂无(?:相关)?记忆|记忆库(?:为空|里没有)|no (?:matching|relevant) memor)/i.test(text);
}

module.exports = { OmbreMcpClient, READ_ONLY_TOOLS, hasRecallEvidence, normalizeMcpUrl, parseMcpPayload };
