import { Bindings } from "../../app/types";
import { buildRootPayloadKey } from "../../cache/keys";
import { saveRawSnapshot } from "../../cache/store";
import { diffRootItems } from "../../tennodev/diff";
import { TRANSLATE_TARGET_LANGUAGES } from "../../tennodev/languages";
import { fetchWorldState } from "../../tennodev/client";
import {
  buildPrepareWorldStateRunMessage,
  buildTranslateQueueMessages,
} from "../messages";
import {
  persistWorldStateRun,
  finalizeWorldStateRun,
  loadPreviousRootValues,
} from "../persistence";
import { analyzeWorldStateDiffs } from "./analysis";
import { ensureTranslationSyncInitialized } from "../translations";

export async function executeWorldStatePush(
  env: Bindings,
  options: { dryRun: boolean; force: boolean }
) {
  const sourceLocale = "en";
  const fetchedAt = new Date().toISOString();
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const configuredSource = env.WORLDSTATE_SOURCE_URL?.trim();

  let worldStateSource: string | undefined = undefined;
  if (configuredSource) {
    const url = new URL(configuredSource);
    const token = env.WORLDSTATE_SOURCE_TOKEN?.trim();
    if (token) {
      url.searchParams.set("url", token);
    }
    worldStateSource = url.toString();
  }

  const worldState = await fetchWorldState(worldStateSource || undefined);
  const rawPayload = JSON.stringify(worldState);
  const sourceVersionRaw = worldState.Version;
  const sourceVersion =
    typeof sourceVersionRaw === "number" || typeof sourceVersionRaw === "string"
      ? String(sourceVersionRaw)
      : null;

  const translationBootstrap = options.dryRun
    ? { initialized: false, bootstrappedNow: false, result: null }
    : await ensureTranslationSyncInitialized(env);

  if (!options.dryRun) {
    const rawSnapshotKey = await saveRawSnapshot(env.kv, runId, rawPayload);
    const prepareMessage = buildPrepareWorldStateRunMessage({
      runId,
      fetchedAt,
      sourceVersion,
      sourceLocale,
      targetLanguages: TRANSLATE_TARGET_LANGUAGES,
      rawSnapshotKey,
      force: options.force,
    });

    await env.queue.send(prepareMessage);

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
      translationBootstrap,
      rawSnapshotKey,
      changedPayloadKeys: [],
      queuePreview: [prepareMessage],
    };
  }

  const analysis = await analyzeWorldStateDiffs(env.kv, worldState, options.force);
  const changed = analysis.changed;
  const classification = analysis.classification;
  const previousRootValues = await loadPreviousRootValues(
    env.kv,
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
  const queueMessages = buildTranslateQueueMessages(
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

  changedPayloadKeys = dryRunPayloadKeys.map((item) => ({
    rootKey: item.rootKey,
    kvKey: item.payloadKey,
  }));

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
    translationBootstrap,
    rawSnapshotKey,
    changedPayloadKeys,
    queuePreview: queueMessages,
  };
}
