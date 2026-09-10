const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  appendWakeArchive,
  buildWakeArchiveOutcome,
  decryptArchiveLine,
  deleteWakeArchiveRecord,
  encryptArchiveRecord,
  parseArchiveKey,
  readWakeArchive
} = require("../wake_archive");

test("encrypts archive records without leaving plaintext on disk", () => {
  const key = crypto.randomBytes(32);
  const line = encryptArchiveRecord({ id: "one", candidate: "这是一条秘密推送" }, key);
  assert.doesNotMatch(line, /秘密推送/);
  assert.deepEqual(decryptArchiveLine(line, key), { id: "one", candidate: "这是一条秘密推送" });
});

test("accepts a generated Base64URL archive key", () => {
  const encoded = crypto.randomBytes(32).toString("base64url");
  assert.equal(parseArchiveKey(encoded).length, 32);
  assert.equal(parseArchiveKey("too-short"), null);
});

test("appends, searches, filters and deletes encrypted records", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wake-archive-"));
  const filePath = path.join(directory, "archive.enc.jsonl");
  const key = crypto.randomBytes(32);

  try {
    appendWakeArchive({ id: "sent", status: "sent", candidate: "键盘到货了吗" }, { key, filePath });
    appendWakeArchive({ id: "blocked", status: "rejected", candidate: "上午好" }, { key, filePath });

    assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /键盘|上午好/);
    assert.deepEqual(readWakeArchive({ key, filePath, status: "sent" }).records.map(item => item.id), ["sent"]);
    assert.deepEqual(readWakeArchive({ key, filePath, query: "上午" }).records.map(item => item.id), ["blocked"]);
    assert.deepEqual(deleteWakeArchiveRecord("sent", { key, filePath }), { deleted: true });
    assert.deepEqual(readWakeArchive({ key, filePath }).records.map(item => item.id), ["blocked"]);
    assert.equal(fs.existsSync(`${filePath}.bak`), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("fails closed when the archive key is absent", () => {
  assert.deepEqual(appendWakeArchive({ candidate: "not saved" }, { env: {} }), {
    saved: false,
    reason: "not_configured"
  });
});

test("classifies sent, blocked and silent wake outcomes", () => {
  assert.deepEqual(
    buildWakeArchiveOutcome("（2026-09-10 12:00 刚刚给用户发了Bark推送：Dylan｜中午好。）"),
    { status: "sent", reason: "", final_title: "Dylan", final_body: "中午好。" }
  );
  assert.equal(
    buildWakeArchiveOutcome("（2026-09-10 12:00 自动唤醒：本次未发送推送｜原因：与近期推送含义重复）").status,
    "duplicate"
  );
  assert.equal(
    buildWakeArchiveOutcome("（2026-09-10 12:00 自动唤醒：本次未发送推送）", { noAction: true }).status,
    "no_action"
  );
});
