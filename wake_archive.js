const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { dataPath } = require("./storage");
const { extractSentPush } = require("./wake_dedup");

const ARCHIVE_VERSION = 1;
const DEFAULT_ARCHIVE_PATH = dataPath("wake_archive.enc.jsonl");

function parseArchiveKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else {
    try {
      key = Buffer.from(raw, "base64url");
    } catch {
      return null;
    }
  }
  return key.length === 32 ? key : null;
}

function archiveConfigured(env = process.env) {
  return Boolean(parseArchiveKey(env.WAKE_ARCHIVE_KEY));
}

function buildWakeArchiveOutcome(eventContent, options = {}) {
  const event = String(eventContent || "");
  const sentPush = extractSentPush(event);
  const reason = event.match(/原因[：:]([\s\S]*?)[）)]\s*$/)?.[1]?.trim() || "";
  let status = "not_sent";
  if (sentPush) status = "sent";
  else if (reason.includes("重复")) status = "duplicate";
  else if (reason.includes("推送失败")) status = "push_failed";
  else if (reason.includes("模型时间表述")) status = "rejected";
  else if (options.noAction) status = "no_action";
  else if (reason.includes("只写日记")) status = "diary_only";
  else if (reason.includes("空回复") || reason.includes("内容为空")) status = "empty";
  return {
    status,
    reason,
    final_title: sentPush?.title || "",
    final_body: sentPush?.body || ""
  };
}

function encryptArchiveRecord(record, keyValue) {
  const key = Buffer.isBuffer(keyValue) ? keyValue : parseArchiveKey(keyValue);
  if (!key) throw new Error("WAKE_ARCHIVE_KEY 必须是 32 字节的 Base64URL 或 64 位十六进制密钥");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`wake-archive-v${ARCHIVE_VERSION}`));
  const plaintext = Buffer.from(JSON.stringify(record), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({
    v: ARCHIVE_VERSION,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: ciphertext.toString("base64url")
  });
}

function decryptArchiveLine(line, keyValue) {
  const key = Buffer.isBuffer(keyValue) ? keyValue : parseArchiveKey(keyValue);
  if (!key) throw new Error("WAKE_ARCHIVE_KEY 无效或未配置");
  const envelope = JSON.parse(String(line || ""));
  if (envelope.v !== ARCHIVE_VERSION) throw new Error(`不支持的档案版本：${envelope.v}`);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64url")
  );
  decipher.setAAD(Buffer.from(`wake-archive-v${ARCHIVE_VERSION}`));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64url")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function archiveFilePath(configuredPath) {
  return configuredPath ? path.resolve(configuredPath) : DEFAULT_ARCHIVE_PATH;
}

function appendWakeArchive(record, options = {}) {
  const key = options.key || parseArchiveKey((options.env || process.env).WAKE_ARCHIVE_KEY);
  if (!key) return { saved: false, reason: "not_configured" };
  const filePath = archiveFilePath(options.filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const entry = {
    id: record.id || crypto.randomUUID(),
    created_at: record.created_at || new Date().toISOString(),
    ...record
  };
  fs.appendFileSync(filePath, `${encryptArchiveRecord(entry, key)}\n`, "utf8");
  return { saved: true, id: entry.id };
}

function readArchiveLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
}

function readWakeArchive(options = {}) {
  const key = options.key || parseArchiveKey((options.env || process.env).WAKE_ARCHIVE_KEY);
  if (!key) throw new Error("WAKE_ARCHIVE_KEY 无效或未配置");
  const filePath = archiveFilePath(options.filePath);
  const query = String(options.query || "").trim().toLowerCase();
  const status = String(options.status || "").trim();
  const kind = String(options.kind || "").trim();
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
  let unreadable = 0;

  const records = readArchiveLines(filePath).map(line => {
    try {
      return decryptArchiveLine(line, key);
    } catch {
      unreadable++;
      return null;
    }
  }).filter(Boolean).reverse().filter(record => {
    if (status && record.status !== status) return false;
    if (kind && (record.kind || "wake") !== kind) return false;
    if (!query) return true;
    return [
      record.kind,
      record.candidate,
      record.final_title,
      record.final_body,
      record.reason,
      record.model,
      record.status,
      record.mode,
      record.summary,
      record.narrative
    ].some(value => String(value || "").toLowerCase().includes(query));
  }).slice(0, limit);

  return { records, unreadable, configured: true };
}

function writeLinesAtomic(filePath, lines) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const backup = `${filePath}.bak`;
  const content = lines.length ? `${lines.join("\n")}\n` : "";
  fs.writeFileSync(temporary, content, "utf8");
  try {
    if (fs.existsSync(backup)) fs.unlinkSync(backup);
    if (fs.existsSync(filePath)) fs.renameSync(filePath, backup);
    fs.renameSync(temporary, filePath);
    if (fs.existsSync(backup)) fs.unlinkSync(backup);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    try {
      if (!fs.existsSync(filePath) && fs.existsSync(backup)) fs.renameSync(backup, filePath);
    } catch {}
    throw error;
  }
}

function deleteWakeArchiveRecord(id, options = {}) {
  const key = options.key || parseArchiveKey((options.env || process.env).WAKE_ARCHIVE_KEY);
  if (!key) throw new Error("WAKE_ARCHIVE_KEY 无效或未配置");
  const filePath = archiveFilePath(options.filePath);
  const lines = readArchiveLines(filePath);
  let deleted = false;
  const retained = lines.filter(line => {
    try {
      const record = decryptArchiveLine(line, key);
      if (record.id === id) {
        deleted = true;
        return false;
      }
    } catch {}
    return true;
  });
  if (deleted) writeLinesAtomic(filePath, retained);
  return { deleted };
}

module.exports = {
  DEFAULT_ARCHIVE_PATH,
  appendWakeArchive,
  archiveConfigured,
  archiveFilePath,
  buildWakeArchiveOutcome,
  decryptArchiveLine,
  deleteWakeArchiveRecord,
  encryptArchiveRecord,
  parseArchiveKey,
  readWakeArchive
};
