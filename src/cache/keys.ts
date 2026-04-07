import { WorldStateBucketName } from "../types/worldstate";

const CACHE_NAMESPACE = "wf:worldstate";

function normalizeLocale(locale: string): string {
  return locale.trim().toLowerCase() || "en";
}

export function buildBucketCacheKey(
  bucket: WorldStateBucketName,
  options?: { locale?: string; version?: string }
): string {
  const locale = normalizeLocale(options?.locale ?? "en");
  const parts = [CACHE_NAMESPACE, "bucket", bucket, "lang", locale];

  if (options?.version) {
    parts.push("v", options.version);
  }

  return parts.join(":");
}

export function buildMetaCacheKey(): string {
  return `${CACHE_NAMESPACE}:meta`;
}

export function buildRootHashIndexKey(): string {
  return `${CACHE_NAMESPACE}:index:root-hashes`;
}

export function buildRawSnapshotKey(runId: string): string {
  return `${CACHE_NAMESPACE}:raw:run:${runId}`;
}

export function buildLatestRunKey(): string {
  return `${CACHE_NAMESPACE}:meta:latest-run`;
}

export function buildRunSummaryKey(runId: string): string {
  return `${CACHE_NAMESPACE}:run:${runId}:summary`;
}

export function buildRootPayloadKey(rootKey: string, runId: string): string {
  return `${CACHE_NAMESPACE}:root:${rootKey}:run:${runId}`;
}

export function buildCurrentRootPayloadKey(rootKey: string): string {
  return `${CACHE_NAMESPACE}:root:${rootKey}:current`;
}

export function buildCurrentRootCursorKey(rootKey: string): string {
  return `${CACHE_NAMESPACE}:root:${rootKey}:current:cursor`;
}

export function buildLastKnownRootPayloadKey(rootKey: string): string {
  return `${CACHE_NAMESPACE}:root:${rootKey}:last-known`;
}

export function buildDummyTranslationKey(runId: string, rootKey: string): string {
  return `${CACHE_NAMESPACE}:translate:dummy:run:${runId}:root:${rootKey}`;
}

export function buildTranslatedRootKey(rootKey: string, lang: string, runId: string): string {
  return `${CACHE_NAMESPACE}:root:${rootKey}:translated:${lang}:run:${runId}`;
}

export function buildCurrentTranslatedRootKey(rootKey: string, lang: string): string {
  return `${CACHE_NAMESPACE}:root:${rootKey}:translated:${lang}:current`;
}

export function buildCurrentTranslatedRootCursorKey(rootKey: string, lang: string): string {
  return `${CACHE_NAMESPACE}:root:${rootKey}:translated:${lang}:current:cursor`;
}
