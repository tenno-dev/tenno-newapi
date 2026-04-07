import {
  PrepareWorldStateRunMessage,
  ProcessWorldStateRootMessage,
  QueueJobBase,
  TranslateQueueMessage,
} from "../app/types";

export function buildPrepareWorldStateRunMessage(
  input: QueueJobBase & { rawSnapshotKey: string; force: boolean }
): PrepareWorldStateRunMessage {
  return {
    type: "worldstate.prepare-run",
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
    rawSnapshotKey: input.rawSnapshotKey,
    force: input.force,
  };
}

export function buildProcessWorldStateRootMessages(
  input: QueueJobBase & { rawSnapshotKey: string },
  payloads: Array<{ rootKey: string; previousHash: string | null; nextHash: string }>
): ProcessWorldStateRootMessage[] {
  return payloads.map((payload) => ({
    type: "worldstate.process-root",
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
    rawSnapshotKey: input.rawSnapshotKey,
    rootKey: payload.rootKey,
    previousHash: payload.previousHash,
    nextHash: payload.nextHash,
  }));
}

export function buildTranslateQueueMessages(
  input: QueueJobBase,
  payloads: Array<{ rootKey: string; payloadKey: string }>
): TranslateQueueMessage[] {
  return payloads.map((payload) => ({
    type: "worldstate.translate-root",
    runId: input.runId,
    fetchedAt: input.fetchedAt,
    sourceVersion: input.sourceVersion,
    sourceLocale: input.sourceLocale,
    targetLanguages: input.targetLanguages,
    rootKey: payload.rootKey,
    payloadKey: payload.payloadKey,
  }));
}
