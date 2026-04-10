/**
 * Translation index building and lookup.
 * Handles flattening and merging translation files into searchable indexes.
 */

import {
  TranslationFileName,
  TranslationFileData,
  MatchCandidate,
  FileObjectIndex,
  TranslationObjectIndex,
  TRANSLATION_FILES,
  FILE_MATCH_ORDER,
} from "./config";

type BuildIndexOutput = {
  flatIndex: Record<string, string>;
  objectIndex: TranslationObjectIndex;
};

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
export function flattenToIndex(data: unknown, index: Record<string, string>): void {
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

/**
 * Indexes both flat string values and object entries for a single entry.
 * Single-pass alternative to separate flattenToIndex + indexObjectByCandidates.
 */
function indexEntryByCandidates(
  entry: Record<string, unknown>,
  topKey: string | undefined,
  matchOrder: MatchCandidate[],
  objectEntries: Record<string, Record<string, unknown>>,
  flatIndex: Record<string, string>
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
    if (!(normalized in objectEntries)) {
      objectEntries[normalized] = entry;
    }
  }

  // Also add to flat index if this has a string value and a top key
  if (topKey && typeof entry.value === "string" && !(topKey in flatIndex)) {
    flatIndex[topKey] = entry.value;
  } else if (topKey && typeof entry.name === "string" && !(topKey in flatIndex)) {
    flatIndex[topKey] = entry.name;
  }
}

/**
 * Single-pass tree walk that builds both flat and object indexes simultaneously.
 * More memory-efficient than separate walks.
 */
function walkFileEntriesCombined(
  data: unknown,
  matchOrder: MatchCandidate[],
  objectEntries: Record<string, Record<string, unknown>>,
  flatIndex: Record<string, string>,
  topKey?: string
): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      if (isPlainRecord(item)) {
        indexEntryByCandidates(item, topKey, matchOrder, objectEntries, flatIndex);
      }
      walkFileEntriesCombined(item, matchOrder, objectEntries, flatIndex, topKey);
    }
    return;
  }

  if (!isPlainRecord(data)) {
    return;
  }

  indexEntryByCandidates(data, topKey, matchOrder, objectEntries, flatIndex);

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      // Allow matching keyed string maps (e.g. sortieData modifier types).
      indexEntryByCandidates({ value }, key, matchOrder, objectEntries, flatIndex);
      continue;
    }

    walkFileEntriesCombined(value, matchOrder, objectEntries, flatIndex, key);
  }
}

/**
 * Builds both flat and object indexes in a single tree walk per file.
 * More efficient than separate flat and object index builds.
 * Returns both indexes in one pass.
 */
export function buildTranslationIndexesCombined(
  files: Partial<Record<TranslationFileName, TranslationFileData>>
): BuildIndexOutput {
  const flatIndex: Record<string, string> = {};
  const byFile: Partial<Record<TranslationFileName, FileObjectIndex>> = {};

  for (const fileName of TRANSLATION_FILES) {
    const fileData = files[fileName];
    if (!fileData) continue;

    const matchOrder = FILE_MATCH_ORDER[fileName];
    const objectEntries: Record<string, Record<string, unknown>> = {};

    // Single pass: populates both flatIndex and objectEntries
    walkFileEntriesCombined(fileData, matchOrder, objectEntries, flatIndex);

    byFile[fileName] = { matchOrder, entries: objectEntries };
  }

  return {
    flatIndex,
    objectIndex: { files: byFile },
  };
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
    const objectEntries: Record<string, Record<string, unknown>> = {};
    const flatIndex: Record<string, string> = {};
    walkFileEntriesCombined(fileData, matchOrder, objectEntries, flatIndex);

    byFile[fileName] = { matchOrder, entries: objectEntries };
  }

  return { files: byFile };
}
