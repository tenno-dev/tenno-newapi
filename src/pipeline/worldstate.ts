import { AppContext } from "../app/types";
import { buildRootPayloadKey } from "../cache/keys";
import { loadCurrentRootPayload, loadLatestRunMeta } from "../cache/store";
import { classifyPushCandidateKeys, classifyPushCandidates } from "./classification";
import { diffRootHashes, diffRootItems, hashRootValues, RootHashMap, stableStringify, hashString } from "../tennodev/diff";
import { TRANSLATE_TARGET_LANGUAGES } from "../tennodev/languages";
import { fetchWorldState } from "../tennodev/client";
import { WORLDSTATE_BUCKETS } from "../tennodev/sections";
import {
  finalizeWorldStateRun,
  getItemChangeDailyStats,
  getItemChangeStats,
  getPipelineRunCount,
  loadPreviousRootValues,
  persistWorldStateRun,
} from "./persistence";
import {
  buildWorldStateCachePlanModel,
  buildWorldStateSplitModel,
  buildWorldStateStatusModel,
} from "./read-models";
import { buildPrepareWorldStateRunMessage, buildTranslateQueueMessages } from "./messages";
import { saveRawSnapshot } from "../cache/store";
import { TOP_LEVEL_WORLDSTATE_KEYS, RawWorldState } from "../types/worldstate";

export async function getWorldStateSplit() {
  return buildWorldStateSplitModel();
}

export async function getWorldStateCachePlan(locale = "en") {
  return buildWorldStateCachePlanModel(locale);
}

export async function executeWorldStatePush(
  c: AppContext,
  options: { dryRun: boolean; force: boolean }
) {
  const sourceLocale = "en";
  const fetchedAt = new Date().toISOString();
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const worldState = await fetchWorldState();
  const rawPayload = JSON.stringify(worldState);
  const sourceVersionRaw = worldState.Version;
  const sourceVersion =
    typeof sourceVersionRaw === "number" || typeof sourceVersionRaw === "string"
      ? String(sourceVersionRaw)
      : null;

  if (!options.dryRun) {
    const rawSnapshotKey = await saveRawSnapshot(c.env.TENNODEV_WORLDSTATE_KV, runId, rawPayload);
    const prepareMessage = buildPrepareWorldStateRunMessage({
      runId,
      fetchedAt,
      sourceVersion,
      sourceLocale,
      targetLanguages: TRANSLATE_TARGET_LANGUAGES,
      rawSnapshotKey,
      force: options.force,
    });

    await c.env.TENNODEV_PUSH_QUEUE.send(prepareMessage);

    return {
      ok: true,
      accepted: true,
      mode: "async-fanout",
      stage: "queued",
      runId,
      fetchedAt,
      sourceVersion,
      dryRun: false,
      force: options.force,
      changedCount: null,
      changedItemCount: null,
      changedRootKeys: null,
      pushCandidateKeys: null,
      nonPushKeys: null,
      queuedCount: 1,
      sourceLocale,
      targetLanguages: TRANSLATE_TARGET_LANGUAGES,
      queueActive: true,
      rawSnapshotKey,
      changedPayloadKeys: [],
      queuePreview: [prepareMessage],
    };
  }

  const analysis = await analyzeWorldStateDiffs(c.env.TENNODEV_WORLDSTATE_KV, worldState, options.force);
  const changed = analysis.changed;
  const classification = analysis.classification;
  const previousRootValues = await loadPreviousRootValues(
    c.env.TENNODEV_WORLDSTATE_KV,
    changed.map((item) => item.rootKey)
  );

  const changedPayloadValues = changed.map((item) => ({
    rootKey: item.rootKey,
    payload: JSON.stringify(worldState[item.rootKey]),
  }));

  const itemChanges = (
    await Promise.all(
      changed.map((item) =>
        diffRootItems(item.rootKey, previousRootValues[item.rootKey], worldState[item.rootKey])
      )
    )
  ).flat();

  const dryRunPayloadKeys = changed.map((item) => ({
    rootKey: item.rootKey,
    payloadKey: buildRootPayloadKey(item.rootKey, runId),
  }));

  let rawSnapshotKey: string | null = null;
  let changedPayloadKeys: Array<{ rootKey: string; kvKey: string }> = [];
  let queueMessages = buildTranslateQueueMessages(
    {
      runId,
      fetchedAt,
      sourceVersion,
      sourceLocale,
      targetLanguages: TRANSLATE_TARGET_LANGUAGES,
    },
    dryRunPayloadKeys
  );
  let queuedCount = 0;

  if (!options.dryRun) {
    const persisted = await persistWorldStateRun(c.env, {
      runId,
      fetchedAt,
      sourceVersion,
      rawPayload,
      nextHashes: analysis.nextHashes,
      changed,
      changedPayloadValues,
      itemChanges,
    });

    rawSnapshotKey = persisted.rawSnapshotKey;
    changedPayloadKeys = persisted.changedPayloadKeys;
    queueMessages = buildTranslateQueueMessages(
      {
        runId,
        fetchedAt,
        sourceVersion,
        sourceLocale,
        targetLanguages: TRANSLATE_TARGET_LANGUAGES,
      },
      changedPayloadKeys.map((item) => ({ rootKey: item.rootKey, payloadKey: item.kvKey }))
    );

    for (const message of queueMessages) {
      await c.env.TENNODEV_PUSH_QUEUE.send(message);
      queuedCount += 1;
    }

    await finalizeWorldStateRun(c.env, {
      runId,
      fetchedAt,
      sourceVersion,
      changedRootKeys: changed.map((item) => item.rootKey),
      changedCount: changed.length,
      queuedCount,
      dryRun: options.dryRun,
      force: options.force,
      sourceLocale,
      targetLanguages: TRANSLATE_TARGET_LANGUAGES,
    });
  } else {
    changedPayloadKeys = dryRunPayloadKeys.map((item) => ({ rootKey: item.rootKey, kvKey: item.payloadKey }));
  }

  return {
    ok: true,
    runId,
    fetchedAt,
    sourceVersion,
    dryRun: options.dryRun,
    force: options.force,
    changedCount: changed.length,
    changedItemCount: itemChanges.length,
    changedRootKeys: changed.map((item) => item.rootKey),
    pushCandidateKeys: classification.pushCandidateKeys,
    nonPushKeys: classification.nonPushKeys,
    queuedCount,
    sourceLocale,
    targetLanguages: TRANSLATE_TARGET_LANGUAGES,
    queueActive: true,
    rawSnapshotKey,
    changedPayloadKeys,
    queuePreview: queueMessages,
  };
}

