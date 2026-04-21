import { Elysia } from "elysia";
import { isDevRequest } from "../app/env";
import { parseBoolean, parseLimit } from "../app/http";
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

async function blobIndexHandler(env: Bindings, query: Record<string, string | undefined>) {
  const prefix = query.prefix ?? "";
  const cursor = query.cursor || undefined;
  const limit = parseLimit(query.limit, 50, 500);
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
        beforeHandle: ({ request, error }) => {
          if (!isDevRequest(env, request.url)) {
            return error(403, { ok: false, error: "debug routes are only available in dev" });
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
              dryRun: parseBoolean(query.dryRun),
              force: parseBoolean(query.force),
            })
          )

          .get("/worldstate/push-candidates", async () => getLatestPushCandidates(env))

          .post("/translations/sync", async () => executeTranslationSync(env))

          .get("/translations/status", async () => {
            const status = await getTranslationSyncStatus(env);
            return { ok: true, ...status };
          })

          .get("/translations/view", async ({ query, set }) => {
            const lang = (query.lang ?? "en").toLowerCase().trim();
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
          })

          .get("/queue/index", async ({ query }) => {
            const limit = parseLimit(query.limit, 50, 500);
            await ensureQueueTables(env.sql);
            const result = await env.sql.prepare(SQL.selectQueueLogs).bind(limit).all();
            return { store: "queue", limit, count: result.results.length, items: result.results };
          })

          .get("/blob/index", ({ query }) => blobIndexHandler(env, query as Record<string, string | undefined>))
          .get("/r2/index", ({ query }) => blobIndexHandler(env, query as Record<string, string | undefined>))
          .get("/r1/index", ({ query }) => blobIndexHandler(env, query as Record<string, string | undefined>))

          .get("/kv/index", async ({ query }) => {
            const prefix = query.prefix ?? "";
            const cursor = query.cursor || undefined;
            const limit = parseLimit(query.limit, 50, 1000);
            const list = await env.kv.list({ prefix, cursor, limit });
            return {
              store: "kv", prefix, limit,
              nextCursor: list.cursor ?? null,
              listComplete: list.list_complete,
              keyCount: list.keys.length,
              keys: list.keys,
            };
          })

          .get("/sql/index", async ({ query }) => {
            const limit = parseLimit(query.limit, 100, 1000);
            const result = await env.sql.prepare(SQL.selectSchemaObjects).bind(limit).all();
            return { store: "sql", limit, count: result.results.length, indexes: result.results };
          })

          .get("/d1/index", async ({ query }) => {
            const limit = parseLimit(query.limit, 100, 1000);
            const result = await env.sql.prepare(SQL.selectSchemaObjects).bind(limit).all();
            return { store: "sql (d1 alias)", limit, count: result.results.length, indexes: result.results };
          })
    );
}
