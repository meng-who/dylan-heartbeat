const { spawn } = require("child_process");

function startGateway() {
  const child = spawn(process.execPath, ["start_with_models_proxy.js"], {
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", (code, signal) => {
    console.error("gateway exited", { code, signal });
    process.exit(code || 1);
  });
}

function startWakeUp() {
  const child = spawn(process.execPath, ["wake_up.js"], {
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", (code, signal) => {
    console.error("wake-up exited; restarting in 5 seconds", { code, signal });
    setTimeout(startWakeUp, 5000);
  });
}

startGateway();
startWakeUp();

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
