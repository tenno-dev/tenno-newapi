import { buildDummyTranslationKey } from "../cache/keys";
import {
  deleteCurrentRootPayload,
  loadCurrentRootPayload,
  saveLatestRunMeta,
  saveRawSnapshot,
  saveRootPayload,
  saveRunSummary,
} from "../cache/store";
import { Bindings } from "../app/types";
import { RootDiffItem, RootHashMap, RootItemChange } from "../tennodev/diff";
import { SQL } from "../db/sql";
import { ensureDiffTables, ensureQueueTables, pruneOldRuns } from "./retention";

async function updateRunExecutionState(db: D1Database, runId: string): Promise<void> {
  await Promise.all([ensureDiffTables(db), ensureQueueTables(db)]);

  const [runResult, countsResult, boundsResult] = await Promise.all([
    db.prepare(SQL.selectPipelineRunById).bind(runId).all<{
      runId: string;
      queuedCount: number;
    }>(),
    db.prepare(SQL.selectRunQueueLatestStatusCountsByRun).bind(runId, runId).all<{
      processedCount: number;
      failedCount: number;
      knownCount: number;
    }>(),
    db.prepare(SQL.selectRunQueueTimeBoundsByRun).bind(runId).all<{
      firstAt: string | null;
      lastAt: string | null;
    }>(),
  ]);

  const run = runResult.results[0];
  if (!run) {
    return;
  }

  const counts = countsResult.results[0] ?? {
    processedCount: 0,
    failedCount: 0,
    knownCount: 0,
  };

  const knownCount = Number(counts.knownCount ?? 0);
  const failedCount = Number(counts.failedCount ?? 0);
  const queuedCount = Number(run.queuedCount ?? 0);

  const bounds = boundsResult.results[0] ?? { firstAt: null, lastAt: null };

  if (knownCount === 0) {
    await db
      .prepare(SQL.updatePipelineRunExecutionState)
      .bind("queued", null, null, runId)
      .run();
    return;
  }

  const isFinished = queuedCount > 0 && knownCount >= queuedCount;

  if (isFinished) {
    const status = failedCount > 0 ? "failed" : "completed";
    await db
      .prepare(SQL.updatePipelineRunCompletedState)
      .bind(status, bounds.firstAt, bounds.lastAt, runId)
      .run();
    return;
  }

  await db
    .prepare(SQL.updatePipelineRunExecutionState)
    .bind("running", bounds.firstAt, null, runId)
    .run();
}

export async function persistWorldStateRun(
  env: Bindings,
  input: {
    runId: string;
    fetchedAt: string;
    sourceVersion: string | null;
    rawPayload: string;
    nextHashes: RootHashMap;
    changed: RootDiffItem[];
    changedPayloadValues: Array<{ rootKey: string; payload: string }>;
    itemChanges: RootItemChange[];
  }
): Promise<{
  rawSnapshotKey: string;
  changedPayloadKeys: Array<{ rootKey: string; kvKey: string }>;
}> {
  const rawSnapshotKey = await saveRawSnapshot(env.TENNODEV_WORLDSTATE_KV, input.runId, input.rawPayload);
  const changedPayloadKeys: Array<{ rootKey: string; kvKey: string }> = [];

  for (const item of input.changedPayloadValues) {
    const kvKey = await saveRootPayload(
      env.TENNODEV_WORLDSTATE_KV,
      item.rootKey,
      input.runId,
      item.payload
    );
    changedPayloadKeys.push({ rootKey: item.rootKey, kvKey });
  }
  await saveLatestRunMeta(env.TENNODEV_WORLDSTATE_KV, {
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    changedRootKeys: input.changed.map((item) => item.rootKey),
  });

  for (const item of input.changed) {
    await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.insertPipelineDiff)
      .bind(input.runId, item.rootKey, item.previousHash, item.nextHash)
      .run();
  }

  if (input.itemChanges.length > 0) {
    await env.TENNODEV_WORLDSTATE_D1.batch(
      input.itemChanges.map((item) =>
        env.TENNODEV_WORLDSTATE_D1.prepare(SQL.insertPipelineItemChange).bind(
          input.runId,
          item.rootKey,
          item.itemId,
          item.changeType,
          item.previousHash,
          item.nextHash
        )
      )
    );
  }

  return { rawSnapshotKey, changedPayloadKeys };
}