export async function getWorldStateStatus(c: AppContext) {
  const latestRun = await loadLatestRunMeta(c.env.TENNODEV_WORLDSTATE_KV);
  const rootHashes = await loadCurrentRootHashes(c.env.TENNODEV_WORLDSTATE_KV);
  const totalRuns = await getPipelineRunCount(c.env.TENNODEV_WORLDSTATE_D1);

  return buildWorldStateStatusModel({
    latestRun,
    rootHashCount: Object.keys(rootHashes).length,
    d1RunCount: totalRuns,
  });
}

export async function loadCurrentRootHashes(kv: KVNamespace): Promise<RootHashMap> {
  const currentEntries = await Promise.all(
    TOP_LEVEL_WORLDSTATE_KEYS.map(async (rootKey) => ({
      rootKey,
      value: await loadCurrentRootPayload(kv, rootKey),
    }))
  );
  const hashes: RootHashMap = {};

  await Promise.all(
    currentEntries.map(async (entry) => {
      if (entry.value !== null) {
        hashes[entry.rootKey] = await hashString(stableStringify(entry.value));
      }
    })
  );

  return hashes;
}

export async function analyzeWorldStateDiffs(
  kv: KVNamespace,
  worldState: RawWorldState,
  force: boolean
): Promise<{
  nextHashes: RootHashMap;
  changed: Array<{ rootKey: string; previousHash: string | null; nextHash: string; changed: boolean }>;
  classification: { pushCandidateKeys: string[]; nonPushKeys: string[] };
}> {
  const nextHashes = await hashRootValues(worldState);
  const previousHashes = await loadCurrentRootHashes(kv);
  const diffs = diffRootHashes(previousHashes, nextHashes, force);
  const changed = diffs.filter((item) => item.changed);

  return {
    nextHashes,
    changed,
    classification: classifyPushCandidates(changed),
  };
}

export async function getLatestPushCandidates(c: AppContext) {
  const latestRun = await loadLatestRunMeta(c.env.TENNODEV_WORLDSTATE_KV);
  const changedRootKeys = latestRun?.changedRootKeys ?? [];
  const classification = classifyPushCandidateKeys(changedRootKeys);

  return {
    ok: true,
    latestRun,
    changedRootKeys,
    pushCandidateKeys: classification.pushCandidateKeys,
    nonPushKeys: classification.nonPushKeys,
  };
}

export async function getWorldStateStats(c: AppContext, days: number) {
  const safeDays = Math.max(1, Math.min(days, 365));
  const rootKeyStats = await getItemChangeStats(c.env.TENNODEV_WORLDSTATE_D1, safeDays);

  return {
    ok: true,
    days: safeDays,
    rootKeyStats,
  };
}

export async function getWorldStateDailyStats(c: AppContext, days: number, rootKey?: string) {
  const safeDays = Math.max(1, Math.min(days, 365));
  const dailyRootKeyStats = await getItemChangeDailyStats(
    c.env.TENNODEV_WORLDSTATE_D1,
    safeDays,
    rootKey
  );

  return {
    ok: true,
    days: safeDays,
    rootKey: rootKey ?? null,
    dailyRootKeyStats,
  };
}

export { WORLDSTATE_BUCKETS };
