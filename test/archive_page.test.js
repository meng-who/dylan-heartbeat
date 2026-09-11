const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function renderArchivePageFromSource() {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const functionStart = source.indexOf("function archivePageHtml()");
  const tick = String.fromCharCode(96);
  const bodyStart = source.indexOf("return " + tick, functionStart) + 8;
  const bodyEnd = source.indexOf(tick + ";", bodyStart);
  assert.ok(functionStart >= 0 && bodyStart >= 8 && bodyEnd > bodyStart, "archivePageHtml template should exist");
  const body = source.slice(bodyStart, bodyEnd);
  return new Function("return " + tick + body + tick + ";")();
}

test("archive page client script is valid JavaScript", () => {
  const html = renderArchivePageFromSource();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "archive page script should exist");
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /自主活动/);
});
