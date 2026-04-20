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

export function flattenToIndex(data: unknown, index: Record<string, string>): void {
  if (Array.isArray(data) || data === null || typeof data !== "object") {
    return;
  }

  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v === "string") {
      index[k] = v;
    } else if (Array.isArray(v) || v === null) {
      continue;
    } else if (typeof v === "object") {
      const entry = v as Record<string, unknown>;
      if (typeof entry.value === "string") {
        index[k] = entry.value;
      } else if (typeof entry.name === "string") {
        index[k] = entry.name;
      } else {
        flattenToIndex(v, index);
      }
    }
  }
}

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

    if (!(normalized in objectEntries)) {
      objectEntries[normalized] = entry;
    }
  }

  if (topKey && typeof entry.value === "string" && !(topKey in flatIndex)) {
    flatIndex[topKey] = entry.value;
  } else if (topKey && typeof entry.name === "string" && !(topKey in flatIndex)) {
    flatIndex[topKey] = entry.name;
  }
}

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
      indexEntryByCandidates({ value }, key, matchOrder, objectEntries, flatIndex);
      continue;
    }

    walkFileEntriesCombined(value, matchOrder, objectEntries, flatIndex, key);
  }
}

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

    walkFileEntriesCombined(fileData, matchOrder, objectEntries, flatIndex);

    byFile[fileName] = { matchOrder, entries: objectEntries };
  }

  return {
    flatIndex,
    objectIndex: { files: byFile },
  };
}

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
