export {
  TRANSLATION_LANGS,
  TRANSLATION_FILES,
  TRANSLATION_R2_PREFIX,
  TRANSLATION_SYNC_STATE_KEY,
  LANG_SYNC_CONCURRENCY,
  FILE_SYNC_CONCURRENCY,
  translationR2Key,
  translationIndexR2Key,
  translationObjectIndexR2Key,
  fileUrl,
  FILE_MATCH_ORDER,
  type TranslationFileName,
  type MatchCandidate,
  type FileObjectIndex,
  type TranslationObjectIndex,
  type TranslationFileData,
} from "./config";

export {
  flattenToIndex,
  buildTranslationIndex,
  buildTranslationIndexesCombined,
  buildTranslationObjectIndex,
} from "./indexing";

export {
  executeTranslationSync,
  ensureTranslationSyncInitialized,
  getTranslationSyncStatus,
  loadTranslationSyncState,
  type TranslationSyncState,
  type TranslationSyncResult,
} from "./sync";
