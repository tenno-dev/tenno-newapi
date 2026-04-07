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
