import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { RedisClient, SQL } from "bun";
import type { Bindings } from "./app/types";
import { BunRedisKVStore } from "./adapters/kv/redis";
import { LocalBlobStore } from "./adapters/blob/local";
import { BunSQLClient } from "./adapters/sql/postgres";
import { BunRedisQueueClient } from "./adapters/queue/redis-streams";
import { corePlugin } from "./routes/core";
import { worldstatePlugin } from "./routes/worldstate";
import { debugPlugin } from "./routes/debug";
import { pushPlugin } from "./routes/push";
import { executeWorldStatePush } from "./pipeline/worldstate";
import { executeTranslationSync } from "./pipeline/translations";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function buildEnv(): Bindings {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const databaseUrl = requireEnv("DATABASE_URL");
  const blobBasePath = process.env.BLOB_BASE_PATH ?? "/app/blob";

  const redisClient = new RedisClient(redisUrl);
  const sql = new SQL(databaseUrl);

  return {
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
}

const env = buildEnv();

const allowedOrigins = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(",").map((e) => e.trim()).filter(Boolean)
    : []),
]);

const port = Number(process.env.PORT ?? 3000);

new Elysia()
  .use(
    cors({
      origin: (request: Request) => {
        const origin = request.headers.get("origin");
        if (!origin) return true;
        return allowedOrigins.has(origin);
      },
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    })
  )
  .use(corePlugin(env))
  .use(worldstatePlugin(env))
  .use(debugPlugin(env))
  .use(pushPlugin(env))
  .listen(port, () => {
    console.log(`[api] listening on port ${port}`);
  });

// Worldstate push — every minute
Bun.cron("*/1 * * * *", async () => {
  try {
    await executeWorldStatePush(env, { dryRun: false, force: false });
  } catch (err) {
    console.error("[cron] worldstate push failed:", err);
  }
});

// Translation sync — daily at midnight
Bun.cron("0 0 * * *", async () => {
  try {
    await executeTranslationSync(env);
  } catch (err) {
    console.error("[cron] translation sync failed:", err);
  }
});
