function normalizedIp(value) {
  return String(value || "").replace(/^::ffff:/, "");
}

function isLoopbackIp(value) {
  const ip = normalizedIp(value);
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

function isPrivateIp(value) {
  const ip = normalizedIp(value);
  return isLoopbackIp(ip) || /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
}

function decideRequestAccess({
  path,
  ip,
  isCloudRuntime,
  allowPublicApi,
  configuredKey,
  authorization,
  headerKey
}) {
  const requestPath = String(path || "").split("?")[0];
  if (requestPath.startsWith("/admin") || requestPath.startsWith("/pulse") || requestPath === "/healthz" || requestPath === "/test-bark") {
    return { allow: true };
  }

  const bearer = String(authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const alternate = String(headerKey || "").trim();
  const hasGatewayKey = Boolean(configuredKey) && (bearer === configuredKey || alternate === configuredKey);

  if (requestPath.startsWith("/internal/")) {
    return isLoopbackIp(ip) || hasGatewayKey
      ? { allow: true }
      : { allow: false, status: 403, error: "Forbidden" };
  }

  if (allowPublicApi && requestPath.startsWith("/v1/")) {
    if (!configuredKey) {
      return { allow: false, status: 401, error: "公网 /v1 已开启，但 GATEWAY_API_KEY 未配置", authRejected: true };
    }
    if (hasGatewayKey) return { allow: true };
    return {
      allow: false,
      status: 401,
      error: "Gateway API Key 无效或缺失",
      authRejected: true,
      authSource: bearer ? "bearer" : alternate ? "x-api-key" : "missing"
    };
  }

  if (isLoopbackIp(ip) || (!isCloudRuntime && isPrivateIp(ip))) return { allow: true };
  return { allow: false, status: 403, error: "Forbidden" };
}

module.exports = { decideRequestAccess, isLoopbackIp, isPrivateIp };
