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

const TRANSLATED_ROOT_TTL_SECONDS = 60 * 60 * 24 * 7;

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

function normalizeEmbeddedTranslations(data: unknown, lang: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => normalizeEmbeddedTranslations(item, lang));
  }

  if (!isPlainRecord(data)) {
    return data;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "translations") {
      if (isPlainRecord(value)) {
        const selected = value[lang];
        if (typeof selected === "string") {
          result[key] = selected;
        }
      }
      continue;
    }
    result[key] = normalizeEmbeddedTranslations(value, lang);
  }

  return result;
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
        merged = { ...merged, ...match };
        matched = true;
        break;
      }
    }

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
  const rawPayload = await env.kv.get(message.payloadKey);

  if (!rawPayload) {
    throw new Error(`Payload not found in KV: ${message.payloadKey}`);
  }

  const rootData: unknown = JSON.parse(rawPayload);
  const payloadSize = rawPayload.length;

  const langs = message.targetLanguages;
  let r2Pairs = await Promise.all(
    langs.map(async (lang) => ({
      lang,
      indexObject: await env.blob.get(translationIndexR2Key(lang)),
      objectIndexObject: await env.blob.get(translationObjectIndexR2Key(lang)),
    }))
  );

  const anyMissing = r2Pairs.some((p) => !p.indexObject || !p.objectIndexObject);
  if (anyMissing) {
    await ensureTranslationSyncInitialized(env);

    r2Pairs = await Promise.all(
      r2Pairs.map(async (p) => {
        if (p.indexObject && p.objectIndexObject) {
          return p;
        }
        return {
          lang: p.lang,
          indexObject: await env.blob.get(translationIndexR2Key(p.lang)),
          objectIndexObject: await env.blob.get(translationObjectIndexR2Key(p.lang)),
        };
      })
    );
  }

  await Promise.all(
    r2Pairs.map(async ({ lang, indexObject, objectIndexObject }) => {
      if (!indexObject || !objectIndexObject) {
        return;
      }

      const [index, objectIndex] = await Promise.all([
        indexObject.json<Record<string, string>>(),
        objectIndexObject.json<TranslationObjectIndex>(),
      ]);

      const translatedStrings = applyTranslations(rootData, index);
      const translatedWithObjects = applyObjectMergeTranslations(translatedStrings, objectIndex);
      const translated = normalizeEmbeddedTranslations(translatedWithObjects, lang);
      const serialized = JSON.stringify(translated);

      const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(serialized)
      );
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const translatedHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      const runKey = buildTranslatedRootKey(message.rootKey, lang, message.runId);
      await env.kv.put(runKey, serialized, {
        expirationTtl: TRANSLATED_ROOT_TTL_SECONDS,
      });

      const hashIndexKey = buildTranslatedHashIndexKey(message.rootKey, lang, translatedHash);
      await env.kv.put(hashIndexKey, runKey, {
        expirationTtl: TRANSLATED_ROOT_TTL_SECONDS,
      });

      await saveCurrentTranslatedRootPayloadIfNewer(
        env.kv,
        message.rootKey,
        lang,
        serialized,
        message.runId,
        message.fetchedAt
      );

      await env.queue.send({
        type: "worldstate.translate-ping",
        rootKey: message.rootKey,
        lang,
        hash: translatedHash,
        runId: message.runId,
        fetchedAt: message.fetchedAt,
      });
    })
  );

  await logQueueProcessed(env.sql, {
    runId: message.runId,
    rootKey: message.rootKey,
    payloadKey: message.payloadKey,
    targetLanguages: message.targetLanguages,
    payloadSize,
  });
}
