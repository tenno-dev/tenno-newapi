/**
 * Translation sync orchestration.
 * Handles fetching translation files from GitHub and building indexes.
 */

import { Bindings } from "../../app/types";
import {
  TRANSLATION_LANGS,
  TRANSLATION_FILES,
  TranslationFileName,
  TranslationFileData,
  TRANSLATION_SYNC_STATE_KEY,
  LANG_SYNC_CONCURRENCY,
  FILE_SYNC_CONCURRENCY,
  translationR2Key,
  translationIndexR2Key,
  translationObjectIndexR2Key,
  fileUrl,
} from "./config";
import { buildTranslationIndex, buildTranslationObjectIndex } from "./indexing";

export type TranslationSyncResult = {
  ok: boolean;
  syncedAt: string;
  uploaded: number;
  skipped: number;
  indexesBuilt: number;
  objectIndexesBuilt: number;
  errors: Array<{ lang: string; file: string; status: number }>;
};

export type TranslationSyncState = {
  initialized: boolean;
  lastStartedAt: string | null;
  lastSyncedAt: string | null;
  lastOk: boolean;
  uploaded: number;
  skipped: number;
  indexesBuilt: number;
  objectIndexesBuilt: number;
  errorCount: number;
};

function defaultSyncState(): TranslationSyncState {
  return {
    initialized: false,
    lastStartedAt: null,
    lastSyncedAt: null,
    lastOk: false,
    uploaded: 0,
    skipped: 0,
    indexesBuilt: 0,
    objectIndexesBuilt: 0,
    errorCount: 0,
  };
}

export async function loadTranslationSyncState(kv: KVNamespace): Promise<TranslationSyncState> {
  const raw = await kv.get(TRANSLATION_SYNC_STATE_KEY, "json");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultSyncState();
  }

  const value = raw as Partial<TranslationSyncState>;
  return {
    initialized: !!value.initialized,
    lastStartedAt: value.lastStartedAt ?? null,
    lastSyncedAt: value.lastSyncedAt ?? null,
    lastOk: !!value.lastOk,
    uploaded: Number.isFinite(value.uploaded) ? Number(value.uploaded) : 0,
    skipped: Number.isFinite(value.skipped) ? Number(value.skipped) : 0,
    indexesBuilt: Number.isFinite(value.indexesBuilt) ? Number(value.indexesBuilt) : 0,
    objectIndexesBuilt: Number.isFinite(value.objectIndexesBuilt)
      ? Number(value.objectIndexesBuilt)
      : 0,
    errorCount: Number.isFinite(value.errorCount) ? Number(value.errorCount) : 0,
  };
}

