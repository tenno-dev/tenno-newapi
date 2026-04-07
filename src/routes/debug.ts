import { Hono } from "hono";
import { parseLimit } from "../app/http";
import { AppContext, AppEnv } from "../app/types";
import { SQL } from "../db/sql";
import { ensureQueueTables } from "../pipeline/retention";

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