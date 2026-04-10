import { Hono } from "hono";
import { AppEnv } from "../app/types";
import { buildCurrentTranslatedRootKey, buildTranslatedRootKey } from "../cache/keys";
import { SQL } from "../db/sql";
import { ensureDiffTables, ensureQueueTables } from "../pipeline/retention";
import {
  getWorldStateDailyStats,
  getWorldStateStats,
  getWorldStateStatus,
} from "../pipeline/worldstate";
import { TOP_LEVEL_WORLDSTATE_KEYS } from "../types/worldstate";

/**
 * Compute a weak ETag from JSON stringified content using simple hash.
 * Returns format: W/"hash" as per HTTP spec.
 */
function computeETag(obj: unknown): string {
  const json = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    hash = ((hash << 5) - hash) + json.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `W/"${Math.abs(hash).toString(16)}"`;
}

/**
 * Add cache headers to response.
 * If ETag matches If-None-Match, returns 304 Not Modified.
 * Otherwise returns 200 with Cache-Control and ETag headers.
 */
type CacheHeadersResult = {
  shouldReturn304: boolean;
  headers: Record<string, string>;
};

function getCacheHeaders(
  c: any, // Hono context
  responseBody: unknown,
  maxAgeSeconds: number = 60
): CacheHeadersResult {
  const etag = computeETag(responseBody);
  const ifNoneMatch = c.req.header("if-none-match");
  
  // Return 304 if ETag matches client's cached version
  const shouldReturn304 = ifNoneMatch === etag;

  return {
    shouldReturn304,
    headers: {
      "cache-control": `public, max-age=${maxAgeSeconds}`,
      "etag": etag,
      "vary": "If-None-Match",
    },
  };
}

/** Filter Events/HubEvents language-specific arrays and remove events with empty Messages. */
function filterEventMessagesToLang(data: unknown, lang: string): unknown {
  const isLangMatch = (item: unknown): boolean => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return true;
    }

    const obj = item as Record<string, unknown>;
    const itemLang = (obj.LanguageCode ?? obj.Language ?? "").toString().toLowerCase().trim();
    return itemLang === lang;
  };

  const filterEvent = (event: unknown): unknown => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return event;
    }

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
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return true;
    }

    const eventObj = event as Record<string, unknown>;
    // Remove only when Messages exists and is empty after filtering.
    if (Array.isArray(eventObj.Messages)) {
      return eventObj.Messages.length > 0;
    }

    return true;
  };

  if (Array.isArray(data)) {
    return (data as Array<unknown>).map(filterEvent).filter(shouldKeepEvent);
  }

  if (!data || typeof data !== "object") {
    return data;
  }

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
  if (!value) {
    return null;
  }

  const ms = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? null : ms;
}

