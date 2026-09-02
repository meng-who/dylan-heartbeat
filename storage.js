const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function dataPath(...parts) {
  ensureDataDir();
  return path.join(DATA_DIR, ...parts);
}

function resolveDataPath(configuredPath, fallbackName) {
  const value = String(configuredPath || fallbackName || "").trim();
  if (!value) return dataPath(fallbackName);
  if (path.isAbsolute(value)) return value;
  return dataPath(value);
}

function writeJsonAtomicSync(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const backup = `${filePath}.bak`;

  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backup);
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {}
    throw error;
  }
}

ensureDataDir();
console.log(`[storage] DATA_DIR=${DATA_DIR}`);

module.exports = {
  DATA_DIR,
  dataPath,
  ensureDataDir,
  resolveDataPath,
  writeJsonAtomicSync
};
