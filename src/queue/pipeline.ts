import {
  PrepareWorldStateRunMessage,
  ProcessWorldStateRootMessage,
  Bindings,
} from "../app/types";
import {
  deleteCurrentRootPayloadIfNewer,
  loadCurrentRootPayload,
  loadRawSnapshotByKey,
  saveCurrentRootPayloadIfNewer,
  saveLastKnownRootPayload,
} from "../cache/store";
import { SQL } from "../db/sql";
import { classifyPushCandidates } from "../pipeline/classification";
import {
  recordPreparedWorldStateRun,
  writeRootChange,
} from "../pipeline/persistence";
import { buildProcessWorldStateRootMessages, buildTranslateQueueMessages } from "../pipeline/messages";
import { diffRootItems } from "../tennodev/diff";
import { RawWorldState } from "../types/worldstate";
import { analyzeWorldStateDiffs } from "../pipeline/worldstate";

function parseStoredWorldState(rawPayload: string): RawWorldState {
  const data = JSON.parse(rawPayload) as unknown;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid stored worldState payload: expected a JSON object");
  }

  return data as RawWorldState;
}

export async function handlePrepareWorldStateRun(
  env: Bindings,
  message: PrepareWorldStateRunMessage
): Promise<void> {
  const rawPayload = await loadRawSnapshotByKey(env.TENNODEV_WORLDSTATE_KV, message.rawSnapshotKey);

  if (!rawPayload) {
    throw new Error(`Missing raw snapshot for run ${message.runId}`);
  }

  const worldState = parseStoredWorldState(rawPayload);
  const analysis = await analyzeWorldStateDiffs(
    env.TENNODEV_WORLDSTATE_KV,
    worldState,
    message.force
  );
  const processMessages = buildProcessWorldStateRootMessages(
    {
      runId: message.runId,
      fetchedAt: message.fetchedAt,
      sourceVersion: message.sourceVersion,
      sourceLocale: message.sourceLocale,
      targetLanguages: message.targetLanguages,
      rawSnapshotKey: message.rawSnapshotKey,
    },
    analysis.changed.map((item) => ({
      rootKey: item.rootKey,
      previousHash: item.previousHash,
      nextHash: item.nextHash,
    }))
  );
  const classification = classifyPushCandidates(analysis.changed);

  await recordPreparedWorldStateRun(env, {
    runId: message.runId,
    fetchedAt: message.fetchedAt,
    sourceVersion: message.sourceVersion,
    rawSnapshotKey: message.rawSnapshotKey,
    changedRootKeys: analysis.changed.map((item) => item.rootKey),
    changedCount: analysis.changed.length,
    queuedCount: processMessages.length,
    force: message.force,
    sourceLocale: message.sourceLocale,
    targetLanguages: message.targetLanguages,
    pushCandidateKeys: classification.pushCandidateKeys,
    nonPushKeys: classification.nonPushKeys,
  });

  for (const processMessage of processMessages) {
    await env.TENNODEV_PUSH_QUEUE.send(processMessage);
  }
}

export async function handleProcessWorldStateRoot(
  env: Bindings,
  message: ProcessWorldStateRootMessage
): Promise<void> {
  const rawPayload = await loadRawSnapshotByKey(env.TENNODEV_WORLDSTATE_KV, message.rawSnapshotKey);

  if (!rawPayload) {
    throw new Error(`Missing raw snapshot for run ${message.runId}`);
  }

  const worldState = parseStoredWorldState(rawPayload);
  const hasRootKey = Object.prototype.hasOwnProperty.call(worldState, message.rootKey);
  const nextValue = hasRootKey ? worldState[message.rootKey] : undefined;
  const previousValue = await loadCurrentRootPayload(env.TENNODEV_WORLDSTATE_KV, message.rootKey);
  const itemChanges = await diffRootItems(message.rootKey, previousValue, nextValue);
  const payload = JSON.stringify(hasRootKey ? nextValue : null);

  const kvKey = await writeRootChange(env, {
    runId: message.runId,
    rootKey: message.rootKey,
    previousHash: message.previousHash,
    nextHash: message.nextHash,
    payload,
    itemChanges,
  });

  if (hasRootKey) {
    await saveCurrentRootPayloadIfNewer(
      env.TENNODEV_WORLDSTATE_KV,
      message.rootKey,
      payload,
      message.runId,
      message.fetchedAt
    );
    await saveLastKnownRootPayload(env.TENNODEV_WORLDSTATE_KV, message.rootKey, payload);

    const translateMessages = buildTranslateQueueMessages(
      {
        runId: message.runId,
        fetchedAt: message.fetchedAt,
        sourceVersion: message.sourceVersion,
        sourceLocale: message.sourceLocale,
        targetLanguages: message.targetLanguages,
      },
      [{ rootKey: message.rootKey, payloadKey: kvKey }]
    );

    for (const translateMessage of translateMessages) {
      await env.TENNODEV_PUSH_QUEUE.send(translateMessage);
    }
  } else {
    await deleteCurrentRootPayloadIfNewer(
      env.TENNODEV_WORLDSTATE_KV,
      message.rootKey,
      message.runId,
      message.fetchedAt
    );
  }
}