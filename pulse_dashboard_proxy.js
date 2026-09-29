function joinPulseUrl(baseUrl, pathname) {
  const target = new URL(baseUrl);
  target.pathname = pathname;
  target.search = "";
  return target.toString();
}

const UNIFIED_DASHBOARD_STYLE = `<style id="dylan-unified-dashboard-style">
  html.dylan-hub-archive-open, html.dylan-hub-archive-open body { overflow: hidden !important; }
  .dylan-hub-bar {
    position: fixed; right: 50%; bottom: max(10px, env(safe-area-inset-bottom)); z-index: 2147483647;
    display: grid; grid-template-columns: 1fr 1fr; width: min(360px, calc(100% - 24px));
    padding: 5px; border: 1px solid rgba(199, 150, 166, .42); border-radius: 8px;
    background: rgba(47, 31, 39, .94); box-shadow: 0 10px 30px rgba(25, 12, 18, .28);
    backdrop-filter: blur(14px); transform: translateX(50%);
  }
  .dylan-hub-tab {
    appearance: none !important; width: auto !important; min-height: 40px !important; margin: 0 !important;
    border: 0 !important; border-radius: 5px !important; padding: 8px 12px !important;
    color: #d8c8cf !important; background: transparent !important; box-shadow: none !important;
    font: 600 14px/1.2 system-ui, "PingFang SC", sans-serif !important; letter-spacing: 0 !important;
    text-transform: none !important; cursor: pointer;
  }
  .dylan-hub-tab[aria-selected="true"] { color: #351f29 !important; background: #f1dbe3 !important; }
  .dylan-hub-bar.is-archive {
    border-color: rgba(196, 151, 165, .5); background: rgba(251, 248, 249, .96);
    box-shadow: 0 8px 24px rgba(78, 45, 57, .16);
  }
  .dylan-hub-bar.is-archive .dylan-hub-tab { color: #785665 !important; }
  .dylan-hub-bar.is-archive .dylan-hub-tab[aria-selected="true"] { color: #fff !important; background: #875266 !important; }
  .dylan-hub-archive {
    position: fixed; inset: 0 0 0 0; z-index: 2147483646; display: none;
    width: 100%; height: 100%; border: 0; background: #fbf8f9;
  }
  .dylan-hub-archive.is-visible { display: block; }
</style>`;

const UNIFIED_DASHBOARD_MARKUP = `<nav class="dylan-hub-bar" aria-label="Dylan 后台页面">
  <button id="dylan-hub-pulse" class="dylan-hub-tab" type="button" aria-selected="true">身体状态</button>
  <button id="dylan-hub-archive" class="dylan-hub-tab" type="button" aria-selected="false">Archive</button>
</nav>
<iframe id="dylan-hub-archive-frame" class="dylan-hub-archive" title="Dylan Archive"></iframe>
<script id="dylan-unified-dashboard-script">
  (() => {
    const pulseTab = document.getElementById("dylan-hub-pulse");
    const archiveTab = document.getElementById("dylan-hub-archive");
    const archiveFrame = document.getElementById("dylan-hub-archive-frame");
    const tabBar = pulseTab.closest(".dylan-hub-bar");
    const select = (showArchive) => {
      pulseTab.setAttribute("aria-selected", String(!showArchive));
      archiveTab.setAttribute("aria-selected", String(showArchive));
      document.documentElement.classList.toggle("dylan-hub-archive-open", showArchive);
      tabBar.classList.toggle("is-archive", showArchive);
      archiveFrame.classList.toggle("is-visible", showArchive);
      if (showArchive && !archiveFrame.dataset.loaded) {
        archiveFrame.src = "/admin/archive?embedded=1";
        archiveFrame.dataset.loaded = "true";
      }
    };
    pulseTab.addEventListener("click", () => select(false));
    archiveTab.addEventListener("click", () => select(true));
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
