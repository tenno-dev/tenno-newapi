// All SQL statements targeting PostgreSQL.
// ? placeholders are converted to $1, $2, ... by the postgres adapter at bind time.
// camelCase column aliases are quoted to survive PostgreSQL's identifier lowercasing.
// TIMESTAMPTZ is used for created_at columns so that interval arithmetic works.

export const SQL = {
  // ---------------------------------------------------------------------------
  // DDL
  // ---------------------------------------------------------------------------
  createPipelineRunsTable:
    "CREATE TABLE IF NOT EXISTS pipeline_runs (run_id TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, source_version TEXT, changed_count INTEGER NOT NULL, dry_run INTEGER NOT NULL, queued_count INTEGER NOT NULL, execution_status TEXT NOT NULL DEFAULT 'queued', started_at TEXT, completed_at TEXT, created_at TIMESTAMPTZ DEFAULT NOW())",

  alterPipelineRunsAddExecutionStatus:
    "ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS execution_status TEXT NOT NULL DEFAULT 'queued'",
  alterPipelineRunsAddStartedAt:
    "ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS started_at TEXT",
  alterPipelineRunsAddCompletedAt:
    "ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS completed_at TEXT",

  createPipelineDiffsTable:
    "CREATE TABLE IF NOT EXISTS pipeline_diffs (id BIGSERIAL PRIMARY KEY, run_id TEXT NOT NULL, root_key TEXT NOT NULL, previous_hash TEXT, next_hash TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())",

  createPipelineItemChangesTable:
    "CREATE TABLE IF NOT EXISTS pipeline_item_changes (id BIGSERIAL PRIMARY KEY, run_id TEXT NOT NULL, root_key TEXT NOT NULL, item_id TEXT NOT NULL, change_type TEXT NOT NULL, previous_hash TEXT, next_hash TEXT, created_at TIMESTAMPTZ DEFAULT NOW())",

  createTranslateQueueLogsTable:
    "CREATE TABLE IF NOT EXISTS translate_queue_logs (id BIGSERIAL PRIMARY KEY, run_id TEXT NOT NULL, root_key TEXT NOT NULL, payload_key TEXT NOT NULL, target_languages TEXT NOT NULL, payload_size INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, created_at TIMESTAMPTZ DEFAULT NOW())",

  createPushSubscriptionsTable:
    "CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, lang TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_seen_at TEXT, disabled_at TEXT)",

  createPushSubscriptionRootKeysTable:
    "CREATE TABLE IF NOT EXISTS push_subscription_rootkeys (subscription_id TEXT NOT NULL, root_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (subscription_id, root_key))",

  createPushSubscriptionSubKeysTable:
    "CREATE TABLE IF NOT EXISTS push_subscription_subkeys (subscription_id TEXT NOT NULL, root_key TEXT NOT NULL, sub_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (subscription_id, root_key, sub_key))",

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------
  selectOldRunsBeyondRetention:
    "SELECT run_id as \"runId\" FROM pipeline_runs WHERE execution_status IN ('completed', 'failed') ORDER BY fetched_at DESC, run_id DESC OFFSET ?",

  selectDiffRootKeysByRun:
    "SELECT root_key as \"rootKey\" FROM pipeline_diffs WHERE run_id = ?",

  selectChangedRootKeysByRun:
    "SELECT DISTINCT root_key as \"rootKey\" FROM pipeline_item_changes WHERE run_id = ?",

  selectItemChangesByRun:
    "SELECT id, root_key as \"rootKey\", item_id as \"itemId\", change_type as \"changeType\", previous_hash as \"previousHash\", next_hash as \"nextHash\", created_at as \"createdAt\" FROM pipeline_item_changes WHERE run_id = ? ORDER BY root_key ASC, item_id ASC",

  selectItemChangesByRunAndRootKey:
    "SELECT id, root_key as \"rootKey\", item_id as \"itemId\", change_type as \"changeType\", previous_hash as \"previousHash\", next_hash as \"nextHash\", created_at as \"createdAt\" FROM pipeline_item_changes WHERE run_id = ? AND root_key = ? ORDER BY item_id ASC",

  selectChangedItemIdsByRunAndRootKey:
    "SELECT DISTINCT item_id as \"itemId\" FROM pipeline_item_changes WHERE run_id = ? AND root_key = ?",

  selectQueueRootKeysByRun:
    "SELECT root_key as \"rootKey\" FROM translate_queue_logs WHERE run_id = ?",

  selectQueueLogs:
    "SELECT id, run_id as \"runId\", root_key as \"rootKey\", payload_key as \"payloadKey\", target_languages as \"targetLanguages\", payload_size as \"payloadSize\", status, error, created_at as \"createdAt\" FROM translate_queue_logs ORDER BY id DESC LIMIT ?",

  selectQueueLogsByRun:
    "SELECT id, run_id as \"runId\", root_key as \"rootKey\", payload_key as \"payloadKey\", target_languages as \"targetLanguages\", payload_size as \"payloadSize\", status, error, created_at as \"createdAt\" FROM translate_queue_logs WHERE run_id = ? ORDER BY id DESC",

  selectPipelineRunById:
    "SELECT run_id as \"runId\", fetched_at as \"fetchedAt\", source_version as \"sourceVersion\", changed_count as \"changedCount\", dry_run as \"dryRun\", queued_count as \"queuedCount\", execution_status as \"executionStatus\", started_at as \"startedAt\", completed_at as \"completedAt\", created_at as \"createdAt\" FROM pipeline_runs WHERE run_id = ? LIMIT 1",

  selectRecentPipelineRuns:
    "SELECT run_id as \"runId\", fetched_at as \"fetchedAt\", source_version as \"sourceVersion\", changed_count as \"changedCount\", dry_run as \"dryRun\", queued_count as \"queuedCount\", execution_status as \"executionStatus\", started_at as \"startedAt\", completed_at as \"completedAt\", created_at as \"createdAt\" FROM pipeline_runs ORDER BY fetched_at DESC, run_id DESC LIMIT ?",

  selectRunQueueLatestStatusCountsByRun:
    "SELECT SUM(CASE WHEN latest.status = 'processed' THEN 1 ELSE 0 END) as \"processedCount\", SUM(CASE WHEN latest.status = 'failed' THEN 1 ELSE 0 END) as \"failedCount\", COUNT(*) as \"knownCount\" FROM (SELECT l.root_key, l.status FROM translate_queue_logs l JOIN (SELECT root_key, MAX(id) as max_id FROM translate_queue_logs WHERE run_id = ? GROUP BY root_key) x ON l.id = x.max_id WHERE l.run_id = ?) latest",

  selectRunQueueTimeBoundsByRun:
    "SELECT MIN(created_at) as \"firstAt\", MAX(created_at) as \"lastAt\" FROM translate_queue_logs WHERE run_id = ?",

  countPipelineRuns:
    "SELECT COUNT(*) as count FROM pipeline_runs",

  selectItemChangeStatsByDays:
    "SELECT root_key as \"rootKey\", COUNT(*) as \"changedItems\", SUM(CASE WHEN change_type IN ('new', 'added') THEN 1 ELSE 0 END) as new, SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN change_type IN ('changed', 'updated') THEN 1 ELSE 0 END) as changed FROM pipeline_item_changes WHERE created_at >= NOW() + ?::INTERVAL GROUP BY root_key ORDER BY \"changedItems\" DESC, root_key ASC",

  selectItemChangeDailyStatsByDays:
    "SELECT created_at::DATE::TEXT as day, root_key as \"rootKey\", COUNT(*) as \"changedItems\", SUM(CASE WHEN change_type IN ('new', 'added') THEN 1 ELSE 0 END) as new, SUM(CASE WHEN change_type = 'removed' THEN 1 ELSE 0 END) as removed, SUM(CASE WHEN change_type IN ('changed', 'updated') THEN 1 ELSE 0 END) as changed FROM pipeline_item_changes WHERE created_at >= NOW() + ?::INTERVAL GROUP BY created_at::DATE, root_key ORDER BY day ASC, root_key ASC",

  selectSchemaObjects:
    "SELECT table_name as name, 'table' as type, table_name as \"tableName\", NULL as sql FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT ?",

  selectPushSubscriptionByEndpoint:
    "SELECT id, endpoint, p256dh, auth, lang, created_at as \"createdAt\", updated_at as \"updatedAt\", last_seen_at as \"lastSeenAt\", disabled_at as \"disabledAt\" FROM push_subscriptions WHERE endpoint = ? LIMIT 1",

  selectAllPushSubscriptions:
    "SELECT id, endpoint, p256dh, auth, lang, created_at as \"createdAt\", updated_at as \"updatedAt\", last_seen_at as \"lastSeenAt\", disabled_at as \"disabledAt\" FROM push_subscriptions ORDER BY updated_at DESC, created_at DESC",

  selectAllPushSubscriptionRootKeys:
    "SELECT subscription_id as \"subscriptionId\", root_key as \"rootKey\" FROM push_subscription_rootkeys ORDER BY subscription_id ASC, root_key ASC",

  selectAllPushSubscriptionSubKeys:
    "SELECT subscription_id as \"subscriptionId\", root_key as \"rootKey\", sub_key as \"subKey\" FROM push_subscription_subkeys ORDER BY subscription_id ASC, root_key ASC, sub_key ASC",

  selectMatchingPushSubscriptionsWithSubKeys:
    "SELECT s.id, s.endpoint, s.p256dh, s.auth, s.lang, COUNT(sk.sub_key) as \"subKeyCount\", STRING_AGG(sk.sub_key, ',') as \"subKeysCsv\" FROM push_subscriptions s JOIN push_subscription_rootkeys k ON k.subscription_id = s.id LEFT JOIN push_subscription_subkeys sk ON sk.subscription_id = s.id AND LOWER(sk.root_key) = LOWER(?) WHERE s.disabled_at IS NULL AND s.lang = ? AND (LOWER(k.root_key) = LOWER(?) OR k.root_key = '*') GROUP BY s.id, s.endpoint, s.p256dh, s.auth, s.lang",

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------
  insertPipelineDiff:
    "INSERT INTO pipeline_diffs (run_id, root_key, previous_hash, next_hash) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",

  insertPipelineItemChange:
    "INSERT INTO pipeline_item_changes (run_id, root_key, item_id, change_type, previous_hash, next_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",

  upsertPipelineRun:
    "INSERT INTO pipeline_runs (run_id, fetched_at, source_version, changed_count, dry_run, queued_count, execution_status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, source_version = EXCLUDED.source_version, changed_count = EXCLUDED.changed_count, dry_run = EXCLUDED.dry_run, queued_count = EXCLUDED.queued_count, execution_status = EXCLUDED.execution_status, started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at",

  updatePipelineRunExecutionState:
    "UPDATE pipeline_runs SET execution_status = ?, started_at = COALESCE(started_at, ?), completed_at = ? WHERE run_id = ?",

  updatePipelineRunCompletedState:
    "UPDATE pipeline_runs SET execution_status = ?, started_at = COALESCE(started_at, ?), completed_at = COALESCE(completed_at, ?) WHERE run_id = ?",

  insertTranslateQueueLog:
    "INSERT INTO translate_queue_logs (run_id, root_key, payload_key, target_languages, payload_size, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)",

  updateTranslateQueueLogByRunAndRoot:
    "UPDATE translate_queue_logs SET payload_key = ?, target_languages = ?, payload_size = ?, status = ?, error = ?, created_at = NOW() WHERE run_id = ? AND root_key = ?",

  upsertPushSubscription:
    "INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, lang, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, lang = EXCLUDED.lang, updated_at = EXCLUDED.updated_at, disabled_at = NULL",

  insertPushSubscriptionRootKey:
    "INSERT INTO push_subscription_rootkeys (subscription_id, root_key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",

  insertPushSubscriptionSubKey:
    "INSERT INTO push_subscription_subkeys (subscription_id, root_key, sub_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",

  // ---------------------------------------------------------------------------
  // Deletes
  // ---------------------------------------------------------------------------
  deleteQueueLogsByRun:
    "DELETE FROM translate_queue_logs WHERE run_id = ?",
  deletePipelineDiffsByRun:
    "DELETE FROM pipeline_diffs WHERE run_id = ?",
  deletePipelineItemChangesByRun:
    "DELETE FROM pipeline_item_changes WHERE run_id = ?",
  deletePipelineRunByRun:
    "DELETE FROM pipeline_runs WHERE run_id = ?",
  deletePushSubscriptionRootKeysBySubscriptionId:
    "DELETE FROM push_subscription_rootkeys WHERE subscription_id = ?",
  deletePushSubscriptionSubKeysBySubscriptionId:
    "DELETE FROM push_subscription_subkeys WHERE subscription_id = ?",
  deletePushSubscriptionByEndpoint:
    "DELETE FROM push_subscriptions WHERE endpoint = ?",
  deletePushSubscriptionRootKeysByEndpoint:
    "DELETE FROM push_subscription_rootkeys WHERE subscription_id = (SELECT id FROM push_subscriptions WHERE endpoint = ?)",
  deletePushSubscriptionSubKeysByEndpoint:
    "DELETE FROM push_subscription_subkeys WHERE subscription_id = (SELECT id FROM push_subscriptions WHERE endpoint = ?)",
  deleteAllPushSubscriptionSubKeys:
    "DELETE FROM push_subscription_subkeys",
  deleteAllPushSubscriptionRootKeys:
    "DELETE FROM push_subscription_rootkeys",
  deleteAllPushSubscriptions:
    "DELETE FROM push_subscriptions",
} as const;
