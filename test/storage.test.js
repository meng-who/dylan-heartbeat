const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { writeJsonAtomicSync } = require("../storage");

test("atomic JSON writes preserve the previous version as a backup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dylan-heartbeat-data-"));
  const file = path.join(directory, "state.json");

  try {
    writeJsonAtomicSync(file, { version: 1 });
    writeJsonAtomicSync(file, { version: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { version: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8")), { version: 1 });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
