function joinPulseUrl(baseUrl, pathname) {
  const target = new URL(baseUrl);
  target.pathname = pathname;
  target.search = "";
  return target.toString();
}

function rewriteDashboardHtml(html) {
  return String(html || "")
    .replaceAll('action="/body/login"', 'action="/pulse/login"')
    .replaceAll("fetch('/api/state'", "fetch('/pulse/api/state'")
    .replaceAll("fetch('/api/solo/settings'", "fetch('/pulse/api/solo/settings'")
    .replaceAll("location.href = '/body'", "location.href = '/pulse'");
}

function rewriteLocation(location) {
  if (location === "/body") return "/pulse";
  if (location?.startsWith("/body/")) return `/pulse${location.slice(5)}`;
  return location;
}

function rewriteSetCookie(cookie) {
  return String(cookie || "").replace(/Path=\/(?:;|$)/i, "Path=/pulse;");
}

async function fetchPulseDashboard({
  baseUrl,
  targetPath,
  method = "GET",
  cookie = "",
  contentType = "",
  body,
  fetchImpl = fetch
}) {
  if (!baseUrl) throw new Error("PULSE_WORKER_URL 未配置");
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", targetPath.startsWith("/api/") ? "application/json" : "text/html");
  const response = await fetchImpl(joinPulseUrl(baseUrl, targetPath), {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
    redirect: "manual"
  });
  const responseType = response.headers.get("content-type") || "application/octet-stream";
  const raw = await response.arrayBuffer();
  const responseBody = responseType.includes("text/html")
    ? new TextEncoder().encode(rewriteDashboardHtml(new TextDecoder().decode(raw)))
    : new Uint8Array(raw);
  return {
    status: response.status,
    body: responseBody,
    contentType: responseType,
    cacheControl: response.headers.get("cache-control") || "no-store",
    location: rewriteLocation(response.headers.get("location")),
    setCookie: rewriteSetCookie(response.headers.get("set-cookie"))
  };
}

module.exports = {
  fetchPulseDashboard,
  joinPulseUrl,
  rewriteDashboardHtml,
  rewriteLocation,
  rewriteSetCookie
};
