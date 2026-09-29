function joinPulseUrl(baseUrl, pathname) {
  const target = new URL(baseUrl);
  target.pathname = pathname;
  target.search = "";
  return target.toString();
}

const UNIFIED_DASHBOARD_STYLE = `<style id="dylan-unified-dashboard-style">
  .dylan-hub-bar {
    position: fixed; right: 50%; bottom: max(10px, env(safe-area-inset-bottom)); z-index: 2147483647;
    display: grid; grid-template-columns: 1fr 1fr; width: min(360px, calc(100% - 24px));
    padding: 5px; border: 1px solid rgba(199, 150, 166, .42); border-radius: 8px;
    background: rgba(47, 31, 39, .94); box-shadow: 0 10px 30px rgba(25, 12, 18, .28);
    backdrop-filter: blur(14px); transform: translateX(50%);
  }
  .dylan-hub-tab {
    appearance: none !important; display: grid !important; place-items: center !important;
    width: auto !important; min-height: 40px !important; margin: 0 !important;
    border: 0 !important; border-radius: 5px !important; padding: 8px 12px !important;
    color: #d8c8cf !important; background: transparent !important; box-shadow: none !important;
    font: 600 14px/1.2 system-ui, "PingFang SC", sans-serif !important; letter-spacing: 0 !important;
    text-transform: none !important; text-decoration: none !important; cursor: pointer;
  }
  .dylan-hub-tab[aria-current="page"] { color: #351f29 !important; background: #f1dbe3 !important; }
</style>`;

const UNIFIED_DASHBOARD_MARKUP = `<nav class="dylan-hub-bar" aria-label="Dylan 后台页面">
  <a id="dylan-hub-pulse" class="dylan-hub-tab" href="/pulse" aria-current="page">身体状态</a>
  <a id="dylan-hub-archive" class="dylan-hub-tab" href="/admin/archive">Archive</a>
</nav>
<script id="dylan-unified-dashboard-script">
  (() => {
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta && !viewportMeta.content.includes("viewport-fit")) {
      viewportMeta.content += ", viewport-fit=cover";
    }
  })();
</script>`;

function rewriteDashboardHtml(html) {
  let rewritten = String(html || "")
    .replaceAll('action="/body/login"', 'action="/pulse/login"')
    .replaceAll("fetch('/api/state'", "fetch('/pulse/api/state'")
    .replaceAll("fetch('/api/solo/settings'", "fetch('/pulse/api/solo/settings'")
    .replaceAll("location.href = '/body'", "location.href = '/pulse'");
  if (rewritten.includes("dylan-unified-dashboard-script")) return rewritten;
  rewritten = /<\/head>/i.test(rewritten)
    ? rewritten.replace(/<\/head>/i, `${UNIFIED_DASHBOARD_STYLE}</head>`)
    : `${UNIFIED_DASHBOARD_STYLE}${rewritten}`;
  return /<\/body>/i.test(rewritten)
    ? rewritten.replace(/<\/body>/i, `${UNIFIED_DASHBOARD_MARKUP}</body>`)
    : `${rewritten}${UNIFIED_DASHBOARD_MARKUP}`;
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
