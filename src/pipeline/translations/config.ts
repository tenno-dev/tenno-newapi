/**
 * Translation configuration and constants.
 * Defines which files and languages are supported, and how to construct storage keys.
 */

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data";

/**
 * Files present in each language directory (and at root for English).
 * Mirrors the structure of WFCD/warframe-worldstate-data /data/{lang}/{file}.json
 */
export const TRANSLATION_FILES = [
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

export type MatchCandidate = "topKey" | "name" | "regex" | "imageKey";

export type FileObjectIndex = {
  matchOrder: MatchCandidate[];
  entries: Record<string, Record<string, unknown>>;
};

export type TranslationObjectIndex = {
  files: Partial<Record<TranslationFileName, FileObjectIndex>>;
};

export const FILE_MATCH_ORDER: Record<TranslationFileName, MatchCandidate[]> = {
  arcanes: ["name", "regex"],
  archonShards: ["topKey", "name", "regex"],
  conclaveData: ["topKey", "name", "regex"],
  eventsData: ["topKey", "name", "regex"],
  factionsData: ["topKey", "name", "regex"],
  fissureModifiers: ["topKey", "name", "regex"],
  languages: ["name", "regex", "topKey"],
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
export const TRANSLATION_LANGS = [
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
export const TRANSLATION_SYNC_STATE_KEY = "wf:translations:sync:state";
export const LANG_SYNC_CONCURRENCY = 3;
export const FILE_SYNC_CONCURRENCY = 6;

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
export function fileUrl(lang: string, file: string): string {
  return lang === "en"
    ? `${GITHUB_RAW_BASE}/${file}.json`
    : `${GITHUB_RAW_BASE}/${lang}/${file}.json`;
}

export type TranslationFileData = unknown;
