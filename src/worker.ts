// Pure Bun - No Node.js legacy modules used
import { RedisClient, SQL } from "bun";
import type { Bindings, QueueMessage } from "./app/types";
import { BunRedisKVStore } from "./adapters/kv/redis";
import { LocalBlobStore } from "./adapters/blob/local";
import { BunSQLClient } from "./adapters/sql/postgres";
import { BunRedisQueueClient } from "./adapters/queue/redis-streams";
import { handleQueueMessage } from "./queue/consumer";

const STREAM_KEY = "worldstate:translate";
const GROUP_NAME = "workers";
// Use a stable identity by default so recovery works across container restarts.
// For multiple workers, set WORKER_ID in docker-compose.yml
const CONSUMER_NAME = Bun.env.WORKER_ID || "worker-translate-1";
const MAX_RETRIES = Number(Bun.env.WORKER_MAX_RETRIES ?? "3");
const BLOCK_MS = 5000;
const READ_COUNT = 10;
const CONCURRENCY_LIMIT = 5; // Process up to 5 messages in parallel per consumer

const STREAM_ID_PATTERN = /^\d+-\d+$/;

type Resp3Object = Record<string, unknown>;

type StreamEntry = {
  id: string;
  fields: Record<string, string>;
};

function isMapLike(value: unknown): value is Map<unknown, unknown> {
  return value instanceof Map;
}

function isMessageTuple(value: unknown): value is [unknown, unknown] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    (typeof value[0] === "string" || typeof value[0] === "number") &&
    Array.isArray(value[1])
  );
}

function isStreamId(value: unknown): value is string {
  return typeof value === "string" && STREAM_ID_PATTERN.test(value);
}

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function asObject(value: unknown): Resp3Object | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Resp3Object;
}

function getEntries(value: unknown): Array<[string, unknown]> {
  if (isMapLike(value)) {
    return Array.from(value.entries()).map(([k, v]) => [String(k), v]);
  }

  const obj = asObject(value);
  if (!obj) return [];
  return Object.entries(obj);
}

function getValue(value: unknown, key: string): unknown {
  if (isMapLike(value)) {
    return value.get(key);
  }

  const obj = asObject(value);
  return obj ? obj[key] : undefined;
}

function toStringFields(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, fieldValue] of getEntries(value)) {
    out[key] = String(fieldValue ?? "");
  }
  return out;
}

function parseXReadGroupResp3(raw: unknown): StreamEntry[] {
  if (!raw) return [];

  const entries: StreamEntry[] = [];
  const messageLists: unknown[][] = [];

  // 1. Normalize the top-level structure (Map/Object per stream vs Array per stream)
  if (isMapLike(raw) || asObject(raw)) {
    for (const [, value] of getEntries(raw)) {
      if (Array.isArray(value)) messageLists.push(value);
    }
  } else if (Array.isArray(raw)) {
    // Basic array of [streamname, [[id, [field, val, ...]], ...]]
    for (const item of raw) {
      if (Array.isArray(item) && item.length >= 2 && Array.isArray(item[1])) {
        messageLists.push(item[1] as unknown[]);
      } else if (isMessageTuple(item)) {
        // Flat array of messages
        messageLists.push([item]);
      }
    }
  }

  // 2. Parse individual message entries
  for (const streamMessages of messageLists) {
    for (const message of streamMessages) {
      if (!message) continue;

      // Handle Map/Object style message
      const msgObj = isMapLike(message) || asObject(message);
      if (msgObj) {
        const idRaw = getValue(msgObj, "id");
        const id = String(idRaw ?? "");
        if (!id) continue;

        const rawFields = getValue(msgObj, "fields") || getValue(msgObj, "message") || msgObj;
        const fields = toStringFields(rawFields);
        
        // If body was a top-level field in RESP3 Map
        const bodyRaw = getValue(msgObj, "body");
        if (!fields.body && typeof bodyRaw === "string") {
          fields.body = bodyRaw;
        }

        entries.push({ id, fields });
        continue;
      }

      // Handle Tuple/Array style message: [id, [field1, val1, ...]]
      if (Array.isArray(message) && message.length >= 2) {
        const id = String(message[0] ?? "");
        if (!id) continue;

        const fieldTuples = Array.isArray(message[1]) ? message[1] : [];
        const fields: Record<string, string> = {};
        for (let i = 0; i + 1 < fieldTuples.length; i += 2) {
          fields[String(fieldTuples[i])] = String(fieldTuples[i + 1] ?? "");
        }

        entries.push({ id, fields });
      }
    }
  }

  return entries;
}

