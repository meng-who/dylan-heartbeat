const { spawn } = require("child_process");

const processes = [
  ["gateway", "start_with_models_proxy.js"],
  ["wake-up", "wake_up.js"]
];

function startProcess(name, script) {
  const child = spawn(process.execPath, [script], {
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", (code, signal) => {
    console.error(`${name} exited`, { code, signal });
    process.exit(code || 1);
  });

  return child;
}

for (const [name, script] of processes) {
  startProcess(name, script);
}

process.on("SIGTERM", () => {
  process.exit(0);
});

process.on("SIGINT", () => {
  process.exit(0);
});
