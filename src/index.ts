import pg from "pg";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import cron from "node-cron";
import Redis from "ioredis";
import { AppEnv, Bindings } from "./app/types";
import { RedisKVStore } from "./adapters/kv/redis";
import { LocalBlobStore } from "./adapters/blob/local";
import { PostgresSQLClient } from "./adapters/sql/postgres";
import { RedisStreamsQueueClient } from "./adapters/queue/redis-streams";
import { registerCoreRoutes } from "./routes/core";
import { registerWorldStateRoutes } from "./routes/worldstate";
import { registerDebugRoutes } from "./routes/debug";
import { pushRoutes } from "./routes/push";
import { executeWorldStatePush } from "./pipeline/worldstate";
import { executeTranslationSync } from "./pipeline/translations";

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

function buildEnv(): Bindings {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const databaseUrl = requireEnv("DATABASE_URL");
  const blobBasePath = process.env.BLOB_BASE_PATH ?? "/app/blob";

  const redis = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });

  return {
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
}

const env = buildEnv();

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: (origin) => {
      const configured = env.CORS_ALLOWED_ORIGINS
        ? env.CORS_ALLOWED_ORIGINS.split(",").map((e: string) => e.trim()).filter(Boolean)
        : [];

      const allowed = new Set<string>([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        ...configured,
      ]);

      if (!origin) return "*";
      return allowed.has(origin) ? origin : "";
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

registerCoreRoutes(app);
registerWorldStateRoutes(app);
registerDebugRoutes(app);
app.route("/", pushRoutes);

const port = Number(process.env.PORT ?? 3000);

serve(
  {
    fetch: (req) => app.fetch(req, env),
    port,
  },
  () => {
    console.log(`[api] listening on port ${port}`);
  }
);

// Worldstate push — every minute
cron.schedule("*/1 * * * *", async () => {
  try {
    await executeWorldStatePush(env, { dryRun: false, force: false });
  } catch (err) {
    console.error("[cron] worldstate push failed:", err);
  }
});

// Translation sync — daily at midnight
cron.schedule("0 0 * * *", async () => {
  try {
    await executeTranslationSync(env);
  } catch (err) {
    console.error("[cron] translation sync failed:", err);
  }
});
