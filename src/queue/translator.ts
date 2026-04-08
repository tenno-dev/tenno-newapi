import { Bindings, TranslateQueueMessage } from "../app/types";
import {
  buildCurrentTranslatedRootKey,
  buildTranslatedHashIndexKey,
  buildTranslatedRootKey,
} from "../cache/keys";
import { saveCurrentTranslatedRootPayloadIfNewer } from "../cache/store";
import { logQueueProcessed } from "../pipeline/persistence";
import {
  ensureTranslationSyncInitialized,
  translationIndexR2Key,
  translationObjectIndexR2Key,
} from "../pipeline/translations";
import type { TranslationObjectIndex, TranslationFileName } from "../pipeline/translations";

const TRANSLATED_ROOT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Recursively walks `data` and replaces any string value that exists as a key
 * in `index` with the corresponding human-readable string.
 * Non-matching strings, numbers, booleans, and null are left unchanged.
 */
function applyTranslations(data: unknown, index: Record<string, string>): unknown {
  if (typeof data === "string") {
    const exact = index[data];
    if (typeof exact === "string") {
      return exact;
    }

    const normalized = index[normalizeLookupKey(data)];
    return typeof normalized === "string" ? normalized : data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => applyTranslations(item, index));
  }

  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      result[k] = applyTranslations(v, index);
    }

    return result;
  }

  return data;
}

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

type MatchCandidate = "topKey" | "name" | "regex" | "imageKey";

function candidateValue(
  candidate: MatchCandidate,
  data: Record<string, unknown>,
  topKey?: string
): string | null {
  if (candidate === "topKey") return topKey ?? null;
  if (candidate === "name" && typeof data.name === "string") return data.name;
  if (candidate === "regex" && typeof data.regex === "string") return data.regex;
  if (candidate === "imageKey" && typeof data.imageKey === "string") return data.imageKey;
  return null;
}

function applyObjectMergeTranslations(
  data: unknown,
  objectIndex: TranslationObjectIndex,
  topKey?: string
): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => applyObjectMergeTranslations(item, objectIndex, topKey));
  }

  if (!isPlainRecord(data)) {
    return data;
  }

  let merged: Record<string, unknown> = { ...data };
  let matched = false;

  const files = objectIndex.files as Partial<
    Record<TranslationFileName, { matchOrder: MatchCandidate[]; entries: Record<string, Record<string, unknown>> }>
  >;

  for (const fileName of Object.keys(files) as TranslationFileName[]) {
    const file = files[fileName];
    if (!file) continue;

    for (const candidate of file.matchOrder) {
      const raw = candidateValue(candidate, data, topKey);
      if (!raw) continue;

      const match = file.entries[normalizeLookupKey(raw)];
      if (match) {
        // Merge translation object fields into current node (translation wins).
        merged = { ...merged, ...match };
        matched = true;
        break;
      }
    }

    // Stop after first matching file to keep behavior deterministic.
    if (matched) {
      break;
    }
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    result[k] = applyObjectMergeTranslations(v, objectIndex, k);
  }

  return result;
}

export async function processTranslationMessage(
  env: Bindings,
  message: TranslateQueueMessage
): Promise<void> {
  // 1. Load the root worldstate payload from KV
  const rawPayload = await env.TENNODEV_WORLDSTATE_KV.get(message.payloadKey);

  if (!rawPayload) {
    throw new Error(`Payload not found in KV: ${message.payloadKey}`);
  }

  const rootData: unknown = JSON.parse(rawPayload);
  const payloadSize = rawPayload.length;
  let attemptedBootstrap = false;

  // 2. For each target language, load the merged index from R2, translate, write to KV
  for (const lang of message.targetLanguages) {
    const indexKey = translationIndexR2Key(lang);
    const objectIndexKey = translationObjectIndexR2Key(lang);
    let indexObject = await env.TENNODEV_ASSETS_R2.get(indexKey);
    let objectIndexObject = await env.TENNODEV_ASSETS_R2.get(objectIndexKey);

    if ((!indexObject || !objectIndexObject) && !attemptedBootstrap) {
      attemptedBootstrap = true;
      await ensureTranslationSyncInitialized(env);
      indexObject = await env.TENNODEV_ASSETS_R2.get(indexKey);
      objectIndexObject = await env.TENNODEV_ASSETS_R2.get(objectIndexKey);
    }

    if (!indexObject || !objectIndexObject) {
      // Indexes still unavailable for this language.
      continue;
    }

    const index = await indexObject.json<Record<string, string>>();
    const objectIndex = await objectIndexObject.json<TranslationObjectIndex>();
    const translatedStrings = applyTranslations(rootData, index);
    const translated = applyObjectMergeTranslations(translatedStrings, objectIndex);
    const serialized = JSON.stringify(translated);

    // Compute hash of translated payload for web push ping indexing
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(serialized)
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const translatedHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // Per-run snapshot (expires after 7 days)
    const runKey = buildTranslatedRootKey(message.rootKey, lang, message.runId);
    await env.TENNODEV_WORLDSTATE_KV.put(runKey, serialized, {
      expirationTtl: TRANSLATED_ROOT_TTL_SECONDS,
    });

    // Store KV index: (rootKey, lang, hash) => runKey (TTL aligned with run snapshot)
    const hashIndexKey = buildTranslatedHashIndexKey(message.rootKey, lang, translatedHash);
    await env.TENNODEV_WORLDSTATE_KV.put(hashIndexKey, runKey, {
      expirationTtl: TRANSLATED_ROOT_TTL_SECONDS,
    });

    // Current pointer (no TTL — always latest)
    await saveCurrentTranslatedRootPayloadIfNewer(
      env.TENNODEV_WORLDSTATE_KV,
      message.rootKey,
      lang,
      serialized,
      message.runId,
      message.fetchedAt
    );

    // Enqueue ping notification for subscribed clients
    await env.TENNODEV_PUSH_QUEUE.send({
      type: "worldstate.translate-ping",
      rootKey: message.rootKey,
      lang,
      hash: translatedHash,
      runId: message.runId,
      fetchedAt: message.fetchedAt,
    });
  }

  // 3. Log success to D1
  await logQueueProcessed(env.TENNODEV_WORLDSTATE_D1, {
    runId: message.runId,
    rootKey: message.rootKey,
    payloadKey: message.payloadKey,
    targetLanguages: message.targetLanguages,
    payloadSize,
  });
}
