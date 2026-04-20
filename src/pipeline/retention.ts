import {
  buildDummyTranslationKey,
  buildRawSnapshotKey,
  buildRootPayloadKey,
  buildRunSummaryKey,
} from "../cache/keys";
import { Bindings, SQLClient } from "../app/types";
import { SQL } from "../db/sql";

export const MAX_RETAINED_RUNS = 60;

async function ensurePipelineRunExecutionColumns(db: SQLClient): Promise<void> {
  const alters = [
    SQL.alterPipelineRunsAddExecutionStatus,
    SQL.alterPipelineRunsAddStartedAt,
    SQL.alterPipelineRunsAddCompletedAt,
  ] as const;

  for (const stmt of alters) {
    try {
      await db.prepare(stmt).bind().run();
    } catch {
      // Column already exists — IF NOT EXISTS handles this in PostgreSQL anyway.
    }
  }
}

export async function ensureDiffTables(db: SQLClient): Promise<void> {
  await db.prepare(SQL.createPipelineRunsTable).bind().run();
  await ensurePipelineRunExecutionColumns(db);
  await Promise.all([
    db.prepare(SQL.createPipelineDiffsTable).bind().run(),
    db.prepare(SQL.createPipelineItemChangesTable).bind().run(),
  ]);
}

export async function ensureQueueTables(db: SQLClient): Promise<void> {
  await db.prepare(SQL.createTranslateQueueLogsTable).bind().run();
}

export async function ensurePushTables(db: SQLClient): Promise<void> {
  await db.prepare(SQL.createPushSubscriptionsTable).bind().run();
  await db.prepare(SQL.createPushSubscriptionRootKeysTable).bind().run();
  await db.prepare(SQL.createPushSubscriptionSubKeysTable).bind().run();
}

export async function pruneOldRuns(env: Bindings): Promise<void> {
  await Promise.all([
    ensureDiffTables(env.sql),
    ensureQueueTables(env.sql),
  ]);

  const oldRuns = await env.sql
    .prepare(SQL.selectOldRunsBeyondRetention)
    .bind(MAX_RETAINED_RUNS)
    .all<{ runId: string }>();

  for (const row of oldRuns.results) {
    const runId = row.runId;
    const [diffRows, queueRows] = await Promise.all([
      env.sql
        .prepare(SQL.selectChangedRootKeysByRun)
        .bind(runId)
        .all<{ rootKey: string }>(),
      env.sql
        .prepare(SQL.selectQueueRootKeysByRun)
        .bind(runId)
        .all<{ rootKey: string }>(),
    ]);

    const diffRootKeys = new Set(diffRows.results.map((item) => item.rootKey));
    const queueRootKeys = new Set(queueRows.results.map((item) => item.rootKey));

    await Promise.all([
      env.kv.delete(buildRawSnapshotKey(runId)),
      env.kv.delete(buildRunSummaryKey(runId)),
      ...[...diffRootKeys].map((rootKey) =>
        env.kv.delete(buildRootPayloadKey(rootKey, runId))
      ),
      ...[...queueRootKeys].map((rootKey) =>
        env.kv.delete(buildDummyTranslationKey(runId, rootKey))
      ),
    ]);

    await env.sql.batch([
      env.sql.prepare(SQL.deleteQueueLogsByRun).bind(runId),
      env.sql.prepare(SQL.deletePipelineDiffsByRun).bind(runId),
      env.sql.prepare(SQL.deletePipelineItemChangesByRun).bind(runId),
      env.sql.prepare(SQL.deletePipelineRunByRun).bind(runId),
    ]);
  }
}
