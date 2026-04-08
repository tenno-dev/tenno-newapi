export const SQL = {
  createPipelineRunsTable:
    "CREATE TABLE IF NOT EXISTS pipeline_runs (run_id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, source_version TEXT, changed_count INTEGER NOT NULL, dry_run INTEGER NOT NULL, queued_count INTEGER NOT NULL, execution_status TEXT NOT NULL DEFAULT 'queued', started_at TEXT, completed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  alterPipelineRunsAddExecutionStatus:
    "ALTER TABLE pipeline_runs ADD COLUMN execution_status TEXT NOT NULL DEFAULT 'queued'",
  alterPipelineRunsAddStartedAt:
    "ALTER TABLE pipeline_runs ADD COLUMN started_at TEXT",
  alterPipelineRunsAddCompletedAt:
    "ALTER TABLE pipeline_runs ADD COLUMN completed_at TEXT",
  createPipelineItemChangesTable:
    "CREATE TABLE IF NOT EXISTS pipeline_item_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, root_key TEXT NOT NULL, item_id TEXT NOT NULL, change_type TEXT NOT NULL, previous_hash TEXT, next_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  createTranslateQueueLogsTable:
    "CREATE TABLE IF NOT EXISTS translate_queue_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, root_key TEXT NOT NULL, payload_key TEXT NOT NULL, target_languages TEXT NOT NULL, payload_size INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  selectOldRunsBeyondRetention:
    "SELECT run_id as runId FROM pipeline_runs ORDER BY fetched_at DESC, run_id DESC LIMIT -1 OFFSET ?",
  selectChangedRootKeysByRun:
    "SELECT DISTINCT root_key as rootKey FROM pipeline_item_changes WHERE run_id = ?",
  selectItemChangesByRun:
    "SELECT id, root_key as rootKey, item_id as itemId, change_type as changeType, previous_hash as previousHash, next_hash as nextHash, created_at as createdAt FROM pipeline_item_changes WHERE run_id = ? ORDER BY root_key ASC, item_id ASC",
  selectItemChangesByRunAndRootKey:
    "SELECT id, root_key as rootKey, item_id as itemId, change_type as changeType, previous_hash as previousHash, next_hash as nextHash, created_at as createdAt FROM pipeline_item_changes WHERE run_id = ? AND root_key = ? ORDER BY item_id ASC",
  selectQueueRootKeysByRun:
    "SELECT root_key as rootKey FROM translate_queue_logs WHERE run_id = ?",
  deleteQueueLogsByRun: "DELETE FROM translate_queue_logs WHERE run_id = ?",
  deletePipelineItemChangesByRun: "DELETE FROM pipeline_item_changes WHERE run_id = ?",
  deletePipelineRunByRun: "DELETE FROM pipeline_runs WHERE run_id = ?",
  insertPipelineItemChange:
    "INSERT INTO pipeline_item_changes (run_id, root_key, item_id, change_type, previous_hash, next_hash) VALUES (?, ?, ?, ?, ?, ?)",
  upsertPipelineRun:
    "INSERT OR REPLACE INTO pipeline_runs (run_id, fetched_at, source_version, changed_count, dry_run, queued_count, execution_status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  countPipelineRuns: "SELECT COUNT(*) as count FROM pipeline_runs",
  selectItemChangeStatsByDays:
    "SELECT root_key as rootKey, COUNT(*) as changedItems, SUM(CASE WHEN change_type = 'new' THEN 1 ELSE 0 END) as new, SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN change_type = 'changed' THEN 1 ELSE 0 END) as changed FROM pipeline_item_changes WHERE created_at >= datetime('now', ?) GROUP BY root_key ORDER BY changedItems DESC, rootKey ASC",
  selectItemChangeDailyStatsByDays:
    "SELECT date(created_at) as day, root_key as rootKey, COUNT(*) as changedItems, SUM(CASE WHEN change_type = 'new' THEN 1 ELSE 0 END) as new, SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN change_type = 'changed' THEN 1 ELSE 0 END) as changed FROM pipeline_item_changes WHERE created_at >= datetime('now', ?) GROUP BY date(created_at), root_key ORDER BY day ASC, rootKey ASC",
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
  createPushSubscriptionsTable:
    "CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, lang TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_seen_at TEXT, disabled_at TEXT)",
  createPushSubscriptionRootKeysTable:
    "CREATE TABLE IF NOT EXISTS push_subscription_rootkeys (subscription_id TEXT NOT NULL, root_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (subscription_id, root_key))",
  upsertPushSubscription:
    "INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, lang, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang, updated_at = excluded.updated_at, disabled_at = NULL",
  selectPushSubscriptionByEndpoint:
    "SELECT id, endpoint, p256dh, auth, lang, created_at as createdAt, updated_at as updatedAt, last_seen_at as lastSeenAt, disabled_at as disabledAt FROM push_subscriptions WHERE endpoint = ? LIMIT 1",
  deletePushSubscriptionRootKeysBySubscriptionId:
    "DELETE FROM push_subscription_rootkeys WHERE subscription_id = ?",
  insertPushSubscriptionRootKey:
    "INSERT OR IGNORE INTO push_subscription_rootkeys (subscription_id, root_key, created_at) VALUES (?, ?, ?)",
  disablePushSubscriptionByEndpoint:
    "UPDATE push_subscriptions SET disabled_at = ? WHERE endpoint = ?",
  deletePushSubscriptionByEndpoint:
    "DELETE FROM push_subscriptions WHERE endpoint = ?",
  deletePushSubscriptionRootKeysByEndpoint:
    "DELETE FROM push_subscription_rootkeys WHERE subscription_id = (SELECT id FROM push_subscriptions WHERE endpoint = ?)",
  selectMatchingPushSubscriptions:
    "SELECT s.id, s.endpoint, s.p256dh, s.auth, s.lang FROM push_subscriptions s JOIN push_subscription_rootkeys k ON k.subscription_id = s.id WHERE s.disabled_at IS NULL AND s.lang = ? AND (k.root_key = ? OR k.root_key = '*')",
} as const;
