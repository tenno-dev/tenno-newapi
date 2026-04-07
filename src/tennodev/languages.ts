export const TRANSLATE_TARGET_LANGUAGES = [
  "de",
  "es",
  "fr",
  "it",
  "ko",
  "pl",
  "pt",
  "ru",
  "zh",
  "en",
  "uk",
] as const;

export type TranslateTargetLanguage = (typeof TRANSLATE_TARGET_LANGUAGES)[number];