async function saveTranslationSyncState(
  kv: KVNamespace,
  state: TranslationSyncState
): Promise<void> {
  await kv.put(TRANSLATION_SYNC_STATE_KEY, JSON.stringify(state));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex++;

      if (current >= items.length) {
        return;
      }

      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

export async function getTranslationSyncStatus(env: Bindings): Promise<{
  state: TranslationSyncState;
  indexAvailability: Array<{ lang: string; index: boolean; objectIndex: boolean }>;
}> {
  const state = await loadTranslationSyncState(env.TENNODEV_WORLDSTATE_KV);
  const availability = await Promise.all(
    TRANSLATION_LANGS.map(async (lang) => {
      const index = await env.TENNODEV_ASSETS_R2.get(translationIndexR2Key(lang));
      const objectIndex = await env.TENNODEV_ASSETS_R2.get(translationObjectIndexR2Key(lang));
      return { lang, index: index !== null, objectIndex: objectIndex !== null };
    })
  );

  return { state, indexAvailability: availability };
}

export async function ensureTranslationSyncInitialized(env: Bindings): Promise<{
  initialized: boolean;
  bootstrappedNow: boolean;
  result: TranslationSyncResult | null;
}> {
  const state = await loadTranslationSyncState(env.TENNODEV_WORLDSTATE_KV);
  if (state.initialized) {
    return { initialized: true, bootstrappedNow: false, result: null };
  }

  const result = await executeTranslationSync(env);
  return {
    initialized: result.ok && result.indexesBuilt > 0,
    bootstrappedNow: true,
    result,
  };
}

export async function executeTranslationSync(env: Bindings): Promise<TranslationSyncResult> {
  const startedAt = new Date().toISOString();
  const previous = await loadTranslationSyncState(env.TENNODEV_WORLDSTATE_KV);
  await saveTranslationSyncState(env.TENNODEV_WORLDSTATE_KV, {
    ...previous,
    lastStartedAt: startedAt,
  });

  const syncedAt = new Date().toISOString();
  type LangSyncStats = {
    uploaded: number;
    skipped: number;
    indexesBuilt: number;
    objectIndexesBuilt: number;
    errors: Array<{ lang: string; file: string; status: number }>;
  };

  const langStats = await mapWithConcurrency(
    TRANSLATION_LANGS,
    LANG_SYNC_CONCURRENCY,
    async (lang) => {
      const accumulated: Partial<Record<TranslationFileName, TranslationFileData>> = {};
      let uploaded = 0;
      let skipped = 0;
      let indexesBuilt = 0;
      let objectIndexesBuilt = 0;
      const errors: Array<{ lang: string; file: string; status: number }> = [];

      await mapWithConcurrency(TRANSLATION_FILES, FILE_SYNC_CONCURRENCY, async (file) => {
        const url = fileUrl(lang, file);
        const key = translationR2Key(lang, file);

        try {
          const res = await fetch(url);

          if (res.status === 404) {
            // Not all languages have all files — expected
            skipped++;
            return;
          }

          if (!res.ok) {
            errors.push({ lang, file, status: res.status });
            return;
          }

          const data = (await res.json()) as TranslationFileData;
          accumulated[file] = data;

          await env.TENNODEV_ASSETS_R2.put(key, JSON.stringify(data), {
            httpMetadata: { contentType: "application/json" },
          });
          uploaded++;
        } catch {
          errors.push({ lang, file, status: 0 });
        }
      });

      // Build and upload merged flat/object index for this language.
      if (Object.keys(accumulated).length > 0) {
        const index = buildTranslationIndex(accumulated);
        await env.TENNODEV_ASSETS_R2.put(translationIndexR2Key(lang), JSON.stringify(index), {
          httpMetadata: { contentType: "application/json" },
        });
        indexesBuilt++;

        const objectIndex = buildTranslationObjectIndex(accumulated);
        await env.TENNODEV_ASSETS_R2.put(
          translationObjectIndexR2Key(lang),
          JSON.stringify(objectIndex),
          {
            httpMetadata: { contentType: "application/json" },
          }
        );
        objectIndexesBuilt++;
      }

      return { uploaded, skipped, indexesBuilt, objectIndexesBuilt, errors } satisfies LangSyncStats;
    }
  );

  const uploaded = langStats.reduce((sum, stat) => sum + stat.uploaded, 0);
  const skipped = langStats.reduce((sum, stat) => sum + stat.skipped, 0);
  const indexesBuilt = langStats.reduce((sum, stat) => sum + stat.indexesBuilt, 0);
  const objectIndexesBuilt = langStats.reduce((sum, stat) => sum + stat.objectIndexesBuilt, 0);
  const errors = langStats.flatMap((stat) => stat.errors);

  const result = {
    ok: errors.length === 0,
    syncedAt,
    uploaded,
    skipped,
    indexesBuilt,
    objectIndexesBuilt,
    errors,
  };

  await saveTranslationSyncState(env.TENNODEV_WORLDSTATE_KV, {
    initialized: result.ok && result.indexesBuilt > 0,
    lastStartedAt: startedAt,
    lastSyncedAt: syncedAt,
    lastOk: result.ok,
    uploaded,
    skipped,
    indexesBuilt,
    objectIndexesBuilt,
    errorCount: errors.length,
  });

  return result;
}
