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

ensureDataDir();
console.log(`[storage] DATA_DIR=${DATA_DIR}`);

module.exports = {
  DATA_DIR,
  dataPath,
  ensureDataDir,
  resolveDataPath
};
