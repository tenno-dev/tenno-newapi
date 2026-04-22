import { Elysia, t } from "elysia";
import { isDevRequest } from "../app/env";
// Manual parsing utilities removed in favor of TypeBox
import type { Bindings } from "../app/types";
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

async function blobIndexHandler(env: Bindings, query: { prefix?: string; cursor?: string; limit: number }) {
  const prefix = query.prefix ?? "";
  const cursor = query.cursor || undefined;
  const limit = query.limit;
  const list = await env.blob.list({ prefix, cursor, limit });
  return {
    store: "blob",
    prefix, limit,
    nextCursor: list.cursor ?? null,
    truncated: list.truncated,
    objectCount: list.objects.length,
    objects: list.objects.map((obj) => ({ key: obj.key, size: obj.size, uploaded: obj.uploaded })),
  };
}

export function debugPlugin(env: Bindings) {
  return new Elysia({ prefix: "/debug" })
    .guard(
      {
        beforeHandle: ({ request, status }) => {
          if (!isDevRequest(env, request.url)) {
            return status(403, { ok: false, error: "debug routes are only available in dev" });
          }
        },
      },
      (app) =>
        app
          .get("/bindings", () => ({
            kvPrepared: !!env.kv,
            blobPrepared: !!env.blob,
            sqlPrepared: !!env.sql,
            queueActive: !!env.queue,
            appEnv: env.APP_ENV ?? null,
          }))

          .get("/worldstate/buckets", () => ({ buckets: WORLDSTATE_BUCKETS }))

          .get("/worldstate/split", async () => getWorldStateSplit())

          .get("/worldstate/cache-plan", async ({ query }) =>
            getWorldStateCachePlan(query.lang ?? "en")
          )

          .post("/worldstate/push", async ({ query }) =>
            executeWorldStatePush(env, {
              dryRun: query.dryRun,
              force: query.force,
            }), {
              query: t.Object({
                dryRun: t.Boolean({ default: false }),
                force: t.Boolean({ default: false })
              })
            }
          )

          .get("/worldstate/push-candidates", async () => getLatestPushCandidates(env))

          .post("/translations/sync", async () => executeTranslationSync(env))

          .get("/translations/status", async () => {
            const status = await getTranslationSyncStatus(env);
            return { ok: true, ...status };
          })

          .get("/translations/view", async ({ query, set }) => {
            const lang = query.lang.toLowerCase().trim();
            if (!TRANSLATION_LANGS.includes(lang as (typeof TRANSLATION_LANGS)[number])) {
              set.status = 400;
              return { ok: false, error: `Invalid language: ${lang}`, supportedLanguages: TRANSLATION_LANGS };
            }

            let flatIndex: Record<string, string> = {};
            const flatIndexObj = await env.blob.get(translationIndexR2Key(lang));
            if (flatIndexObj) flatIndex = JSON.parse(await flatIndexObj.text()) as Record<string, string>;

            let objectIndex: unknown = null;
            const objectIndexObj = await env.blob.get(translationObjectIndexR2Key(lang));
            if (objectIndexObj) objectIndex = JSON.parse(await objectIndexObj.text());

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

            return {
              ok: true, lang,
              flatIndex: { count: Object.keys(flatIndex).length, entries: flatIndex },
              objectIndex: { filesCount: objectIndexFileCount, entriesCount: objectIndexEntryCount, structure: objectIndex },
            };
          }, {
            query: t.Object({
              lang: t.String({ default: "en" })
            })
          })

          .get("/queue/index", async ({ query }) => {
            await ensureQueueTables(env.sql);
            const result = await env.sql.prepare(SQL.selectQueueLogs).bind(query.limit).all();
            return { store: "queue", limit: query.limit, count: result.results.length, items: result.results };
          }, {
            query: t.Object({
              limit: t.Numeric({ default: 50, minimum: 1, maximum: 500 })
            })
          })

          .get("/blob/index", ({ query }) => blobIndexHandler(env, query), {
            query: t.Object({
              prefix: t.Optional(t.String()),
              cursor: t.Optional(t.String()),
              limit: t.Numeric({ default: 50, minimum: 1, maximum: 500 })
            })
          })
          .get("/r2/index", ({ query }) => blobIndexHandler(env, query), {
            query: t.Object({
              prefix: t.Optional(t.String()),
              cursor: t.Optional(t.String()),
              limit: t.Numeric({ default: 50, minimum: 1, maximum: 500 })
            })
          })
          .get("/r1/index", ({ query }) => blobIndexHandler(env, query), {
            query: t.Object({
              prefix: t.Optional(t.String()),
              cursor: t.Optional(t.String()),
              limit: t.Numeric({ default: 50, minimum: 1, maximum: 500 })
            })
          })

          .get("/kv/index", async ({ query }) => {
            const list = await env.kv.list({ prefix: query.prefix, cursor: query.cursor, limit: query.limit });
            return {
              store: "kv", prefix: query.prefix, limit: query.limit,
              nextCursor: list.cursor ?? null,
              listComplete: list.list_complete,
              keyCount: list.keys.length,
              keys: list.keys,
            };
          }, {
            query: t.Object({
              prefix: t.String({ default: "" }),
              cursor: t.Optional(t.String()),
              limit: t.Numeric({ default: 50, minimum: 1, maximum: 1000 })
            })
          })

          .get("/sql/index", async ({ query }) => {
            const result = await env.sql.prepare(SQL.selectSchemaObjects).bind(query.limit).all();
            return { store: "sql", limit: query.limit, count: result.results.length, indexes: result.results };
          }, {
            query: t.Object({
              limit: t.Numeric({ default: 100, minimum: 1, maximum: 1000 })
            })
          })

          .get("/d1/index", async ({ query }) => {
            const result = await env.sql.prepare(SQL.selectSchemaObjects).bind(query.limit).all();
            return { store: "sql (d1 alias)", limit: query.limit, count: result.results.length, indexes: result.results };
          }, {
            query: t.Object({
              limit: t.Numeric({ default: 100, minimum: 1, maximum: 1000 })
            })
          })
    );
}