function summarizeRunQueue(run: PipelineRunRow | null, queueRows: QueueLogRow[], queuedKeys: string[]) {
  const latestByRootKey = new Map<string, { status: string; error: string | null }>();

  for (const row of queueRows) {
    if (!latestByRootKey.has(row.rootKey)) {
      latestByRootKey.set(row.rootKey, {
        status: row.status,
        error: row.error,
      });
    }
  }

  let processed = 0;
  let failed = 0;

  for (const row of latestByRootKey.values()) {
    if (row.status === "processed") {
      processed += 1;
    } else if (row.status === "failed") {
      failed += 1;
    }
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
    (queueTimes.length > 0
      ? Math.min(...queueTimes)
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
    queued,
    queuedKeys,
    queuedKeysCount: queuedKeys.length,
    processed,
    failed,
    pending,
    status,
    isActive,
    startedAt,
    endedAt,
    activeDurationSec,
    progress,
    progressPercent: Math.round(progress * 10000) / 100,
    errorRootKeys,
  };
}

export function registerWorldStateRoutes(app: Hono<AppEnv>): void {
  app.get("/worldstate/full", async (c) => {
    // Default to English if no lang parameter provided
    const lang = (c.req.query("lang") ?? "en").trim().toLowerCase() || "en";

    // Fetch all available root keys in parallel for this language
    const payloads = await Promise.all(
      TOP_LEVEL_WORLDSTATE_KEYS.map(async (rootKey) => {
        const key = buildCurrentTranslatedRootKey(rootKey, lang);
        const payload = await c.env.TENNODEV_WORLDSTATE_KV.get(key, "json");
        return { rootKey, payload };
      })
    );

    const combined: Record<string, unknown> = {};
    const missing: string[] = [];

    for (const { rootKey, payload } of payloads) {
      if (payload !== null) {
        // Filter event messages to requested language
        combined[rootKey] = filterEventMessagesToLang(payload, lang);
      } else {
        missing.push(rootKey);
      }
    }

    const responseBody = {
      ok: true,
      lang,
      timestamp: new Date().toISOString(),
      payloadCount: Object.keys(combined).length,
      missingKeys: missing,
      payload: combined,
    };

    const { shouldReturn304, headers } = getCacheHeaders(c, responseBody, 60);

    if (shouldReturn304) {
      return c.body(null, 304, headers);
    }

    return c.json(responseBody, { headers });
  });

  app.get("/worldstate/status", async (c) => {
    const responseBody = await getWorldStateStatus(c);
    const { shouldReturn304, headers } = getCacheHeaders(c, responseBody, 60);

    if (shouldReturn304) {
      return c.body(null, 304, headers);
    }

    return c.json(responseBody, { headers });
  });

  app.get("/worldstate/runs/:runId/progress", async (c) => {
    const runId = c.req.param("runId").trim();

    if (!runId) {
      return c.json({ ok: false, error: "runId is required" }, 400);
    }

    await Promise.all([
      ensureDiffTables(c.env.TENNODEV_WORLDSTATE_D1),
      ensureQueueTables(c.env.TENNODEV_WORLDSTATE_D1),
    ]);

    const [runResult, queueResult, diffResult] = await Promise.all([
      c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectPipelineRunById)
        .bind(runId)
        .all<PipelineRunRow>(),
      c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectQueueLogsByRun)
        .bind(runId)
        .all<QueueLogRow>(),
      c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectDiffRootKeysByRun)
        .bind(runId)
        .all<{ rootKey: string }>(),
    ]);

    const run = runResult.results[0] ?? null;
    const queuedKeys = Array.from(new Set(diffResult.results.map((row) => row.rootKey)));

    const queue = summarizeRunQueue(run, queueResult.results, queuedKeys);

    const responseBody = {
      ok: true,
      runId,
      run,
      queue: {
        queued: queue.queued,
        queuedKeys: queue.queuedKeys,
        queuedKeysCount: queue.queuedKeysCount,
        processed: queue.processed,
        failed: queue.failed,
        pending: queue.pending,
        status: queue.status,
        isActive: queue.isActive,
        startedAt: queue.startedAt,
        endedAt: queue.endedAt,
        activeDurationSec: queue.activeDurationSec,
        progress: queue.progress,
        progressPercent: queue.progressPercent,
      },
      errorRootKeys: queue.errorRootKeys,
      updatedAt: new Date().toISOString(),
    };

    // Don't cache active runs as aggressively; cache inactive runs longer
    const maxAge = queue.isActive ? 10 : 60;
    const { shouldReturn304, headers } = getCacheHeaders(c, responseBody, maxAge);

    if (shouldReturn304) {
      return c.body(null, 304, headers);
    }

    return c.json(responseBody, { headers });
  });

  app.get("/worldstate/runs/current", async (c) => {
    await Promise.all([
      ensureDiffTables(c.env.TENNODEV_WORLDSTATE_D1),
      ensureQueueTables(c.env.TENNODEV_WORLDSTATE_D1),
    ]);

    const limitParam = Number.parseInt(c.req.query("limit") ?? "20", 10);
    const limit = Number.isNaN(limitParam) ? 20 : Math.max(1, Math.min(100, limitParam));

    const recentResult = await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectRecentPipelineRuns)
      .bind(limit)
      .all<PipelineRunRow>();

    if (recentResult.results.length === 0) {
      return c.json({ ok: false, error: "no runs found" }, 404);
    }

    const summaries = await Promise.all(
      recentResult.results.map(async (run) => {
        const [queueResult, diffResult] = await Promise.all([
          c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectQueueLogsByRun)
            .bind(run.runId)
            .all<QueueLogRow>(),
          c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectDiffRootKeysByRun)
            .bind(run.runId)
            .all<{ rootKey: string }>(),
        ]);

        const queuedKeys = Array.from(new Set(diffResult.results.map((row) => row.rootKey)));
        const queue = summarizeRunQueue(run, queueResult.results, queuedKeys);

        return {
          run,
          queue: {
            queued: queue.queued,
            queuedKeys: queue.queuedKeys,
            queuedKeysCount: queue.queuedKeysCount,
            processed: queue.processed,
            failed: queue.failed,
            pending: queue.pending,
            status: queue.status,
            isActive: queue.isActive,
            startedAt: queue.startedAt,
            endedAt: queue.endedAt,
            activeDurationSec: queue.activeDurationSec,
            progress: queue.progress,
            progressPercent: queue.progressPercent,
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

    if (!selected || !latest) {
      return c.json({ ok: false, error: "no runs found" }, 404);
    }

    const responseBody = {
      ok: true,
      mode: active ? "active" : "latest",
      selected,
      active,
      latest,
      scannedRuns: summaries.length,
      updatedAt: new Date().toISOString(),
    };

    // Don't cache if there's an active run; more aggressive cache for completed state
    const maxAge = active ? 10 : 60;
    const { shouldReturn304, headers } = getCacheHeaders(c, responseBody, maxAge);

    if (shouldReturn304) {
      return c.body(null, 304, headers);
    }

    return c.json(responseBody, { headers });
  });

  app.get("/worldstate/translated/:rootKey", async (c) => {
    const rootKey = c.req.param("rootKey");
    const lang = (c.req.query("lang") ?? "en").trim().toLowerCase() || "en";
    const key = buildCurrentTranslatedRootKey(rootKey, lang);
    const payload = await c.env.TENNODEV_WORLDSTATE_KV.get(key, "json");

    if (payload === null) {
      return c.json({ ok: false, error: "translated payload not found", rootKey, lang, key }, 404);
    }

    // Filter event messages to requested language
    const filtered = filterEventMessagesToLang(payload, lang);

    const responseBody = { ok: true, rootKey, lang, key, payload: filtered };
    const { shouldReturn304, headers } = getCacheHeaders(c, responseBody, 60);

    if (shouldReturn304) {
      return c.body(null, 304, headers);
    }

    return c.json(responseBody, { headers });
  });

  app.get("/worldstate/translated/:rootKey/runs/:runId", async (c) => {
    const rootKey = c.req.param("rootKey");
    const runId = c.req.param("runId");
    const lang = (c.req.query("lang") ?? "en").trim().toLowerCase() || "en";
    const key = buildTranslatedRootKey(rootKey, lang, runId);
    const payload = await c.env.TENNODEV_WORLDSTATE_KV.get(key, "json");

    if (payload === null) {
      return c.json(
        { ok: false, error: "translated run payload not found", rootKey, runId, lang, key },
        404
      );
    }

    // Filter event messages to requested language
    const filtered = filterEventMessagesToLang(payload, lang);

    const responseBody = { ok: true, rootKey, runId, lang, key, payload: filtered };
    const { shouldReturn304, headers } = getCacheHeaders(c, responseBody, 60);

    if (shouldReturn304) {
      return c.body(null, 304, headers);
    }

    return c.json(responseBody, { headers });
  });

  app.get("/worldstate/stats", async (c) => {
    const days = Number.parseInt(c.req.query("days") ?? "30", 10);
    const responseBody = await getWorldStateStats(c, Number.isNaN(days) ? 30 : days);
    const { shouldReturn304, headers } = getCacheHeaders(c, responseBody, 300); // 5 min cache for stats

    if (shouldReturn304) {
      return c.body(null, 304, headers);
    }

    return c.json(responseBody, { headers });
  });

  app.get("/worldstate/stats/daily", async (c) => {
    const days = Number.parseInt(c.req.query("days") ?? "30", 10);
    const rootKey = c.req.query("rootKey") ?? undefined;
    const responseBody = await getWorldStateDailyStats(c, Number.isNaN(days) ? 30 : days, rootKey);
    const { shouldReturn304, headers } = getCacheHeaders(c, responseBody, 300); // 5 min cache for stats

    if (shouldReturn304) {
      return c.body(null, 304, headers);
    }

    return c.json(responseBody, { headers });
  });
}