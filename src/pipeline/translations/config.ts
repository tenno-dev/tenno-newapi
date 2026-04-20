const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data";

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

export function translationR2Key(lang: string, file: string): string {
  return `${TRANSLATION_R2_PREFIX}/${lang}/${file}.json`;
}

export function translationIndexR2Key(lang: string): string {
  return `${TRANSLATION_R2_PREFIX}/${lang}/_index.json`;
}

export function translationObjectIndexR2Key(lang: string): string {
  return `${TRANSLATION_R2_PREFIX}/${lang}/_object-index.json`;
}

export function fileUrl(lang: string, file: string): string {
  return lang === "en"
    ? `${GITHUB_RAW_BASE}/${file}.json`
    : `${GITHUB_RAW_BASE}/${lang}/${file}.json`;
}

export type TranslationFileData = unknown;
