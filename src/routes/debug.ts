import { Hono } from "hono";
import { isDevRequest } from "../app/env";
import { parseLimit } from "../app/http";
import { AppContext, AppEnv } from "../app/types";
import { SQL } from "../db/sql";
import { ensureQueueTables } from "../pipeline/retention";
import {
  executeWorldStatePush,
  getLatestPushCandidates,
  getWorldStateCachePlan,
  getWorldStateSplit,
  WORLDSTATE_BUCKETS,
} from "../pipeline/worldstate";
import { executeTranslationSync, getTranslationSyncStatus } from "../pipeline/translations";
import { parseBoolean } from "../app/http";

async function debugR2Index(c: AppContext) {
  const prefix = c.req.query("prefix") ?? "";
  const cursor = c.req.query("cursor") || undefined;
  const limit = parseLimit(c.req.query("limit"), 50, 500);
  const list = await c.env.TENNODEV_ASSETS_R2.list({ prefix, cursor, limit });

  return c.json({
    store: "r2",
    note: "r1 alias points to r2 in this project",
    prefix,
    limit,
    nextCursor: "cursor" in list ? list.cursor : null,
    truncated: list.truncated,
    objectCount: list.objects.length,
    objects: list.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      etag: obj.etag,
      uploaded: obj.uploaded,
      version: obj.version,
      checksums: obj.checksums,
      httpEtag: obj.httpEtag,
    })),
  });
}

export function registerDebugRoutes(app: Hono<AppEnv>): void {
  app.use("/debug/*", async (c, next) => {
    if (!isDevRequest(c)) {
      return c.json({ ok: false, error: "debug routes are only available in dev" }, 403);
    }

    await next();
  });

  app.get("/debug/bindings", (c) => {
    return c.json({
      kvPrepared: !!c.env.TENNODEV_WORLDSTATE_KV,
      r2Prepared: !!c.env.TENNODEV_ASSETS_R2,
      d1Prepared: !!c.env.TENNODEV_WORLDSTATE_D1,
      queueActive: !!c.env.TENNODEV_PUSH_QUEUE,
      queueBinding: "TENNODEV_PUSH_QUEUE",
      appEnv: c.env.APP_ENV ?? null,
    });
  });

  app.get("/debug/worldstate/buckets", (c) => {
    return c.json({ buckets: WORLDSTATE_BUCKETS });
  });

  app.get("/debug/worldstate/split", async (c) => {
    return c.json(await getWorldStateSplit());
  });

  app.get("/debug/worldstate/cache-plan", async (c) => {
    const locale = c.req.query("lang") ?? "en";
    return c.json(await getWorldStateCachePlan(locale));
  });

  app.post("/debug/worldstate/push", async (c) => {
    const dryRun = parseBoolean(c.req.query("dryRun"));
    const force = parseBoolean(c.req.query("force"));
    return c.json(await executeWorldStatePush(c.env, { dryRun, force }));
  });

  app.get("/debug/worldstate/push-candidates", async (c) => {
    return c.json(await getLatestPushCandidates(c));
  });

  app.post("/debug/translations/sync", async (c) => {
    return c.json(await executeTranslationSync(c.env));
  });

  app.get("/debug/translations/status", async (c) => {
    const status = await getTranslationSyncStatus(c.env);
    return c.json({ ok: true, ...status });
  });

  app.get("/debug/queue/index", async (c) => {
    const limit = parseLimit(c.req.query("limit"), 50, 500);
    await ensureQueueTables(c.env.TENNODEV_WORLDSTATE_D1);
    const result = await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectQueueLogs)
      .bind(limit)
      .all();

    return c.json({
      store: "queue",
      limit,
      count: result.results.length,
      items: result.results,
    });
  });

  app.get("/debug/r2/index", debugR2Index);
  app.get("/debug/r1/index", debugR2Index);

  app.get("/debug/kv/index", async (c) => {
    const prefix = c.req.query("prefix") ?? "";
    const cursor = c.req.query("cursor") || undefined;
    const limit = parseLimit(c.req.query("limit"), 50, 1000);
    const list = await c.env.TENNODEV_WORLDSTATE_KV.list({ prefix, cursor, limit });

    return c.json({
      store: "kv",
      prefix,
      limit,
      nextCursor: "cursor" in list ? list.cursor : null,
      listComplete: list.list_complete,
      keyCount: list.keys.length,
      keys: list.keys,
    });
  });

  app.get("/debug/d1/index", async (c) => {
    const limit = parseLimit(c.req.query("limit"), 100, 1000);
    const result = await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectSchemaObjects)
      .bind(limit)
      .all();

    return c.json({
      store: "d1",
      limit,
      count: result.results.length,
      indexes: result.results,
    });
  });
}