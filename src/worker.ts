import { RedisClient, SQL } from "bun";
import type { Bindings, QueueMessage } from "./app/types";
import { BunRedisKVStore } from "./adapters/kv/redis";
import { LocalBlobStore } from "./adapters/blob/local";
import { BunSQLClient } from "./adapters/sql/postgres";
import { BunRedisQueueClient } from "./adapters/queue/redis-streams";
import { handleQueueMessage } from "./queue/consumer";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const STREAM_KEY = "worldstate:translate";
const GROUP_NAME = "workers";
const CONSUMER_NAME = `consumer-${process.pid}`;
const MAX_RETRIES = Number(process.env.WORKER_MAX_RETRIES ?? "3");

async function buildEnv(): Promise<{ env: Bindings; redis: RedisClient }> {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const databaseUrl = requireEnv("DATABASE_URL");
  const blobBasePath = process.env.BLOB_BASE_PATH ?? "/app/blob";

  const redisClient = new RedisClient(redisUrl, {
    enableOfflineQueue: false,
    connectionTimeout: 5000,
    maxRetries: 3,
  });
  await redisClient.connect();
  const sql = new SQL(databaseUrl);

  const env: Bindings = {
    kv: new BunRedisKVStore(redisClient),
    blob: new LocalBlobStore(blobBasePath),
    sql: new BunSQLClient(sql),
    queue: new BunRedisQueueClient(redisClient),

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

  return { env, redis: redisClient };
}

async function ensureConsumerGroup(redis: RedisClient): Promise<void> {
  try {
    await redis.send("XGROUP", ["CREATE", STREAM_KEY, GROUP_NAME, "$", "MKSTREAM"]);
    console.log(`[worker] consumer group '${GROUP_NAME}' created`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("BUSYGROUP")) throw err;
    // Group already exists — expected
  }
}

type XReadGroupEntry = [id: string, fields: string[]];

type NormalizedEntry = {
  id: string;
  fields: Record<string, string>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toFieldMap(raw: unknown): Record<string, string> {
  if (!raw) return {};

  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < raw.length; i += 2) {
      out[String(raw[i])] = String(raw[i + 1]);
    }
    return out;
  }

  if (typeof raw === "object") {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[String(k)] = String(v ?? "");
    }
    return out;
  }

  return {};
}

function normalizeXReadGroupResults(rawResults: unknown): NormalizedEntry[] {
  const streamMap = asRecord(rawResults);
  if (!streamMap) return [];

  const entries: NormalizedEntry[] = [];

  for (const messagesRaw of Object.values(streamMap)) {
    if (!Array.isArray(messagesRaw)) continue;

    for (const message of messagesRaw as unknown[]) {
      const obj = asRecord(message);
      if (!obj) continue;

      const idRaw = obj.id;
      const id = typeof idRaw === "string" ? idRaw : String(idRaw ?? "");
      if (!id) continue;

      const fieldsRaw = obj.fields ?? obj.message ?? obj.value ?? obj;
      const fields = toFieldMap(fieldsRaw);
      entries.push({ id, fields });
    }
  }

  return entries;
}

async function run(): Promise<void> {
  const { env, redis } = await buildEnv();
  await ensureConsumerGroup(redis);

  console.log(`[worker] started as ${CONSUMER_NAME}, reading from ${STREAM_KEY}`);

  while (true) {
    let rawResults: unknown;
    try {
      rawResults = await redis.send("XREADGROUP", [
        "GROUP", GROUP_NAME, CONSUMER_NAME,
        "COUNT", "10",
        "BLOCK", "5000",
        "STREAMS", STREAM_KEY, ">",
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NOGROUP")) {
        try {
          await ensureConsumerGroup(redis);
        } catch (ensureErr) {
          console.error("[worker] failed to recreate consumer group:", ensureErr);
        }
      }
      console.error("[worker] XREADGROUP error:", err);
      await Bun.sleep(1000);
      continue;
    }

    const entries = normalizeXReadGroupResults(rawResults);
    if (entries.length === 0) continue;

    for (const { id, fields } of entries) {
      let parsed: QueueMessage | null = null;
      let rawBodyObj: Record<string, unknown> | null = null;

      try {
        const bodyRaw = fields.body;
        if (!bodyRaw) {
          console.error(`[worker] message ${id}: missing body field`);
          await redis.send("XACK", [STREAM_KEY, GROUP_NAME, id]);
          continue;
        }

        rawBodyObj = JSON.parse(bodyRaw) as Record<string, unknown>;
        parsed = rawBodyObj as QueueMessage;
        await handleQueueMessage(env, parsed);
        await redis.send("XACK", [STREAM_KEY, GROUP_NAME, id]);
      } catch (err) {
        console.error(`[worker] message ${id} failed:`, err);

        const retries = Number(rawBodyObj?.__retryCount ?? 0);
        const canRetry = Number.isFinite(retries) && retries < MAX_RETRIES;

        if (rawBodyObj && canRetry) {
          const retryPayload = {
            ...rawBodyObj,
            __retryCount: retries + 1,
          };
          try {
            await env.queue.send(retryPayload);
            console.warn(
              `[worker] message ${id} requeued for retry ${retries + 1}/${MAX_RETRIES}`
            );
          } catch (requeueErr) {
            console.error(`[worker] message ${id} failed to requeue:`, requeueErr);
          }
        } else if (rawBodyObj) {
          console.error(
            `[worker] message ${id} reached max retries (${MAX_RETRIES}), dropping from queue`
          );
        }

        // Always ack the original message so failed items do not block the stream indefinitely.
        try {
          await redis.send("XACK", [STREAM_KEY, GROUP_NAME, id]);
        } catch (ackErr) {
          console.error(`[worker] message ${id} XACK after failure failed:`, ackErr);
        }
      }
    }
  }
}

run().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});
