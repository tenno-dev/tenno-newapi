export const SQL = {
  createPipelineRunsTable:
    "CREATE TABLE IF NOT EXISTS pipeline_runs (run_id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, source_version TEXT, changed_count INTEGER NOT NULL, dry_run INTEGER NOT NULL, queued_count INTEGER NOT NULL, execution_status TEXT NOT NULL DEFAULT 'queued', started_at TEXT, completed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  alterPipelineRunsAddExecutionStatus:
    "ALTER TABLE pipeline_runs ADD COLUMN execution_status TEXT NOT NULL DEFAULT 'queued'",
  alterPipelineRunsAddStartedAt:
    "ALTER TABLE pipeline_runs ADD COLUMN started_at TEXT",
  alterPipelineRunsAddCompletedAt:
    "ALTER TABLE pipeline_runs ADD COLUMN completed_at TEXT",
  createPipelineDiffsTable:
    "CREATE TABLE IF NOT EXISTS pipeline_diffs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, root_key TEXT NOT NULL, previous_hash TEXT, next_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  createPipelineItemChangesTable:
    "CREATE TABLE IF NOT EXISTS pipeline_item_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, root_key TEXT NOT NULL, item_id TEXT NOT NULL, change_type TEXT NOT NULL, previous_hash TEXT, next_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  createTranslateQueueLogsTable:
    "CREATE TABLE IF NOT EXISTS translate_queue_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, root_key TEXT NOT NULL, payload_key TEXT NOT NULL, target_languages TEXT NOT NULL, payload_size INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  selectOldRunsBeyondRetention:
    "SELECT run_id as runId FROM pipeline_runs ORDER BY fetched_at DESC, run_id DESC LIMIT -1 OFFSET ?",
  selectDiffRootKeysByRun:
    "SELECT root_key as rootKey FROM pipeline_diffs WHERE run_id = ?",
  selectQueueRootKeysByRun:
    "SELECT root_key as rootKey FROM translate_queue_logs WHERE run_id = ?",
  deleteQueueLogsByRun: "DELETE FROM translate_queue_logs WHERE run_id = ?",
  deletePipelineDiffsByRun: "DELETE FROM pipeline_diffs WHERE run_id = ?",
  deletePipelineItemChangesByRun: "DELETE FROM pipeline_item_changes WHERE run_id = ?",
  deletePipelineRunByRun: "DELETE FROM pipeline_runs WHERE run_id = ?",
  insertPipelineDiff:
    "INSERT OR IGNORE INTO pipeline_diffs (run_id, root_key, previous_hash, next_hash) VALUES (?, ?, ?, ?)",
  insertPipelineItemChange:
    "INSERT OR IGNORE INTO pipeline_item_changes (run_id, root_key, item_id, change_type, previous_hash, next_hash) VALUES (?, ?, ?, ?, ?, ?)",
  upsertPipelineRun:
    "INSERT OR REPLACE INTO pipeline_runs (run_id, fetched_at, source_version, changed_count, dry_run, queued_count, execution_status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  countPipelineRuns: "SELECT COUNT(*) as count FROM pipeline_runs",
  selectItemChangeStatsByDays:
    "SELECT root_key as rootKey, COUNT(*) as changedItems, SUM(CASE WHEN change_type = 'added' THEN 1 ELSE 0 END) as added, SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN change_type = 'updated' THEN 1 ELSE 0 END) as updated FROM pipeline_item_changes WHERE created_at >= datetime('now', ?) GROUP BY root_key ORDER BY changedItems DESC, rootKey ASC",
  selectItemChangeDailyStatsByDays:
    "SELECT date(created_at) as day, root_key as rootKey, COUNT(*) as changedItems, SUM(CASE WHEN change_type = 'added' THEN 1 ELSE 0 END) as added, SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN change_type = 'updated' THEN 1 ELSE 0 END) as updated FROM pipeline_item_changes WHERE created_at >= datetime('now', ?) GROUP BY date(created_at), root_key ORDER BY day ASC, rootKey ASC",
  insertTranslateQueueLog:
    "INSERT INTO translate_queue_logs (run_id, root_key, payload_key, target_languages, payload_size, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
  selectQueueLogs:
    "SELECT id, run_id as runId, root_key as rootKey, payload_key as payloadKey, target_languages as targetLanguages, payload_size as payloadSize, status, error, created_at as createdAt FROM translate_queue_logs ORDER BY id DESC LIMIT ?",
  selectQueueLogsByRun:
    "SELECT id, run_id as runId, root_key as rootKey, payload_key as payloadKey, target_languages as targetLanguages, payload_size as payloadSize, status, error, created_at as createdAt FROM translate_queue_logs WHERE run_id = ? ORDER BY id DESC",
  selectPipelineRunById:
    "SELECT run_id as runId, fetched_at as fetchedAt, source_version as sourceVersion, changed_count as changedCount, dry_run as dryRun, queued_count as queuedCount, execution_status as executionStatus, started_at as startedAt, completed_at as completedAt, created_at as createdAt FROM pipeline_runs WHERE run_id = ? LIMIT 1",
  selectRecentPipelineRuns:
    "SELECT run_id as runId, fetched_at as fetchedAt, source_version as sourceVersion, changed_count as changedCount, dry_run as dryRun, queued_count as queuedCount, execution_status as executionStatus, started_at as startedAt, completed_at as completedAt, created_at as createdAt FROM pipeline_runs ORDER BY fetched_at DESC, run_id DESC LIMIT ?",
  selectRunQueueLatestStatusCountsByRun:
    "SELECT SUM(CASE WHEN latest.status = 'processed' THEN 1 ELSE 0 END) as processedCount, SUM(CASE WHEN latest.status = 'failed' THEN 1 ELSE 0 END) as failedCount, COUNT(*) as knownCount FROM (SELECT l.root_key, l.status FROM translate_queue_logs l JOIN (SELECT root_key, MAX(id) as max_id FROM translate_queue_logs WHERE run_id = ? GROUP BY root_key) x ON l.id = x.max_id WHERE l.run_id = ?) latest",
  selectRunQueueTimeBoundsByRun:
    "SELECT MIN(created_at) as firstAt, MAX(created_at) as lastAt FROM translate_queue_logs WHERE run_id = ?",
  updatePipelineRunExecutionState:
    "UPDATE pipeline_runs SET execution_status = ?, started_at = COALESCE(started_at, ?), completed_at = ? WHERE run_id = ?",
  updatePipelineRunCompletedState:
    "UPDATE pipeline_runs SET execution_status = ?, started_at = COALESCE(started_at, ?), completed_at = COALESCE(completed_at, ?) WHERE run_id = ?",
  selectSchemaObjects:
    "SELECT name, type, tbl_name as tableName, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name LIMIT ?",
} as const;
