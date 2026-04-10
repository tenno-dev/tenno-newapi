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
const customDomainMatch = wranglerConfigRaw.match(
  /"pattern"\s*:\s*"([^"]+)"\s*,\s*"custom_domain"\s*:\s*true/
);
const customDomain = customDomainMatch?.[1]?.trim();

if (!workerName) {
  console.error("Could not determine worker name from wrangler.jsonc");
  process.exit(1);
}

const token = process.env.DEPLOY_TRIGGER_TOKEN || dotenv.DEPLOY_TRIGGER_TOKEN;

if (!token) {
  console.error("Missing DEPLOY_TRIGGER_TOKEN for post-deploy translation sync");
  process.exit(1);
}

const configuredBaseUrl = process.env.WORKER_DEPLOY_URL || dotenv.WORKER_DEPLOY_URL || "";
const workersDevBaseUrl = `https://${workerName}.mybitti.workers.dev`;
const customDomainBaseUrl = customDomain
  ? customDomain.startsWith("http")
    ? customDomain
    : `https://${customDomain}`
  : "";

const baseUrlCandidates = [configuredBaseUrl, customDomainBaseUrl, workersDevBaseUrl].filter(Boolean);

let lastError = null;

for (const baseUrl of baseUrlCandidates) {
  const url = `${baseUrl.replace(/\/$/, "")}/internal/translations/sync`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();

  if (response.ok) {
    console.log(`Post-deploy translation sync triggered successfully at ${url}`);
    console.log(text);
    process.exit(0);
  }

  // If this URL is stale (common when workers.dev is disabled), try the next candidate.
  if (response.status === 404) {
    lastError = `Post-deploy translation sync returned 404 at ${url}`;
    continue;
  }

  console.error(`Post-deploy translation sync failed: ${response.status} ${response.statusText}`);
  console.error(text);
  process.exit(1);
}

console.error(lastError ?? "Post-deploy translation sync failed: no valid target URL available");
process.exit(1);
