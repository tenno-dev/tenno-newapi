import { Hono } from "hono";
import { isDevRequest } from "../app/env";
import { parseBoolean, parseLimit } from "../app/http";
import { AppContext, AppEnv } from "../app/types";
import { SQL } from "../db/sql";
import { ensureQueueTables } from "../pipeline/retention";
import {
  executeWorldStatePush,
  getLatestPushCandidates,
  getWorldStateCachePlan,
  getWorldStateSplit,
} from "../pipeline/worldstate";
import { WORLDSTATE_BUCKETS } from "../tennodev/sections";
import {
  executeTranslationSync,
  getTranslationSyncStatus,
  translationIndexR2Key,
  translationObjectIndexR2Key,
  TRANSLATION_LANGS,
} from "../pipeline/translations";

async function debugBlobIndex(c: AppContext) {
  const prefix = c.req.query("prefix") ?? "";
  const cursor = c.req.query("cursor") || undefined;
  const limit = parseLimit(c.req.query("limit"), 50, 500);
  const list = await c.env.blob.list({ prefix, cursor, limit });

  return c.json({
    store: "blob",
    prefix,
    limit,
    nextCursor: list.cursor ?? null,
    truncated: list.truncated,
    objectCount: list.objects.length,
    objects: list.objects.map((obj) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
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
      kvPrepared: !!c.env.kv,
      blobPrepared: !!c.env.blob,
      sqlPrepared: !!c.env.sql,
      queueActive: !!c.env.queue,
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

  app.get("/debug/translations/view", async (c) => {
    const lang = (c.req.query("lang") ?? "en").toLowerCase().trim();

    if (!TRANSLATION_LANGS.includes(lang as (typeof TRANSLATION_LANGS)[number])) {
      return c.json(
        { ok: false, error: `Invalid language: ${lang}`, supportedLanguages: TRANSLATION_LANGS },
        400
      );
    }

    let flatIndex: Record<string, string> = {};
    const flatIndexObj = await c.env.blob.get(translationIndexR2Key(lang));
    if (flatIndexObj) {
      const text = await flatIndexObj.text();
      flatIndex = JSON.parse(text) as Record<string, string>;
    }

    let objectIndex: unknown = null;
    const objectIndexObj = await c.env.blob.get(translationObjectIndexR2Key(lang));
    if (objectIndexObj) {
      const text = await objectIndexObj.text();
      objectIndex = JSON.parse(text) as unknown;
    }

    let objectIndexFileCount = 0;
    let objectIndexEntryCount = 0;
    if (objectIndex && typeof objectIndex === "object" && "files" in objectIndex) {
      const files = (objectIndex as Record<string, unknown>).files;
      if (files && typeof files === "object") {
        objectIndexFileCount = Object.keys(files).length;
        for (const file of Object.values(files)) {
          if (file && typeof file === "object" && "entries" in file) {
            objectIndexEntryCount += Object.keys((file as { entries: Record<string, unknown> }).entries || {}).length;
          }
        }
      }
    }

    return c.json({
      ok: true, lang,
      flatIndex: { count: Object.keys(flatIndex).length, entries: flatIndex },
      objectIndex: { filesCount: objectIndexFileCount, entriesCount: objectIndexEntryCount, structure: objectIndex },
    });
  });

  app.get("/debug/queue/index", async (c) => {
    const limit = parseLimit(c.req.query("limit"), 50, 500);
    await ensureQueueTables(c.env.sql);
    const result = await c.env.sql.prepare(SQL.selectQueueLogs).bind(limit).all();

    return c.json({ store: "queue", limit, count: result.results.length, items: result.results });
  });

  app.get("/debug/blob/index", debugBlobIndex);
  app.get("/debug/r2/index", debugBlobIndex);
  app.get("/debug/r1/index", debugBlobIndex);

  app.get("/debug/kv/index", async (c) => {
    const prefix = c.req.query("prefix") ?? "";
    const cursor = c.req.query("cursor") || undefined;
    const limit = parseLimit(c.req.query("limit"), 50, 1000);
    const list = await c.env.kv.list({ prefix, cursor, limit });

    return c.json({
      store: "kv",
      prefix, limit,
      nextCursor: list.cursor ?? null,
      listComplete: list.list_complete,
      keyCount: list.keys.length,
      keys: list.keys,
    });
  });

  app.get("/debug/sql/index", async (c) => {
    const limit = parseLimit(c.req.query("limit"), 100, 1000);
    const result = await c.env.sql.prepare(SQL.selectSchemaObjects).bind(limit).all();

    return c.json({ store: "sql", limit, count: result.results.length, indexes: result.results });
  });

  app.get("/debug/d1/index", async (c) => {
    const limit = parseLimit(c.req.query("limit"), 100, 1000);
    const result = await c.env.sql.prepare(SQL.selectSchemaObjects).bind(limit).all();

    return c.json({ store: "sql (d1 alias)", limit, count: result.results.length, indexes: result.results });
  });
}
