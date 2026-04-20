import { Bindings, KVStore } from "../../app/types";
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
import { buildTranslationIndexesCombined } from "./indexing";

async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

export async function loadTranslationSyncState(kv: KVStore): Promise<TranslationSyncState> {
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
  kv: KVStore,
  state: TranslationSyncState
): Promise<void> {
  await kv.put(TRANSLATION_SYNC_STATE_KEY, JSON.stringify(state));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    let current: number;
    while ((current = nextIndex++) < items.length) {
      results[current] = await worker(items[current], current);
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < limit; i++) {
    workers.push(runWorker());
  }

  await Promise.all(workers);
  return results;
}

export async function getTranslationSyncStatus(env: Bindings): Promise<{
  state: TranslationSyncState;
  indexAvailability: Array<{ lang: string; index: boolean; objectIndex: boolean }>;
}> {
  const state = await loadTranslationSyncState(env.kv);
  const availability = await Promise.all(
    TRANSLATION_LANGS.map(async (lang) => {
      const index = await env.blob.get(translationIndexR2Key(lang));
      const objectIndex = await env.blob.get(translationObjectIndexR2Key(lang));
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
  const state = await loadTranslationSyncState(env.kv);
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
            skipped++;
            return;
          }

          if (!res.ok) {
            errors.push({ lang, file, status: res.status });
            return;
          }

          const contentText = await res.text();
          const data = JSON.parse(contentText) as TranslationFileData;
          accumulated[file] = data;

          const newHash = await computeContentHash(contentText);

          const existing = await env.blob.get(key);
          let shouldUpload = true;

          if (existing) {
            const existingText = await existing.text();
            const existingHash = await computeContentHash(existingText);
            if (newHash === existingHash) {
              shouldUpload = false;
              skipped++;
            }
          }

          if (shouldUpload) {
            await env.blob.put(key, contentText, {
              httpMetadata: { contentType: "application/json" },
            });
            uploaded++;
          }
        } catch {
          errors.push({ lang, file, status: 0 });
        }
      });

      if (Object.keys(accumulated).length > 0) {
        const { flatIndex, objectIndex } = buildTranslationIndexesCombined(accumulated);

        const flatIndexText = JSON.stringify(flatIndex);
        const objectIndexText = JSON.stringify(objectIndex);

        await env.blob.put(translationIndexR2Key(lang), flatIndexText, {
          httpMetadata: { contentType: "application/json" },
        });
        indexesBuilt++;

        await env.blob.put(translationObjectIndexR2Key(lang), objectIndexText, {
          httpMetadata: { contentType: "application/json" },
        });
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

  await saveTranslationSyncState(env.kv, {
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
