/**
 * Translation system exports.
 * Re-exports all translation-related functionality for convenience.
 */

// Configuration
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
  type TranslationFileName,
  type MatchCandidate,
  type FileObjectIndex,
  type TranslationObjectIndex,
  type TranslationFileData,
  FILE_MATCH_ORDER,
} from "./config";

export { TRANSLATION_LANGS as TRANSLATION_LANGS_EXPORTED } from "./config";

// Indexing
export {
  flattenToIndex,
  buildTranslationIndex,
  buildTranslationIndexesCombined,
  buildTranslationObjectIndex,
} from "./indexing";

// Sync
export {
  executeTranslationSync,
  ensureTranslationSyncInitialized,
  getTranslationSyncStatus,
  loadTranslationSyncState,
  type TranslationSyncState,
  type TranslationSyncResult,
} from "./sync";
