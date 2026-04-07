import { Context } from "hono";

export type Bindings = {
  TENNODEV_WORLDSTATE_KV: KVNamespace;
  TENNODEV_ASSETS_R2: R2Bucket;
  TENNODEV_WORLDSTATE_D1: D1Database;
  TENNODEV_PUSH_QUEUE: Queue;
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

export type QueueMessage =
  | PrepareWorldStateRunMessage
  | ProcessWorldStateRootMessage
  | TranslateQueueMessage;