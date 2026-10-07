const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  appendWakeArchive,
  buildWakeArchiveOutcome,
  collectReadingHistory,
  decryptArchiveLine,
  deleteWakeArchiveRecord,
  encryptArchiveRecord,
  parseArchiveKey,
  readReadingHistory,
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
    appendWakeArchive({
      id: "solo",
      kind: "solo",
      status: "kept_private",
      mode: "mix",
      summary: "从真实回忆走进幻想",
      narrative: "这是一段完整的 Solo 经过"
    }, { key, filePath });

    assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /键盘|上午好|完整的 Solo/);
    assert.deepEqual(readWakeArchive({ key, filePath, status: "sent" }).records.map(item => item.id), ["sent"]);
    assert.deepEqual(readWakeArchive({ key, filePath, query: "上午" }).records.map(item => item.id), ["blocked"]);
    assert.deepEqual(readWakeArchive({ key, filePath, kind: "solo" }).records.map(item => item.id), ["solo"]);
    assert.deepEqual(readWakeArchive({ key, filePath, query: "完整的 Solo" }).records.map(item => item.id), ["solo"]);
    assert.deepEqual(deleteWakeArchiveRecord("sent", { key, filePath }), { deleted: true });
    assert.deepEqual(readWakeArchive({ key, filePath }).records.map(item => item.id), ["solo", "blocked"]);
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

test("builds a compact reading history from all recognizable successful archive records", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reading-history-"));
  const filePath = path.join(directory, "archive.enc.jsonl");
  const key = crypto.randomBytes(32);

  try {
    appendWakeArchive({
      kind: "activity",
      status: "success",
      source: "books",
      action: "book_reflect",
      book_id: "book-1",
      book_title: "潮汐旧信",
      chapter_no: 1,
      candidate: "没有固定格式的旧读后感",
      created_at: "2026-09-01T00:00:00.000Z"
    }, { key, filePath });
    appendWakeArchive({
      kind: "activity",
      status: "success",
      source: "books",
      action: "book_reflect",
      book_id: "book-1",
      book_title: "潮汐旧信",
      chapter_no: 3,
      candidate: "另一种写法也不影响识别",
      created_at: "2026-09-03T00:00:00.000Z"
    }, { key, filePath });
    appendWakeArchive({
      kind: "activity",
      status: "failed",
      source: "books",
      action: "book_reflect",
      book_id: "book-1",
      chapter_no: 4
    }, { key, filePath });
    appendWakeArchive({
      kind: "activity",
      status: "success",
      source: "spotify",
      book_id: "not-a-book",
      chapter_no: 1
    }, { key, filePath });

    const history = readReadingHistory({ key, filePath });
    assert.equal(history.unreadable, 0);
    assert.deepEqual(history.books, [{
      bookId: "book-1",
      title: "潮汐旧信",
      chapters: [1, 3],
      lastReadAt: "2026-09-03T00:00:00.000Z"
    }]);
    assert.deepEqual(collectReadingHistory([]), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
