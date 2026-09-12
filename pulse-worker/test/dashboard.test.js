import test from "node:test";
import assert from "node:assert/strict";

import { createSessionCookie, dashboardPage, hasValidSession } from "../src/dashboard.js";

test("dashboard client script is valid JavaScript", () => {
  const html = dashboardPage();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "dashboard script should exist");
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /查看完整经过/);
  assert.match(html, /latest\.narrative/);
  assert.match(html, /narrativeWasOpen/);
});

test("dashboard login persists on mobile browsers for 180 days", async () => {
  const cookie = await createSessionCookie("test-session-secret");
  assert.match(cookie, /Max-Age=15552000/);
  assert.match(cookie, /Expires=/);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);

  const token = cookie.match(/^pulse_session=([^;]+)/)?.[1];
  const request = new Request("https://pulse.example.com/body", {
    headers: { cookie: `pulse_session=${token}` }
  });
  assert.equal(await hasValidSession(request, "test-session-secret"), true);
});
