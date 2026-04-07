import { Bindings } from "../app/types";

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/main/data";

/**
 * Files present in each language directory (and at root for English).
 * Mirrors the structure of WFCD/warframe-worldstate-data /data/{lang}/{file}.json
 */
const TRANSLATION_FILES = [
  "arcanes",
  "archonShards",
  "conclaveData",
  "eventsData",
  "factionsData",
  "fissureModifiers",
  "languages",
  "missionTypes",
  "operationTypes",
  "persistentEnemyData",
  "solNodes",
  "sortieData",
  "steelPath",
  "syndicatesData",
  "synthTargets",
  "tutorials",
  "upgradeTypes",
] as const;

export type TranslationFileName = (typeof TRANSLATION_FILES)[number];

type MatchCandidate = "topKey" | "name" | "regex" | "imageKey";

type FileObjectIndex = {
  matchOrder: MatchCandidate[];
  entries: Record<string, Record<string, unknown>>;
};

export type TranslationObjectIndex = {
  files: Partial<Record<TranslationFileName, FileObjectIndex>>;
};

const FILE_MATCH_ORDER: Record<TranslationFileName, MatchCandidate[]> = {
  arcanes: ["name", "regex"],
  archonShards: ["topKey", "name", "regex"],
  conclaveData: ["topKey", "name", "regex"],
  eventsData: ["topKey", "name", "regex"],
  factionsData: ["topKey", "name", "regex"],
  fissureModifiers: ["topKey", "name", "regex"],
  languages: ["topKey"],
  missionTypes: ["topKey"],
  operationTypes: ["topKey"],
  persistentEnemyData: ["name", "topKey", "regex"],
  solNodes: ["topKey", "name", "regex"],
  sortieData: ["topKey", "name", "regex"],
  steelPath: ["name", "topKey", "regex"],
  syndicatesData: ["topKey", "name", "regex"],
  synthTargets: ["name", "imageKey", "topKey", "regex"],
  tutorials: ["regex", "name", "topKey"],
  upgradeTypes: ["topKey"],
};

/**
 * Languages to sync. English uses root-level files; all others use data/{lang}/.
 * Matches TRANSLATE_TARGET_LANGUAGES minus any lang without a directory.
 */
const TRANSLATION_LANGS = [
  "de",
  "es",
  "fr",
  "it",
  "ko",
  "pl",
  "pt",
  "ru",
  "zh",
  "uk",
  "en",
] as const;

export const TRANSLATION_R2_PREFIX = "translations";
const TRANSLATION_SYNC_STATE_KEY = "wf:translations:sync:state";

/** R2 key for a single translation file. */
export function translationR2Key(lang: string, file: string): string {
  return `${TRANSLATION_R2_PREFIX}/${lang}/${file}.json`;
}

/** R2 key for the merged flat index for a language. */
export function translationIndexR2Key(lang: string): string {
  return `${TRANSLATION_R2_PREFIX}/${lang}/_index.json`;
}

/** R2 key for object merge index for a language (regex/name/top-key lookup). */
export function translationObjectIndexR2Key(lang: string): string {
  return `${TRANSLATION_R2_PREFIX}/${lang}/_object-index.json`;
}

/** GitHub Raw URL for a translation file. English lives at root; others in a sub-directory. */
function fileUrl(lang: string, file: string): string {
  return lang === "en"
    ? `${GITHUB_RAW_BASE}/${file}.json`
    : `${GITHUB_RAW_BASE}/${lang}/${file}.json`;
}

type TranslationFileData = unknown;

/**
 * Recursively flattens a translation file into a flat `Record<lookupKey, string>`.
 *
 * Rules:
 * - Top-level arrays are skipped entirely. Array-format files (arcanes, synthTargets,
 *   tutorials) cannot be keyed by a stable lookup key and must be fetched from R2
 *   directly when full multi-field data (name, effect, rarity, etc.) is needed.
 * - String leaf values: `{ "SORTIE_MODIFIER_LOW_ENERGY": "Energy" }` → indexed as-is.
 * - `{ value: "..." }` entries: `{ "MT_CAPTURE": { value: "Capture" } }` → indexed by key.
 * - `{ name: "..." }` entries: `{ "ArbitersSyndicate": { name: "..." } }` → indexed by key.
 * - Container objects with no primary value trigger recursive descent, which handles
 *   nested maps like sortieData `{ modifierTypes: { "KEY": "string" } }` and
 *   conclaveData `{ modes: { "KEY": { value: "..." } } }`.
 * - Multi-field entries (e.g. solNodes `{ value, enemy, type }`) only index the primary
 *   field. Full objects are available from the per-file R2 key when all fields are needed.
 */
function flattenToIndex(data: unknown, index: Record<string, string>): void {
  if (Array.isArray(data) || data === null || typeof data !== "object") {
    return;
  }

  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v === "string") {
      index[k] = v;
    } else if (Array.isArray(v) || v === null) {
      // Skip array values (e.g. persistentEnemyData.regions, steelPath.rotation)
      continue;
    } else if (typeof v === "object") {
      const entry = v as Record<string, unknown>;
      if (typeof entry.value === "string") {
        index[k] = entry.value;
      } else if (typeof entry.name === "string") {
        index[k] = entry.name;
      } else {
        // Container object — recurse to reach keyed leaves
        flattenToIndex(v, index);
      }
    }
  }
}

