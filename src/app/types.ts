// ---------------------------------------------------------------------------
// KV Store (replaces Cloudflare KVNamespace)
// ---------------------------------------------------------------------------

export interface KVListResult {
  keys: Array<{ name: string; expiration?: number }>;
  list_complete: boolean;
  cursor?: string;
}

export interface KVStore {
  get(key: string): Promise<string | null>;
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; cursor?: string; limit?: number }): Promise<KVListResult>;
}

// ---------------------------------------------------------------------------
// Blob Store (replaces Cloudflare R2Bucket)
// ---------------------------------------------------------------------------

export interface BlobObject {
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface BlobListItem {
  key: string;
  size: number;
  etag?: string;
  uploaded?: Date;
  version?: string;
  checksums?: unknown;
  httpEtag?: string;
}

export interface BlobListResult {
  objects: BlobListItem[];
  cursor?: string;
  truncated: boolean;
}

export interface BlobStore {
  get(key: string): Promise<BlobObject | null>;
  put(
    key: string,
    value: string,
    opts?: { httpMetadata?: { contentType?: string } }
  ): Promise<void>;
  list(opts?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<BlobListResult>;
}

// ---------------------------------------------------------------------------
// SQL Client (replaces Cloudflare D1Database)
// ---------------------------------------------------------------------------

export interface BoundStatement {
  run(): Promise<void>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

export interface PreparedStatement {
  bind(...args: unknown[]): BoundStatement;
}

export interface SQLClient {
  prepare(sql: string): PreparedStatement;
  batch(stmts: BoundStatement[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Queue Client (replaces Cloudflare Queue)
// ---------------------------------------------------------------------------

export interface QueueClient {
  send(message: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// Bindings — runtime environment injected into routes and workers
// ---------------------------------------------------------------------------

export type Bindings = {
  kv: KVStore;
  blob: BlobStore;
  sql: SQLClient;
  queue: QueueClient;
  APP_ENV?: string;
  DEPLOY_TRIGGER_TOKEN?: string;
  WORLDSTATE_SOURCE_URL?: string;
  WORLDSTATE_SOURCE_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  PUSH_ALLOWED_ORIGINS?: string;
  PUSH_SUBSCRIBE_RATE_LIMIT?: string;
  PUSH_SUBSCRIBE_WINDOW_SECONDS?: string;
  PUSH_ADMIN_TOKEN?: string;
  CORS_ALLOWED_ORIGINS?: string;
};



// ---------------------------------------------------------------------------
// Queue message types (unchanged from original)
// ---------------------------------------------------------------------------

export type QueueJobBase = {
  runId: string;
  fetchedAt: string;
  sourceVersion: string | null;
  sourceLocale: string;
  targetLanguages: readonly string[];
};

export type PrepareWorldStateRunMessage = QueueJobBase & {
  type: "worldstate.prepare-run";
  rawSnapshotKey: string;
  force: boolean;
};

export type ProcessWorldStateRootMessage = QueueJobBase & {
  type: "worldstate.process-root";
  rawSnapshotKey: string;
  rootKey: string;
  previousHash: string | null;
  nextHash: string;
};

export type TranslateQueueMessage = QueueJobBase & {
  type: "worldstate.translate-root";
  rootKey: string;
  payloadKey: string;
};

export type TranslatePingMessage = {
  type: "worldstate.translate-ping";
  rootKey: string;
  lang: string;
  hash: string;
  runId: string;
  fetchedAt: string;
};

export type QueueMessage =
  | PrepareWorldStateRunMessage
  | ProcessWorldStateRootMessage
  | TranslateQueueMessage
  | TranslatePingMessage;
