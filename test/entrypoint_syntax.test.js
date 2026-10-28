const test = require("node:test");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

for (const file of ["wake_up.js", "server.js", "start_all.js", "start_with_models_proxy.js"]) {
  test(`runtime entrypoint parses without starting services: ${file}`, () => {
    execFileSync(process.execPath, ["--check", path.join(__dirname, "..", file)], {
      stdio: "pipe",
      timeout: 10000
    });
  });
}
