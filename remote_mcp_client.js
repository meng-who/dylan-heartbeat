function parseMcpPayload(text, contentType = "") {
  const input = String(text || "").trim();
  if (!input) return null;
  if (contentType.includes("text/event-stream") || input.startsWith("data:")) {
    const payloads = input
      .split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim())
      .filter(value => value && value !== "[DONE]")
      .map(value => { try { return JSON.parse(value); } catch { return null; } })
      .filter(Boolean);
    return payloads.find(item => item.result || item.error) || payloads[0] || null;
  }
  return JSON.parse(input);
}

function authorizationHeader(token) {
  const value = String(token || "").trim();
  if (!value) return "";
  return /^\S+\s+/.test(value) ? value : `Bearer ${value}`;
}

class RemoteMcpClient {
  constructor({ url, token = "", timeoutMs = 15_000, fetchImpl = fetch, clientName = "dylan-activity" }) {
    this.url = new URL(String(url || "").trim()).toString();
    this.token = token;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 15_000);
    this.fetchImpl = fetchImpl;
    this.clientName = clientName;
    this.nextId = 1;
    this.sessionId = "";
    this.initialized = false;
  }

  async post(method, params = {}, notification = false) {
    const id = notification ? undefined : this.nextId++;
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    };
    const authorization = authorizationHeader(this.token);
    if (authorization) headers.authorization = authorization;
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const response = await this.fetchImpl(this.url, {
      method: "POST",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", ...(id == null ? {} : { id }), method, params })
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Remote MCP HTTP ${response.status}: ${responseText.slice(0, 240)}`);
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    if (notification || !responseText.trim()) return null;
    const decoded = parseMcpPayload(responseText, response.headers.get("content-type") || "");
    if (decoded?.error) throw new Error(`Remote MCP ${decoded.error.code || "error"}: ${decoded.error.message || "调用失败"}`);
    return decoded?.result ?? decoded;
  }

  async initialize() {
    if (this.initialized) return;
    await this.post("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: this.clientName, version: "1.0.0" }
    });
    await this.post("notifications/initialized", {}, true);
    this.initialized = true;
  }

  async listTools() {
    await this.initialize();
    const result = await this.post("tools/list");
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name, args = {}) {
    await this.initialize();
    const result = await this.post("tools/call", { name, arguments: args });
    if (result?.isError) {
      const detail = (result.content || []).map(item => item?.text || "").filter(Boolean).join(" ");
      throw new Error(`Remote MCP tool ${name} failed${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }
    return result;
  }
}

module.exports = { RemoteMcpClient, authorizationHeader, parseMcpPayload };
