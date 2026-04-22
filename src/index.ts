import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { cron } from "@elysiajs/cron";
import { openapi } from "@elysiajs/openapi";
import { logger } from "@bogeychan/elysia-logger";
import { etag } from "@bogeychan/elysia-etag";
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
  const value = Bun.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function buildEnv(): Promise<Bindings> {
  const redisUrl = Bun.env.REDIS_URL ?? "redis://localhost:6379";
  const databaseUrl = requireEnv("DATABASE_URL");
  const blobBasePath = Bun.env.BLOB_BASE_PATH ?? "/app/blob";

  const redisClient = new RedisClient(redisUrl, {
    enableOfflineQueue: false,
    connectionTimeout: 5000,
    maxRetries: 3,
  });
  await redisClient.connect();
  const sql = new SQL(databaseUrl);

  return {
    kv: new BunRedisKVStore(redisClient),
    blob: new LocalBlobStore(blobBasePath),
    sql: new BunSQLClient(sql),
    queue: new BunRedisQueueClient(redisClient),

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
}

const env = await buildEnv();

const allowedOrigins = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(",").map((e) => e.trim()).filter(Boolean)
    : []),
]);

const port = Number(Bun.env.PORT ?? 3000);

new Elysia()
  .use(logger())
  .use(etag())
  .onAfterHandle(async ({ query, request, set, response }) => {
    // 1. Logic for Pretty JSON
    if (query.pretty === "true" && response && typeof response === "object" && !(response instanceof Uint8Array)) {
      const prettyBody = JSON.stringify(response, null, 2);
      set.headers["content-type"] = "application/json; charset=utf-8";
      return new Response(prettyBody, { 
        headers: set.headers as Record<string, string>, 
        status: typeof set.status === "number" ? set.status : 200 
      });
    }

    if (response == null || response instanceof ReadableStream || response instanceof Response || response instanceof Blob) {
      return response;
    }

    let body = response;
    const isJson = typeof body === "object" && !(body instanceof Uint8Array);
    const text = isJson ? JSON.stringify(body) : String(body);
    if (text.length === 0) return response;

    // 2. Gzip Compression (Native Bun) - Keeping manual as it's more stable for now
    const acceptEncoding = request.headers.get("accept-encoding") ?? "";
    if (acceptEncoding.includes("gzip") && text.length > 1024) {
      const compressed = Bun.gzipSync(new TextEncoder().encode(text));
      set.headers["content-encoding"] = "gzip";
      set.headers["vary"] = "Accept-Encoding";
      set.headers["content-type"] = isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
      return new Response(compressed, { 
        headers: set.headers as Record<string, string>, 
        status: typeof set.status === "number" ? set.status : 200 
      });
    }

    return response;
  })
  .use(
    openapi({
      path: "/docs",
      specPath: "/openapi.json",
      provider: "swagger-ui",
      documentation: {
        info: {
          title: "Tenno New API",
          version: "1.0.0",
          description: "API documentation for public routes",
        },
      },
      exclude: {
        paths: [/^\/debug\//, /^\/internal\//],
      },
    })
  )
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
  .use(
    cron({
      name: "worldstatePush",
      pattern: "*/1 * * * *",
      run: async () => {
        try {
          await executeWorldStatePush(env, { dryRun: false, force: false });
        } catch (err) {
          console.error("[cron] worldstate push failed:", err);
        }
      },
    })
  )
  .use(
    cron({
      name: "translationSync",
      pattern: "0 0 * * *",
      run: async () => {
        try {
          await executeTranslationSync(env);
        } catch (err) {
          console.error("[cron] translation sync failed:", err);
        }
      },
    })
  )
  .use(corePlugin(env))
  .use(worldstatePlugin(env))
  .use(debugPlugin(env))
  .use(pushPlugin(env))
  .listen(port, () => {
    console.log(`[api] listening on port ${port}`);
  });