export async function recordPreparedWorldStateRun(
  env: Bindings,
  input: {
    runId: string;
    fetchedAt: string;
    sourceVersion: string | null;
    rawSnapshotKey: string;
    changedRootKeys: string[];
    changedCount: number;
    queuedCount: number;
    force: boolean;
    sourceLocale: string;
    targetLanguages: readonly string[];
    pushCandidateKeys: string[];
    nonPushKeys: string[];
  }
): Promise<void> {
  await saveLatestRunMeta(env.TENNODEV_WORLDSTATE_KV, {
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    changedRootKeys: input.changedRootKeys,
  });

  await saveRunSummary(env.TENNODEV_WORLDSTATE_KV, input.runId, {
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    rawSnapshotKey: input.rawSnapshotKey,
    changedRootKeys: input.changedRootKeys,
    changedCount: input.changedCount,
    queuedCount: input.queuedCount,
    dryRun: false,
    force: input.force,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
    pushCandidateKeys: input.pushCandidateKeys,
    nonPushKeys: input.nonPushKeys,
    mode: "async-fanout",
    stage: "prepared",
  });

  await ensureDiffTables(env.TENNODEV_WORLDSTATE_D1);
  await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.upsertPipelineRun)
    .bind(
      input.runId,
      input.fetchedAt,
      input.sourceVersion,
      input.changedCount,
      0,
      input.queuedCount,
      "queued",
      null,
      null
    )
    .run();
}

export async function writeRootChange(
  env: Bindings,
  input: {
    runId: string;
    rootKey: string;
    previousHash: string | null;
    nextHash: string;
    payload: string;
    itemChanges: RootItemChange[];
  }
): Promise<string> {
  const kvKey = await saveRootPayload(
    env.TENNODEV_WORLDSTATE_KV,
    input.rootKey,
    input.runId,
    input.payload
  );

  await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.insertPipelineDiff)
    .bind(input.runId, input.rootKey, input.previousHash, input.nextHash)
    .run();

  if (input.itemChanges.length > 0) {
    await env.TENNODEV_WORLDSTATE_D1.batch(
      input.itemChanges.map((item) =>
        env.TENNODEV_WORLDSTATE_D1.prepare(SQL.insertPipelineItemChange).bind(
          input.runId,
          item.rootKey,
          item.itemId,
          item.changeType,
          item.previousHash,
          item.nextHash
        )
      )
    );
  }

  return kvKey;
}

export async function loadPreviousRootValues(
  kv: KVNamespace,
  rootKeys: string[]
): Promise<Record<string, unknown | null>> {
  const result: Record<string, unknown | null> = {};

  for (const rootKey of rootKeys) {
    result[rootKey] = await loadCurrentRootPayload(kv, rootKey);
  }

  return result;
}

export async function finalizeWorldStateRun(
  env: Bindings,
  input: {
    runId: string;
    fetchedAt: string;
    sourceVersion: string | null;
    changedRootKeys: string[];
    changedCount: number;
    queuedCount: number;
    dryRun: boolean;
    force: boolean;
    sourceLocale: string;
    targetLanguages: readonly string[];
  }
): Promise<void> {
  const summary = {
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    changedRootKeys: input.changedRootKeys,
    changedCount: input.changedCount,
    queuedCount: input.queuedCount,
    dryRun: input.dryRun,
    force: input.force,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
  };
  await saveRunSummary(env.TENNODEV_WORLDSTATE_KV, input.runId, summary);

  await ensureDiffTables(env.TENNODEV_WORLDSTATE_D1);
  await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.upsertPipelineRun)
    .bind(
      input.runId,
      input.fetchedAt,
      input.sourceVersion,
      input.changedCount,
      input.dryRun ? 1 : 0,
      input.queuedCount,
      "queued",
      null,
      null
    )
    .run();

  await pruneOldRuns(env);
}

