import pg from "pg";
import Redis from "ioredis";
import { Bindings } from "./app/types";
import { RedisKVStore } from "./adapters/kv/redis";
import { LocalBlobStore } from "./adapters/blob/local";
import { PostgresSQLClient } from "./adapters/sql/postgres";
import { RedisStreamsQueueClient } from "./adapters/queue/redis-streams";
import { handleQueueMessage } from "./queue/consumer";
import { QueueMessage } from "./app/types";

// Parse pg TIMESTAMPTZ and TIMESTAMP columns as ISO strings
pg.types.setTypeParser(
  pg.types.builtins.TIMESTAMPTZ,
  (val: string) => new Date(val.replace(" ", "T") + (val.includes("+") || val.endsWith("Z") ? "" : "Z")).toISOString()
);
pg.types.setTypeParser(
  pg.types.builtins.TIMESTAMP,
  (val: string) => new Date(val.replace(" ", "T") + "Z").toISOString()
);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const STREAM_KEY = "worldstate:translate";
const GROUP_NAME = "workers";
const CONSUMER_NAME = `consumer-${process.pid}`;

async function buildEnv(): Promise<{ env: Bindings; redis: Redis }> {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const databaseUrl = requireEnv("DATABASE_URL");
  const blobBasePath = process.env.BLOB_BASE_PATH ?? "/app/blob";

  const redis = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });

  const env: Bindings = {
    kv: new RedisKVStore(redis),
    blob: new LocalBlobStore(blobBasePath),
    sql: new PostgresSQLClient(databaseUrl),
    queue: new RedisStreamsQueueClient(redis),

    APP_ENV: process.env.APP_ENV ?? process.env.NODE_ENV ?? "production",
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

async function ensureConsumerGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup("CREATE", STREAM_KEY, GROUP_NAME, "$", "MKSTREAM");
    console.log(`[worker] consumer group '${GROUP_NAME}' created`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("BUSYGROUP")) throw err;
    // Group already exists — expected
  }
}

type XReadGroupEntry = [id: string, fields: string[]];

async function run(): Promise<void> {
  const { env, redis } = await buildEnv();
  await ensureConsumerGroup(redis);

  console.log(`[worker] started as ${CONSUMER_NAME}, reading from ${STREAM_KEY}`);

  while (true) {
    const results = (await redis.xreadgroup(
      "GROUP", GROUP_NAME, CONSUMER_NAME,
      "COUNT", "10",
      "BLOCK", "5000",
      "STREAMS", STREAM_KEY, ">"
    )) as Array<[stream: string, entries: XReadGroupEntry[]]> | null;

    if (!results || results.length === 0) continue;

    for (const [, entries] of results) {
      for (const [id, fields] of entries) {
        let parsed: QueueMessage | null = null;

        try {
          const bodyIndex = fields.indexOf("body");
          if (bodyIndex === -1 || bodyIndex + 1 >= fields.length) {
            console.error(`[worker] message ${id}: missing body field`);
            await redis.xack(STREAM_KEY, GROUP_NAME, id);
            continue;
          }

          parsed = JSON.parse(fields[bodyIndex + 1]) as QueueMessage;
          await handleQueueMessage(env, parsed);
          await redis.xack(STREAM_KEY, GROUP_NAME, id);
        } catch (err) {
          console.error(`[worker] message ${id} failed:`, err);
          // Leave in pending for retry; do not XACK
        }
      }
    }
  }
}

run().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});
