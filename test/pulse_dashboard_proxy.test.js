const test = require("node:test");
const assert = require("node:assert/strict");

const {
  fetchPulseDashboard,
  rewriteDashboardHtml,
  rewriteLocation,
  rewriteSetCookie
} = require("../pulse_dashboard_proxy");

test("rewrites dashboard routes to stay on the Render proxy", () => {
  const html = '<form action="/body/login"></form><script>fetch(\'/api/state\'); fetch(\'/api/solo/settings\'); location.href = \'/body\';</script>';
  const rewritten = rewriteDashboardHtml(html);
  assert.match(rewritten, /action="\/pulse\/login"/);
  assert.match(rewritten, /fetch\('\/pulse\/api\/state'/);
  assert.match(rewritten, /fetch\('\/pulse\/api\/solo\/settings'/);
  assert.match(rewritten, /location\.href = '\/pulse'/);
});

test("forwards Solo settings as JSON without exposing the Pulse client key", async () => {
  let request;
  await fetchPulseDashboard({
    baseUrl: "https://pulse.example.com",
    targetPath: "/api/solo/settings",
    method: "POST",
    cookie: "pulse_session=signed",
    contentType: "application/json",
    body: JSON.stringify({ enabled: true, threshold: 0.8 }),
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(request.url, "https://pulse.example.com/api/solo/settings");
  assert.equal(request.init.headers.get("content-type"), "application/json");
  assert.equal(request.init.headers.get("accept"), "application/json");
  assert.equal(request.init.headers.has("authorization"), false);
  assert.deepEqual(JSON.parse(request.init.body), { enabled: true, threshold: 0.8 });
});

test("rewrites Cloudflare redirects and cookie scope", () => {
  assert.equal(rewriteLocation("/body"), "/pulse");
  assert.equal(rewriteSetCookie("pulse_session=x; Path=/; HttpOnly; Secure"), "pulse_session=x; Path=/pulse; HttpOnly; Secure");
});

test("forwards login safely without exposing the Pulse client key", async () => {
  let request;
  const result = await fetchPulseDashboard({
    baseUrl: "https://pulse.example.com",
    targetPath: "/body/login",
    method: "POST",
    cookie: "old=1",
    contentType: "application/x-www-form-urlencoded",
    body: "password=secret",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(null, {
        status: 303,
        headers: {
          location: "/body",
          "set-cookie": "pulse_session=signed; Path=/; HttpOnly; Secure; SameSite=Strict"
        }
      });
    }
  });
  assert.equal(request.url, "https://pulse.example.com/body/login");
  assert.equal(request.init.headers.has("authorization"), false);
  assert.equal(result.location, "/pulse");
  assert.match(result.setCookie, /Path=\/pulse/);
});
