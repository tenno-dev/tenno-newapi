import { Elysia, t } from "elysia";
import type { Bindings } from "../app/types";
import {
  buildCurrentTranslatedRootKey,
  buildTranslatedHashIndexKey,
  buildTranslatedRootKey,
} from "../cache/keys";
import { SQL } from "../db/sql";
import { ensureDiffTables, ensureQueueTables } from "../pipeline/retention";
import {
  getWorldStateDailyStats,
  getWorldStateStats,
  getWorldStateStatus,
} from "../pipeline/worldstate";
import { TOP_LEVEL_WORLDSTATE_KEYS } from "../types/worldstate";

// Manual Cache and ETag helpers removed. 
// @bogeychan/elysia-etag handles this globally now.

function filterEventMessagesToLang(data: unknown, lang: string): unknown {
  const isLangMatch = (item: unknown): boolean => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const obj = item as Record<string, unknown>;
    const itemLang = (obj.LanguageCode ?? obj.Language ?? "").toString().toLowerCase().trim();
    return itemLang === lang;
  };

  const filterEvent = (event: unknown): unknown => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return event;
    const eventObj = event as Record<string, unknown>;
    const filtered = { ...eventObj };
    if (Array.isArray(eventObj.Messages)) {
      filtered.Messages = (eventObj.Messages as Array<unknown>).filter(isLangMatch);
    }
    if (Array.isArray(eventObj.Links)) {
      filtered.Links = (eventObj.Links as Array<unknown>).filter(isLangMatch);
    }
    return filtered;
  };

  const shouldKeepEvent = (event: unknown): boolean => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return true;
    const eventObj = event as Record<string, unknown>;
    if (Array.isArray(eventObj.Messages)) return eventObj.Messages.length > 0;
    return true;
  };

  if (Array.isArray(data)) {
    return (data as Array<unknown>).map(filterEvent).filter(shouldKeepEvent);
  }

  if (!data || typeof data !== "object") return data;

  const obj = data as Record<string, unknown>;
  const result = { ...obj };

  for (const key of ["Events", "HubEvents"] as const) {
    if (Array.isArray(obj[key])) {
      result[key] = (obj[key] as Array<unknown>).map(filterEvent).filter(shouldKeepEvent);
    }
  }

  return result;
}

type PipelineRunRow = {
  runId: string;
  fetchedAt: string;
  sourceVersion: string | null;
  changedCount: number;
  dryRun: number;
  queuedCount: number;
  executionStatus: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

type QueueLogRow = {
  id: number;
  rootKey: string;
  status: string;
  error: string | null;
  createdAt?: string;
};

function parseDbTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? null : ms;
}

function summarizeRunQueue(run: PipelineRunRow | null, queueRows: QueueLogRow[], queuedKeys: string[]) {
  const latestByRootKey = new Map<string, { status: string; error: string | null }>();

  for (const row of queueRows) {
    if (!latestByRootKey.has(row.rootKey)) {
      latestByRootKey.set(row.rootKey, { status: row.status, error: row.error });
    }
  }

  let processed = 0;
  let failed = 0;

  for (const row of latestByRootKey.values()) {
    if (row.status === "processed") processed += 1;
    else if (row.status === "failed") failed += 1;
  }

  const queued = Math.max(Number(run?.queuedCount ?? queuedKeys.length ?? latestByRootKey.size), 0);
  const known = processed + failed;
  const pending = Math.max(queued - known, 0);
  const progress = queued > 0 ? Math.min(1, processed / queued) : 0;
  let status = run?.executionStatus ?? (pending > 0 ? "running" : failed > 0 ? "failed" : "completed");
  if (status === "queued" && known > 0) {
    status = pending > 0 ? "running" : failed > 0 ? "failed" : "completed";
  }
  if ((status === "running" || status === "queued") && known > 0 && pending === 0) {
    status = failed > 0 ? "failed" : "completed";
  }
  const isActive = status === "running" || status === "queued";

  const queueTimes = queueRows
    .map((row) => parseDbTimestampMs(row.createdAt))
    .filter((ms): ms is number => ms !== null);

  const startedAtMs =
    parseDbTimestampMs(run?.startedAt) ??
    (queueTimes.length > 0 ? Math.min(...queueTimes)
      : (parseDbTimestampMs(run?.createdAt) ?? parseDbTimestampMs(run?.fetchedAt) ?? null));
  const endedAtMs =
    parseDbTimestampMs(run?.completedAt) ?? (!isActive && queueTimes.length > 0 ? Math.max(...queueTimes) : null);
  const startedAt = startedAtMs === null ? null : new Date(startedAtMs).toISOString();
  const activeDurationSec =
    startedAtMs === null
      ? null
      : Math.max(
          0,
          Math.floor(((isActive ? Date.now() : endedAtMs ?? Date.now()) - startedAtMs) / 1000)
        );
  const endedAt = endedAtMs === null ? null : new Date(endedAtMs).toISOString();

  const errorRootKeys = Array.from(latestByRootKey.entries())
    .filter(([, row]) => row.status === "failed")
    .map(([rootKey, row]) => ({ rootKey, error: row.error ?? "unknown error" }));

  return {
    queued, queuedKeys, queuedKeysCount: queuedKeys.length,
    processed, failed, pending, status, isActive,
    startedAt, endedAt, activeDurationSec,
    progress, progressPercent: Math.round(progress * 10000) / 100,
    errorRootKeys,
  };
}

