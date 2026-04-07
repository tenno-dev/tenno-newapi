import fs from "node:fs";
import path from "node:path";

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const env = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }

  return env;
}

const repoRoot = process.cwd();
const dotenv = readDotEnv(path.join(repoRoot, ".env"));
const wranglerConfigRaw = fs.readFileSync(path.join(repoRoot, "wrangler.jsonc"), "utf8");
const workerNameMatch = wranglerConfigRaw.match(/"name"\s*:\s*"([^"]+)"/);
const workerName = workerNameMatch?.[1];

if (!workerName) {
  console.error("Could not determine worker name from wrangler.jsonc");
  process.exit(1);
}

const workerBaseUrl = process.env.WORKER_DEPLOY_URL || dotenv.WORKER_DEPLOY_URL || `https://${workerName}.mybitti.workers.dev`;
const token = process.env.DEPLOY_TRIGGER_TOKEN || dotenv.DEPLOY_TRIGGER_TOKEN;

if (!token) {
  console.error("Missing DEPLOY_TRIGGER_TOKEN for post-deploy translation sync");
  process.exit(1);
}

const url = `${workerBaseUrl}/internal/translations/sync`;
const response = await fetch(url, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
  },
});

const text = await response.text();

if (!response.ok) {
  console.error(`Post-deploy translation sync failed: ${response.status} ${response.statusText}`);
  console.error(text);
  process.exit(1);
}

console.log(`Post-deploy translation sync triggered successfully at ${url}`);
console.log(text);
