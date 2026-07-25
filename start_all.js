const { spawn } = require("child_process");

function startProcess(name, script, exitServiceOnStop) {
  console.log(`[start_all] starting ${name}: ${script}`);

  const child = spawn(process.execPath, [script], {
    stdio: "inherit",
    env: process.env,
    cwd: __dirname
  });

  child.on("exit", (code, signal) => {
    console.error(`[start_all] ${name} exited`, { code, signal });

    if (exitServiceOnStop) {
      process.exit(code || 1);
    }

    setTimeout(() => {
      startProcess(name, script, exitServiceOnStop);
    }, 5000);
  });
}

startProcess("gateway", "start_with_models_proxy.js", true);
startProcess("wake-up", "wake_up.js", false);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