export function worldstatePlugin(env: Bindings) {
  return new Elysia({ prefix: "/worldstate" })
    .get("/full", async ({ query }) => {
      const lang = query.lang.toLowerCase();

      const payloads = await Promise.all(
        TOP_LEVEL_WORLDSTATE_KEYS.map(async (rootKey) => {
          const key = buildCurrentTranslatedRootKey(rootKey, lang);
          const payload = await env.kv.get(key, "json");
          return { rootKey, payload };
        })
      );

      const combined: Record<string, unknown> = {};
      const missing: string[] = [];

      for (const { rootKey, payload } of payloads) {
        if (payload !== null) {
          combined[rootKey] = filterEventMessagesToLang(payload, lang);
        } else {
          missing.push(rootKey);
        }
      }

      return {
        ok: true, lang,
        timestamp: new Date().toISOString(),
        payloadCount: Object.keys(combined).length,
        missingKeys: missing,
        payload: combined,
      };
    }, {
      query: t.Object({
        lang: t.String({ default: "en" })
      })
    })

    .get("/status", async () => {
      return getWorldStateStatus(env);
    })

    .get("/runs/current", async ({ query, status }) => {
      await Promise.all([
        ensureDiffTables(env.sql),
        ensureQueueTables(env.sql),
      ]);

      const recentResult = await env.sql
        .prepare(SQL.selectRecentPipelineRuns)
        .bind(query.limit)
        .all<PipelineRunRow>();

      if (recentResult.results.length === 0) {
        return status(404, { ok: false, error: "no runs found" });
      }

      const summaries = await Promise.all(
        recentResult.results.map(async (run) => {
          const [queueResult, diffResult] = await Promise.all([
            env.sql.prepare(SQL.selectQueueLogsByRun).bind(run.runId).all<QueueLogRow>(),
            env.sql.prepare(SQL.selectChangedRootKeysByRun).bind(run.runId).all<{ rootKey: string }>(),
          ]);

          const queuedKeys = Array.from(new Set(diffResult.results.map((row) => row.rootKey)));
          const queue = summarizeRunQueue(run, queueResult.results, queuedKeys);

          return {
            run,
            queue: {
              queued: queue.queued, queuedKeys: queue.queuedKeys, queuedKeysCount: queue.queuedKeysCount,
              processed: queue.processed, failed: queue.failed, pending: queue.pending,
              status: queue.status, isActive: queue.isActive,
              startedAt: queue.startedAt, endedAt: queue.endedAt, activeDurationSec: queue.activeDurationSec,
              progress: queue.progress, progressPercent: queue.progressPercent,
            },
            errorRootKeys: queue.errorRootKeys,
          };
        })
      );

      const active = summaries.find((item) => item.queue.pending > 0) ?? null;
      const latestCompleted = summaries.find((item) => item.queue.pending === 0) ?? null;
      const latestFallback = summaries[0] ?? null;
      const latest = latestCompleted ?? latestFallback;
      const selected = active ?? latest;

      if (!selected || !latest) return status(404, { ok: false, error: "no runs found" });

      return {
        ok: true,
        mode: active ? "active" : "latest",
        selected, active, latest,
        scannedRuns: summaries.length,
        updatedAt: new Date().toISOString(),
      };
    }, {
      query: t.Object({
        limit: t.Numeric({ default: 20, minimum: 1, maximum: 100 })
      })
    })

    .get("/runs/:runId/progress", async ({ params, status }) => {
      const runId = params.runId.trim();
      await Promise.all([
        ensureDiffTables(env.sql),
        ensureQueueTables(env.sql),
      ]);

      const [runResult, queueResult, diffResult] = await Promise.all([
        env.sql.prepare(SQL.selectPipelineRunById).bind(runId).all<PipelineRunRow>(),
        env.sql.prepare(SQL.selectQueueLogsByRun).bind(runId).all<QueueLogRow>(),
        env.sql.prepare(SQL.selectChangedRootKeysByRun).bind(runId).all<{ rootKey: string }>(),
      ]);

      const run = runResult.results[0] ?? null;
      const queuedKeys = Array.from(new Set(diffResult.results.map((row) => row.rootKey)));
      const queue = summarizeRunQueue(run, queueResult.results, queuedKeys);

      return {
        ok: true, runId, run,
        queue: {
          queued: queue.queued, queuedKeys: queue.queuedKeys, queuedKeysCount: queue.queuedKeysCount,
          processed: queue.processed, failed: queue.failed, pending: queue.pending,
          status: queue.status, isActive: queue.isActive,
          startedAt: queue.startedAt, endedAt: queue.endedAt, activeDurationSec: queue.activeDurationSec,
          progress: queue.progress, progressPercent: queue.progressPercent,
        },
        errorRootKeys: queue.errorRootKeys,
        updatedAt: new Date().toISOString(),
      };
    }, {
      params: t.Object({
        runId: t.String({ minLength: 1 })
      })
    })

    .get("/runs/:runId/changes", async ({ params, query }) => {
      const runId = params.runId.trim();
      const rootKey = query.rootKey?.trim();

      await ensureDiffTables(env.sql);

      type ItemChangeRow = {
        id: number;
        rootKey: string;
        itemId: string;
        changeType: string;
        previousHash: string | null;
        nextHash: string | null;
        createdAt: string;
      };

      const result = rootKey
        ? await env.sql.prepare(SQL.selectItemChangesByRunAndRootKey).bind(runId, rootKey).all<ItemChangeRow>()
        : await env.sql.prepare(SQL.selectItemChangesByRun).bind(runId).all<ItemChangeRow>();

      return {
        ok: true,
        runId,
        rootKey: rootKey ?? null,
        count: result.results.length,
        changes: result.results,
      };
    }, {
      params: t.Object({
        runId: t.String({ minLength: 1 })
      }),
      query: t.Object({
        rootKey: t.Optional(t.String())
      })
    })

    .get("/translated/:rootKey", async ({ params, query, status }) => {
      const rootKey = params.rootKey;
      const lang = query.lang.toLowerCase();
      const key = buildCurrentTranslatedRootKey(rootKey, lang);
      const payload = await env.kv.get(key, "json");

      if (payload === null) {
        return status(404, { ok: false, error: "translated payload not found", rootKey, lang, key });
      }

      const filtered = filterEventMessagesToLang(payload, lang);
      return { ok: true, rootKey, lang, key, payload: filtered };
    }, {
      params: t.Object({
        rootKey: t.String({ minLength: 1 })
      }),
      query: t.Object({
        lang: t.String({ default: "en" })
      })
    })

    .get("/translated/:rootKey/runs/:runId", async ({ params, query, status }) => {
      const rootKey = params.rootKey;
      const runId = params.runId;
      const lang = query.lang.toLowerCase();
      const key = buildTranslatedRootKey(rootKey, lang, runId);
      const payload = await env.kv.get(key, "json");

      if (payload === null) {
        return status(404, { ok: false, error: "translated run payload not found", rootKey, runId, lang, key });
      }

      const filtered = filterEventMessagesToLang(payload, lang);
      return { ok: true, rootKey, runId, lang, key, payload: filtered };
    }, {
      params: t.Object({
        rootKey: t.String({ minLength: 1 }),
        runId: t.String({ minLength: 1 })
      }),
      query: t.Object({
        lang: t.String({ default: "en" })
      })
    })

    .get("/translated/:rootKey/hashes/:hash", async ({ set, params, query, status }) => {
      const rootKey = params.rootKey;
      const hash = params.hash;
      const lang = query.lang.toLowerCase();

      const hashIndexKey = buildTranslatedHashIndexKey(rootKey, lang, hash);
      const runKey = await env.kv.get(hashIndexKey);
      if (!runKey) {
        return status(404, { ok: false, error: "translated payload not found for hash", rootKey, lang, hash });
      }

      const payload = await env.kv.get(runKey, "json");
      if (payload === null) {
        return status(404, { ok: false, error: "translated payload not found", rootKey, lang, hash });
      }

      // Keep immutable cache for hashed content
      set.headers["cache-control"] = "public, max-age=31536000, s-maxage=31536000, immutable";
      return { ok: true, rootKey, lang, hash, payload };
    }, {
      params: t.Object({
        rootKey: t.String({ minLength: 1 }),
        hash: t.String({ minLength: 1 })
      }),
      query: t.Object({
        lang: t.String({ default: "en" })
      })
    })

    .get("/stats", async ({ query }) => {
      return getWorldStateStats(env, query.days);
    }, {
      query: t.Object({
        days: t.Numeric({ default: 30, minimum: 1, maximum: 365 })
      })
    })

    .get("/stats/daily", async ({ query }) => {
      return getWorldStateDailyStats(env, query.days, query.rootKey);
    }, {
      query: t.Object({
        days: t.Numeric({ default: 30, minimum: 1, maximum: 365 }),
        rootKey: t.Optional(t.String())
      })
    });
;
}
