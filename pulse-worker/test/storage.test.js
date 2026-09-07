import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultState } from "../src/pulse.js";
import { listEvents, saveState } from "../src/storage.js";

function statement(sql) {
  return {
    sql,
    values: [],
    bind(...values) { this.values = values; return this; },
    async run() { return { success: true }; },
    async all() { return { results: [] }; }
  };
}

test("storage never inserts quiet heartbeat rows", async () => {
  const prepared = [];
  const db = {
    prepare(sql) { const item = statement(sql); prepared.push(item); return item; },
    async batch(items) { this.batchItems = items; return items.map(() => ({ success: true })); }
  };
  await saveState(db, "default", createDefaultState(1000), [
    { type: "heartbeat", summary: "quiet" },
    { type: "emotion", summary: "情绪底色转为「开心」" }
  ]);
  assert.equal(db.batchItems.length, 2);
  assert.match(db.batchItems[1].sql, /INSERT INTO pulse_events/);
  assert.equal(db.batchItems[1].values[2], "emotion");
  assert.ok(prepared.some(item => /event_type = 'heartbeat'/.test(item.sql)));
});

test("event listing hides legacy heartbeat rows", async () => {
  const db = {
    prepare(sql) {
      const item = statement(sql);
      item.all = async () => ({ results: [
        { created_at: 2, event_type: "heartbeat", summary: "quiet", snapshot_json: "{}" },
        { created_at: 1, event_type: "emotion", summary: "开心", snapshot_json: "{}" }
      ] });
      return item;
    }
  };
  const events = await listEvents(db, "default", 30);
  assert.deepEqual(events.map(event => event.event_type), ["emotion"]);
});
