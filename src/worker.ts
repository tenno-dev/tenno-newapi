import { RedisClient, SQL } from "bun";
import type { Bindings, QueueMessage } from "./app/types";
import { BunRedisKVStore } from "./adapters/kv/redis";
import { LocalBlobStore } from "./adapters/blob/local";
import { BunSQLClient } from "./adapters/sql/postgres";
import { BunRedisQueueClient } from "./adapters/queue/redis-streams";
import { handleQueueMessage } from "./queue/consumer";

const STREAM_KEY = "worldstate:translate";
const GROUP_NAME = "workers";
const CONSUMER_NAME = `consumer-${process.pid}`;
const MAX_RETRIES = Number(process.env.WORKER_MAX_RETRIES ?? "3");
const BLOCK_MS = 5000;
const READ_COUNT = 10;

type Resp3Object = Record<string, unknown>;

type StreamEntry = {
  id: string;
  fields: Record<string, string>;
};

function requireEnv(name: string): string {
  const value = process.env[name];
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

function toStringFields(value: unknown): Record<string, string> {
  const obj = asObject(value);
  if (!obj) return {};

  const out: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(obj)) {
    out[key] = String(fieldValue ?? "");
  }
  return out;
}

function parseXReadGroupResp3(raw: unknown): StreamEntry[] {
  const streamParts: unknown[] = [];

  const streamMap = asObject(raw);
  if (streamMap) {
    streamParts.push(...Object.values(streamMap));
  } else if (Array.isArray(raw)) {
    streamParts.push(...raw);
  } else {
    return [];
  }

  const entries: StreamEntry[] = [];

  for (const part of streamParts) {
    const streamMessages =
      Array.isArray(part) && part.length >= 2 && Array.isArray(part[1])
        ? part[1]
        : part;

    if (!Array.isArray(streamMessages)) continue;

    for (const message of streamMessages as unknown[]) {
      if (Array.isArray(message) && message.length >= 2) {
        const id = String(message[0] ?? "");
        if (!id) continue;

        const fieldTuples = Array.isArray(message[1]) ? message[1] : [];
        const fields: Record<string, string> = {};
        for (let i = 0; i + 1 < fieldTuples.length; i += 2) {
          fields[String(fieldTuples[i])] = String(fieldTuples[i + 1] ?? "");
        }

        entries.push({ id, fields });
        continue;
      }

      const msg = asObject(message);
      if (!msg) continue;

      const id = typeof msg.id === "string" ? msg.id : String(msg.id ?? "");
      if (!id) continue;

      const fields = toStringFields(msg.fields ?? msg.message ?? msg.value ?? msg);
      if (!fields.body && typeof msg.body === "string") {
        fields.body = msg.body;
      }

      entries.push({ id, fields });
    }
  }

  return entries;
}

function extractRetryCount(payload: Resp3Object | null): number {
  const value = Number(payload?.__retryCount ?? 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

async function buildContext(): Promise<{ env: Bindings; redis: RedisClient }> {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const databaseUrl = requireEnv("DATABASE_URL");
  const blobBasePath = process.env.BLOB_BASE_PATH ?? "/app/blob";

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

    APP_ENV: process.env.APP_ENV ?? "production",
    WORLDSTATE_SOURCE_URL: requireEnv("WORLDSTATE_SOURCE_URL"),
    WORLDSTATE_SOURCE_TOKEN: process.env.WORLDSTATE_SOURCE_TOKEN ?? "",
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? "",
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? "",
    PUSH_ALLOWED_ORIGINS: process.env.PUSH_ALLOWED_ORIGINS ?? "",
    PUSH_SUBSCRIBE_RATE_LIMIT: process.env.PUSH_SUBSCRIBE_RATE_LIMIT ?? "30",
    PUSH_SUBSCRIBE_WINDOW_SECONDS: process.env.PUSH_SUBSCRIBE_WINDOW_SECONDS ?? "60",
    PUSH_ADMIN_TOKEN: process.env.PUSH_ADMIN_TOKEN ?? "",
    DEPLOY_TRIGGER_TOKEN: process.env.DEPLOY_TRIGGER_TOKEN ?? "",
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? "",
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
  await redis.send("XACK", [STREAM_KEY, GROUP_NAME, id]);
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

async function readBatch(redis: RedisClient): Promise<StreamEntry[]> {
  const raw = await redis.send("XREADGROUP", [
    "GROUP",
    GROUP_NAME,
    CONSUMER_NAME,
    "COUNT",
    String(READ_COUNT),
    "BLOCK",
    String(BLOCK_MS),
    "STREAMS",
    STREAM_KEY,
    ">",
  ]);

  return parseXReadGroupResp3(raw);
}

async function run(): Promise<void> {
  const { env, redis } = await buildContext();
  await ensureGroup(redis);

  console.log(`[worker] started as ${CONSUMER_NAME}, reading from ${STREAM_KEY}`);

  while (true) {
    let batch: StreamEntry[];

    try {
      batch = await readBatch(redis);
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

    if (batch.length === 0) {
      continue;
    }

    for (const entry of batch) {
      await processEntry(env, redis, entry);
    }
  }
}

run().catch((error) => {
  console.error("[worker] fatal error:", error);
  process.exit(1);
});