export async function getPipelineRunCount(db: D1Database): Promise<number> {
  await ensureDiffTables(db);
  const runCountQuery = await db.prepare(SQL.countPipelineRuns).all<{ count: number }>();

  return Number(runCountQuery.results[0]?.count ?? 0);
}

export async function getItemChangeStats(
  db: D1Database,
  days: number
): Promise<Array<{ rootKey: string; changedItems: number; new: number; removed: number; changed: number }>> {
  await ensureDiffTables(db);
  const window = `-${days} days`;
  const result = await db.prepare(SQL.selectItemChangeStatsByDays).bind(window).all<{
    rootKey: string;
    changedItems: number;
    new: number;
    removed: number;
    changed: number;
  }>();

  return result.results.map((row) => ({
    rootKey: row.rootKey,
    changedItems: Number(row.changedItems ?? 0),
    new: Number(row.new ?? 0),
    removed: Number(row.removed ?? 0),
    changed: Number(row.changed ?? 0),
  }));
}

export async function getItemChangeDailyStats(
  db: D1Database,
  days: number,
  rootKey?: string
): Promise<Array<{ day: string; rootKey: string; changedItems: number; new: number; removed: number; changed: number }>> {
  await ensureDiffTables(db);
  const window = `-${days} days`;
  const result = await db.prepare(SQL.selectItemChangeDailyStatsByDays).bind(window).all<{
    day: string;
    rootKey: string;
    changedItems: number;
    new: number;
    removed: number;
    changed: number;
  }>();

  return result.results
    .filter((row) => !rootKey || row.rootKey === rootKey)
    .map((row) => ({
      day: row.day,
      rootKey: row.rootKey,
      changedItems: Number(row.changedItems ?? 0),
      new: Number(row.new ?? 0),
      removed: Number(row.removed ?? 0),
      changed: Number(row.changed ?? 0),
    }));
}

export async function writeDummyTranslationArtifact(
  env: Bindings,
  input: {
    runId: string;
    rootKey: string;
    sourceLocale: string;
    targetLanguages: readonly string[];
    payloadKey: string;
    payloadSize: number;
  }
): Promise<void> {
  const dummyKey = buildDummyTranslationKey(input.runId, input.rootKey);
  const dummyResult = {
    runId: input.runId,
    rootKey: input.rootKey,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
    payloadKey: input.payloadKey,
    payloadSize: input.payloadSize,
    translatedAt: new Date().toISOString(),
    mode: "dummy",
  };

  await env.TENNODEV_WORLDSTATE_KV.put(dummyKey, JSON.stringify(dummyResult), {
    expirationTtl: 60 * 60 * 24 * 7,
  });
}

export async function logQueueProcessed(
  db: D1Database,
  input: {
    runId: string;
    rootKey: string;
    payloadKey: string;
    targetLanguages: readonly string[];
    payloadSize: number;
  }
): Promise<void> {
  await ensureQueueTables(db);
  await db
    .prepare(SQL.insertTranslateQueueLog)
    .bind(
      input.runId,
      input.rootKey,
      input.payloadKey,
      JSON.stringify(input.targetLanguages),
      input.payloadSize,
      "processed",
      null
    )
    .run();

  await updateRunExecutionState(db, input.runId);
}

export async function logQueueFailed(
  db: D1Database,
  input: {
    runId: string;
    rootKey: string;
    payloadKey: string;
    targetLanguages: readonly string[];
    error: string;
  }
): Promise<void> {
  await ensureQueueTables(db);
  await db
    .prepare(SQL.insertTranslateQueueLog)
    .bind(
      input.runId,
      input.rootKey,
      input.payloadKey,
      JSON.stringify(input.targetLanguages),
      0,
      "failed",
      input.error
    )
    .run();

  await updateRunExecutionState(db, input.runId);
}
