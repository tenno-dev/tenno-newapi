export const SQL = {
  createPipelineRunsTable:
    "CREATE TABLE IF NOT EXISTS pipeline_runs (run_id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, source_version TEXT, changed_count INTEGER NOT NULL, dry_run INTEGER NOT NULL, queued_count INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
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
    "INSERT INTO pipeline_diffs (run_id, root_key, previous_hash, next_hash) VALUES (?, ?, ?, ?)",
  insertPipelineItemChange:
    "INSERT INTO pipeline_item_changes (run_id, root_key, item_id, change_type, previous_hash, next_hash) VALUES (?, ?, ?, ?, ?, ?)",
  upsertPipelineRun:
    "INSERT OR REPLACE INTO pipeline_runs (run_id, fetched_at, source_version, changed_count, dry_run, queued_count) VALUES (?, ?, ?, ?, ?, ?)",
  countPipelineRuns: "SELECT COUNT(*) as count FROM pipeline_runs",
  selectItemChangeStatsByDays:
    "SELECT root_key as rootKey, COUNT(*) as changedItems, SUM(CASE WHEN change_type = 'added' THEN 1 ELSE 0 END) as added, SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN change_type = 'updated' THEN 1 ELSE 0 END) as updated FROM pipeline_item_changes WHERE created_at >= datetime('now', ?) GROUP BY root_key ORDER BY changedItems DESC, rootKey ASC",
  selectItemChangeDailyStatsByDays:
    "SELECT date(created_at) as day, root_key as rootKey, COUNT(*) as changedItems, SUM(CASE WHEN change_type = 'added' THEN 1 ELSE 0 END) as added, SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN change_type = 'updated' THEN 1 ELSE 0 END) as updated FROM pipeline_item_changes WHERE created_at >= datetime('now', ?) GROUP BY date(created_at), root_key ORDER BY day ASC, rootKey ASC",
  insertTranslateQueueLog:
    "INSERT INTO translate_queue_logs (run_id, root_key, payload_key, target_languages, payload_size, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
  selectQueueLogs:
    "SELECT id, run_id as runId, root_key as rootKey, payload_key as payloadKey, target_languages as targetLanguages, payload_size as payloadSize, status, error, created_at as createdAt FROM translate_queue_logs ORDER BY id DESC LIMIT ?",
  selectSchemaObjects:
    "SELECT name, type, tbl_name as tableName, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY type, name LIMIT ?",
} as const;
