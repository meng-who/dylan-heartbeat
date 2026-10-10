const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("dream preview keeps newline escapes valid after the admin template renders", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(source.includes(String.raw`result.dream + "\\n\\n概要："`));
  assert.ok(source.includes(String.raw`"\\n模型：" + result.model`));
  assert.ok(source.includes(String.raw`"\\n素材：" +`));
});