/**
 * Merges multiple parsed translation files into a single flat lookup map.
 * Array-format files (arcanes, synthTargets, tutorials) are silently skipped.
 * Result shape: Record<rawKey, humanReadableString>
 */
export function buildTranslationIndex(
  files: Partial<Record<string, TranslationFileData>>
): Record<string, string> {
  const index: Record<string, string> = {};

  for (const fileData of Object.values(files)) {
    flattenToIndex(fileData, index);
  }

  return index;
}

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function indexObjectByCandidates(
  entry: Record<string, unknown>,
  topKey: string | undefined,
  matchOrder: MatchCandidate[],
  entries: Record<string, Record<string, unknown>>
): void {
  for (const candidate of matchOrder) {
    let raw: string | null = null;

    if (candidate === "topKey") {
      raw = topKey ?? null;
    } else if (candidate === "name" && typeof entry.name === "string") {
      raw = entry.name;
    } else if (candidate === "regex" && typeof entry.regex === "string") {
      raw = entry.regex;
    } else if (candidate === "imageKey" && typeof entry.imageKey === "string") {
      raw = entry.imageKey;
    }

    if (!raw) continue;
    const normalized = normalizeLookupKey(raw);
    if (!normalized) continue;

    // Preserve first write for deterministic behavior by file order.
    if (!(normalized in entries)) {
      entries[normalized] = entry;
    }
  }
}

function walkFileEntries(
  data: unknown,
  matchOrder: MatchCandidate[],
  entries: Record<string, Record<string, unknown>>,
  topKey?: string
): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      if (isPlainRecord(item)) {
        indexObjectByCandidates(item, topKey, matchOrder, entries);
      }
      walkFileEntries(item, matchOrder, entries, topKey);
    }
    return;
  }

  if (!isPlainRecord(data)) {
    return;
  }

  indexObjectByCandidates(data, topKey, matchOrder, entries);

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      // Allow matching keyed string maps (e.g. sortieData modifier types).
      indexObjectByCandidates({ value }, key, matchOrder, entries);
      continue;
    }

    walkFileEntries(value, matchOrder, entries, key);
  }
}

/**
 * Builds a merge index keyed by normalized regex/name/top-key values.
 * Values are full objects from translation files so we can merge extra fields
 * (effect, rarity, location, enemy/type, etc.) into translated worldstate objects.
 */
export function buildTranslationObjectIndex(
  files: Partial<Record<TranslationFileName, TranslationFileData>>
): TranslationObjectIndex {
  const byFile: Partial<Record<TranslationFileName, FileObjectIndex>> = {};

  for (const fileName of TRANSLATION_FILES) {
    const fileData = files[fileName];
    if (!fileData) continue;

    const matchOrder = FILE_MATCH_ORDER[fileName];
    const entries: Record<string, Record<string, unknown>> = {};
    walkFileEntries(fileData, matchOrder, entries);

    byFile[fileName] = { matchOrder, entries };
  }

  return { files: byFile };
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

async function saveTranslationSyncState(kv: KVNamespace, state: TranslationSyncState): Promise<void> {
  await kv.put(TRANSLATION_SYNC_STATE_KEY, JSON.stringify(state));
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

export async function executeTranslationSync(
  env: Bindings
): Promise<TranslationSyncResult> {
  const startedAt = new Date().toISOString();
  const previous = await loadTranslationSyncState(env.TENNODEV_WORLDSTATE_KV);
  await saveTranslationSyncState(env.TENNODEV_WORLDSTATE_KV, {
    ...previous,
    lastStartedAt: startedAt,
  });

  const syncedAt = new Date().toISOString();
  let uploaded = 0;
  let skipped = 0;
  let indexesBuilt = 0;
  let objectIndexesBuilt = 0;
  const errors: Array<{ lang: string; file: string; status: number }> = [];

  for (const lang of TRANSLATION_LANGS) {
    const accumulated: Partial<Record<TranslationFileName, TranslationFileData>> = {};

    for (const file of TRANSLATION_FILES) {
      const url = fileUrl(lang, file);
      const key = translationR2Key(lang, file);

      try {
        const res = await fetch(url);

        if (res.status === 404) {
          // Not all languages have all files — expected
          skipped++;
          continue;
        }

        if (!res.ok) {
          errors.push({ lang, file, status: res.status });
          continue;
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
    }

    // Build and upload merged flat index for this language
    if (Object.keys(accumulated).length > 0) {
      const index = buildTranslationIndex(accumulated);
      const indexKey = translationIndexR2Key(lang);

      await env.TENNODEV_ASSETS_R2.put(indexKey, JSON.stringify(index), {
        httpMetadata: { contentType: "application/json" },
      });
      indexesBuilt++;

      const objectIndex = buildTranslationObjectIndex(accumulated);
      const objectIndexKey = translationObjectIndexR2Key(lang);

      await env.TENNODEV_ASSETS_R2.put(objectIndexKey, JSON.stringify(objectIndex), {
        httpMetadata: { contentType: "application/json" },
      });
      objectIndexesBuilt++;
    }
  }

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
