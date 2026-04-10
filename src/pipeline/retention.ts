import {
  buildDummyTranslationKey,
  buildRawSnapshotKey,
  buildRootPayloadKey,
  buildRunSummaryKey,
} from "../cache/keys";
import { Bindings } from "../app/types";
import { SQL } from "../db/sql";

export const MAX_RETAINED_RUNS = 60;

async function ensurePipelineRunExecutionColumns(db: D1Database): Promise<void> {
  const alters = [
    SQL.alterPipelineRunsAddExecutionStatus,
    SQL.alterPipelineRunsAddStartedAt,
    SQL.alterPipelineRunsAddCompletedAt,
  ] as const;

  for (const stmt of alters) {
    try {
      await db.prepare(stmt).run();
    } catch {
      // Column already exists or migration not needed.
    }
  }
}

export async function ensureDiffTables(db: D1Database): Promise<void> {
  await db.prepare(SQL.createPipelineRunsTable).run();
  await ensurePipelineRunExecutionColumns(db);
  await db.prepare(SQL.createPipelineItemChangesTable).run();
}

export async function ensureQueueTables(db: D1Database): Promise<void> {
  await db.prepare(SQL.createTranslateQueueLogsTable).run();
}

export async function ensurePushTables(db: D1Database): Promise<void> {
  await db.prepare(SQL.createPushSubscriptionsTable).run();
  await db.prepare(SQL.createPushSubscriptionRootKeysTable).run();
}

export async function pruneOldRuns(env: Bindings): Promise<void> {
  await Promise.all([
    ensureDiffTables(env.TENNODEV_WORLDSTATE_D1),
    ensureQueueTables(env.TENNODEV_WORLDSTATE_D1),
  ]);

  const oldRuns = await env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectOldRunsBeyondRetention)
    .bind(MAX_RETAINED_RUNS)
    .all<{ runId: string }>();

  for (const row of oldRuns.results) {
    const runId = row.runId;
    const [diffRows, queueRows] = await Promise.all([
      env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectChangedRootKeysByRun)
        .bind(runId)
        .all<{ rootKey: string }>(),
      env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectQueueRootKeysByRun)
        .bind(runId)
        .all<{ rootKey: string }>(),
    ]);

    const diffRootKeys = new Set(diffRows.results.map((item) => item.rootKey));
    const queueRootKeys = new Set(queueRows.results.map((item) => item.rootKey));

    await Promise.all([
      env.TENNODEV_WORLDSTATE_KV.delete(buildRawSnapshotKey(runId)),
      env.TENNODEV_WORLDSTATE_KV.delete(buildRunSummaryKey(runId)),
      ...[...diffRootKeys].map((rootKey) =>
        env.TENNODEV_WORLDSTATE_KV.delete(buildRootPayloadKey(rootKey, runId))
      ),
      ...[...queueRootKeys].map((rootKey) =>
        env.TENNODEV_WORLDSTATE_KV.delete(buildDummyTranslationKey(runId, rootKey))
      ),
    ]);

    await env.TENNODEV_WORLDSTATE_D1.batch([
      env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deleteQueueLogsByRun).bind(runId),
      env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deletePipelineItemChangesByRun).bind(runId),
      env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deletePipelineRunByRun).bind(runId),
    ]);
  }
}