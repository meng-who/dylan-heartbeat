const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ADMIN_SESSION_COOKIE,
  authorizeAdmin,
  buildAdminSessionCookie,
  createAdminSessionToken,
  verifyAdminSessionToken
} = require("../admin_auth");

const credentials = { user: "admin", password: "strong-password" };

test("accepts Basic auth and creates a persistent secure admin cookie", () => {
  const authorization = `Basic ${Buffer.from("admin:strong-password").toString("base64")}`;
  assert.deepEqual(authorizeAdmin({ authorization, cookie: "", ...credentials }), {
    authorized: true,
    source: "basic"
  });
  const cookie = buildAdminSessionCookie({ ...credentials, days: 30, secure: true, now: 0 });
  assert.match(cookie, new RegExp(`^${ADMIN_SESSION_COOKIE}=`));
  assert.match(cookie, /Max-Age=2592000/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
});

test("uses a six-month mobile session by default", () => {
  const cookie = buildAdminSessionCookie({ ...credentials, secure: true, now: 0 });
  assert.match(cookie, /Max-Age=15552000/);
});

test("accepts an unexpired signed admin session without Basic auth", () => {
  const now = Date.UTC(2026, 8, 12);
  const token = createAdminSessionToken({ ...credentials, days: 30, now });
  assert.deepEqual(authorizeAdmin({
    authorization: "",
    cookie: `${ADMIN_SESSION_COOKIE}=${token}`,
    now: now + 10_000,
    ...credentials
  }), { authorized: true, source: "session" });
});

test("password changes and expiry invalidate old admin sessions", () => {
  const now = Date.UTC(2026, 8, 12);
  const token = createAdminSessionToken({ ...credentials, days: 1, now });
  assert.equal(verifyAdminSessionToken(token, { ...credentials, now: now + 1000 }), true);
  assert.equal(verifyAdminSessionToken(token, { user: "admin", password: "changed", now: now + 1000 }), false);
  assert.equal(verifyAdminSessionToken(token, { ...credentials, now: now + 24 * 60 * 60 * 1000 }), false);
});
