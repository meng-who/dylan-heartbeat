import test from "node:test";
import assert from "node:assert/strict";

import { dashboardPage } from "../src/dashboard.js";

test("dashboard client script is valid JavaScript", () => {
  const html = dashboardPage();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "dashboard script should exist");
  assert.doesNotThrow(() => new Function(script));
});