function extractRetryCount(payload: Resp3Object | null): number {
  const value = Number(payload?.__retryCount ?? 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function collectPotentialIds(raw: unknown, out: Set<string>): void {
  if (Array.isArray(raw)) {
    if (raw.length >= 2 && isStreamId(raw[0])) {
      out.add(raw[0]);
    }
    for (const item of raw) {
      collectPotentialIds(item, out);
    }
    return;
  }

  if (isMapLike(raw)) {
    for (const [key, value] of raw.entries()) {
      if (isStreamId(key)) {
        out.add(String(key));
      }
      collectPotentialIds(value, out);
    }
    return;
  }

  const obj = asObject(raw);
  if (!obj) return;

  for (const [key, value] of Object.entries(obj)) {
    if (isStreamId(key)) {
      out.add(key);
    }
    collectPotentialIds(value, out);
  }
}

function extractPotentialIds(raw: unknown): string[] {
  const ids = new Set<string>();
  collectPotentialIds(raw, ids);
  return Array.from(ids);
}

async function buildContext(): Promise<{ env: Bindings; redis: RedisClient }> {
  const redisUrl = Bun.env.REDIS_URL ?? "redis://localhost:6379";
  const databaseUrl = requireEnv("DATABASE_URL");
  const blobBasePath = Bun.env.BLOB_BASE_PATH ?? "/app/blob";

  const redis = new RedisClient(redisUrl, {
    enableOfflineQueue: false,
    connectionTimeout: 5000,
    maxRetries: 3,
  });
  await redis.connect();

  const sql = new SQL(databaseUrl);

  const env: Bindings = {
    kv: new BunRedisKVStore(redis),
    blob: new LocalBlobStore(blobBasePath),
    sql: new BunSQLClient(sql),
    queue: new BunRedisQueueClient(redis),

    APP_ENV: Bun.env.APP_ENV ?? "production",
    WORLDSTATE_SOURCE_URL: requireEnv("WORLDSTATE_SOURCE_URL"),
    WORLDSTATE_SOURCE_TOKEN: Bun.env.WORLDSTATE_SOURCE_TOKEN ?? "",
    VAPID_PUBLIC_KEY: Bun.env.VAPID_PUBLIC_KEY ?? "",
    VAPID_PRIVATE_KEY: Bun.env.VAPID_PRIVATE_KEY ?? "",
    PUSH_ALLOWED_ORIGINS: Bun.env.PUSH_ALLOWED_ORIGINS ?? "",
    PUSH_SUBSCRIBE_RATE_LIMIT: Bun.env.PUSH_SUBSCRIBE_RATE_LIMIT ?? "30",
    PUSH_SUBSCRIBE_WINDOW_SECONDS: Bun.env.PUSH_SUBSCRIBE_WINDOW_SECONDS ?? "60",
    PUSH_ADMIN_TOKEN: Bun.env.PUSH_ADMIN_TOKEN ?? "",
    DEPLOY_TRIGGER_TOKEN: Bun.env.DEPLOY_TRIGGER_TOKEN ?? "",
    CORS_ALLOWED_ORIGINS: Bun.env.CORS_ALLOWED_ORIGINS ?? "",
  };

  return { env, redis };
}

async function ensureGroup(redis: RedisClient): Promise<void> {
  try {
    await redis.send("XGROUP", ["CREATE", STREAM_KEY, GROUP_NAME, "$", "MKSTREAM"]);
    console.log(`[worker] consumer group '${GROUP_NAME}' created`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("BUSYGROUP")) {
      throw error;
    }
  }
}

async function ack(redis: RedisClient, id: string): Promise<void> {
  const result = await redis.send("XACK", [STREAM_KEY, GROUP_NAME, id]);
  if (typeof result === "number" && result === 0) {
    console.warn(`[worker] XACK no-op for id ${id}`);
  }
}

async function processEntry(
  env: Bindings,
  redis: RedisClient,
  entry: StreamEntry
): Promise<void> {
  const { id, fields } = entry;
  const body = fields.body;

  if (!body) {
    console.error(`[worker] message ${id}: missing body field`);
    await ack(redis, id);
    return;
  }

  let payload: Resp3Object | null = null;

  try {
    payload = JSON.parse(body) as Resp3Object;
    await handleQueueMessage(env, payload as QueueMessage);
    await ack(redis, id);
  } catch (error) {
    const retries = extractRetryCount(payload);
    const canRetry = payload !== null && retries < MAX_RETRIES;

    console.error(`[worker] message ${id} failed:`, error);

    if (canRetry && payload) {
      const retryPayload = {
        ...payload,
        __retryCount: retries + 1,
      };

      try {
        await env.queue.send(retryPayload);
        console.warn(`[worker] message ${id} requeued (${retries + 1}/${MAX_RETRIES})`);
      } catch (requeueError) {
        console.error(`[worker] message ${id} requeue failed:`, requeueError);
      }
    } else if (payload) {
      console.error(`[worker] message ${id} reached max retries (${MAX_RETRIES})`);
    }

    try {
      await ack(redis, id);
    } catch (ackError) {
      console.error(`[worker] message ${id} ack failed:`, ackError);
    }
  }
}

async function readBatch(
  redis: RedisClient,
  id: string = ">"
): Promise<{ raw: unknown; entries: StreamEntry[] }> {
  const raw = await redis.send("XREADGROUP", [
    "GROUP",
    GROUP_NAME,
    CONSUMER_NAME,
    "COUNT",
    String(READ_COUNT),
    "BLOCK",
    id === ">" ? String(BLOCK_MS) : "0",
    "STREAMS",
    STREAM_KEY,
    id,
  ]);

  return { raw, entries: parseXReadGroupResp3(raw) };
}

/**
 * Startup recovery: Process messages already assigned to this consumer but not ACKed.
 */
async function startupRecovery(env: Bindings, redis: RedisClient): Promise<void> {
  console.log(`[worker] starting recovery phase for ${CONSUMER_NAME}...`);
  let totalRecovered = 0;

  while (totalRecovered < 1000) { // Safety cap
    const { entries } = await readBatch(redis, "0");
    if (entries.length === 0) break;

    console.log(`[worker] recovering ${entries.length} pending messages`);
    for (const entry of entries) {
      await processEntry(env, redis, entry);
      totalRecovered++;
    }
  }

  if (totalRecovered > 0) {
    console.log(`[worker] recovery phase complete: ${totalRecovered} messages processed`);
  } else {
    console.log("[worker] no pending messages found");
  }
}

async function run(): Promise<void> {
  const { env, redis } = await buildContext();
  await ensureGroup(redis);

  // 1. Recover pending messages
  await startupRecovery(env, redis);

  console.log(`[worker] started as ${CONSUMER_NAME}, reading from ${STREAM_KEY}`);

  // 2. Main loop
  while (true) {
    let batch: { raw: unknown; entries: StreamEntry[] };

    try {
      batch = await readBatch(redis, ">");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("NOGROUP")) {
        try {
          await ensureGroup(redis);
        } catch (groupError) {
          console.error("[worker] failed to recreate consumer group:", groupError);
        }
      }

      console.error("[worker] XREADGROUP error:", error);
      await Bun.sleep(1000);
      continue;
    }

    if (batch.entries.length === 0) {
      const unknownIds = extractPotentialIds(batch.raw);
      if (unknownIds.length > 0) {
        console.warn(
          `[worker] unknown XREADGROUP shape; acking ${unknownIds.length} ids to avoid pending buildup`
        );
        for (const id of unknownIds) {
          try {
            await ack(redis, id);
          } catch (ackError) {
            console.error(`[worker] fallback ack failed for ${id}:`, ackError);
          }
        }
      }
      continue;
    }

    // Process batch in parallel with a concurrency limit
    const pool = [...batch.entries];
    const workers = [];

    async function worker() {
      while (pool.length > 0) {
        const entry = pool.shift();
        if (entry) {
          await processEntry(env, redis, entry);
        }
      }
    }

    // Spawn up to CONCURRENCY_LIMIT workers for this batch
    for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, batch.entries.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }
}

run().catch((error) => {
  console.error("[worker] fatal error:", error);
  process.exit(1); // process.exit is standard for CLI apps even in Bun
});

setInterval(() => {
  // Keep event loop alive
}, 60000);
