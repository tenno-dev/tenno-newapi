import { Context } from "hono";

export type Bindings = {
  TENNODEV_WORLDSTATE_KV: KVNamespace;
  TENNODEV_ASSETS_R2: R2Bucket;
  TENNODEV_WORLDSTATE_D1: D1Database;
  TENNODEV_PUSH_QUEUE: Queue;
  APP_ENV?: string;
  DEPLOY_TRIGGER_TOKEN?: string;
  WORLDSTATE_SOURCE_URL?: string;
  WORLDSTATE_SOURCE_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
};

export type AppEnv = {
  Bindings: Bindings;
};

export type AppContext = Context<AppEnv>;

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