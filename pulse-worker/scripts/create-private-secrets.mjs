import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const privateFile = ".pulse-private.json";

if (existsSync(privateFile)) {
  console.error(`${privateFile} already exists; refusing to replace your saved credentials.`);
  process.exit(1);
}

const pulseClientKey = `pulse_${randomBytes(24).toString("base64url")}`;
const dashboardPassword = randomBytes(12).toString("base64url");
const sessionSecret = randomBytes(32).toString("base64url");

function putSecret(name, value) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "secret", "put", name],
    {
    input: `${value}\n`,
    stdio: ["pipe", "inherit", "inherit"],
    shell: false,
    },
  );

  if (result.status !== 0) {
    throw new Error(`Could not store ${name} in Cloudflare.`);
  }
}

putSecret("PULSE_CLIENT_KEY", pulseClientKey);
putSecret("DASHBOARD_PASSWORD", dashboardPassword);
putSecret("SESSION_SECRET", sessionSecret);

writeFileSync(
  privateFile,
  `${JSON.stringify({ pulseClientKey, dashboardPassword }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);

console.log(`Saved the two user-facing credentials in ${privateFile}. Keep this file private.`);
