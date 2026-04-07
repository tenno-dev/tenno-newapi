import {
  buildCurrentRootCursorKey,
  buildCurrentRootPayloadKey,
  buildCurrentTranslatedRootCursorKey,
  buildCurrentTranslatedRootKey,
  buildLastKnownRootPayloadKey,
  buildLatestRunKey,
  buildRawSnapshotKey,
  buildRootHashIndexKey,
  buildRootPayloadKey,
  buildRunSummaryKey,
} from "./keys";
import { RootHashMap } from "../tennodev/diff";

const KV_TTL = {
  rawSnapshotSeconds: 60 * 60 * 24,
  rootPayloadSeconds: 60 * 60 * 24,
  currentRootPayloadSeconds: null,
  runSummarySeconds: 60 * 60 * 24 * 7,
  latestRunMetaSeconds: 60 * 60 * 24 * 30,
  rootHashIndexSeconds: 60 * 60 * 24 * 30,
} as const;

export type LatestRunMeta = {
  runId: string;
  fetchedAt: string;
  sourceVersion: string | null;
  changedRootKeys: string[];
};

type CurrentWriteCursor = {
  runId: string;
  fetchedAt: string;
};

function parseRunMs(runId: string): number {
  const [prefix] = runId.split("-");
  const value = Number.parseInt(prefix, 10);
  return Number.isNaN(value) ? 0 : value;
}

function compareCursorOrder(
  incoming: { runId: string; fetchedAt: string },
  existing: CurrentWriteCursor | null
): number {
  if (!existing) return 1;

  const incomingTime = Date.parse(incoming.fetchedAt);
  const existingTime = Date.parse(existing.fetchedAt);

  if (!Number.isNaN(incomingTime) && !Number.isNaN(existingTime) && incomingTime !== existingTime) {
    return incomingTime > existingTime ? 1 : -1;
  }

  const incomingRunMs = parseRunMs(incoming.runId);
  const existingRunMs = parseRunMs(existing.runId);
  if (incomingRunMs !== existingRunMs) {
    return incomingRunMs > existingRunMs ? 1 : -1;
  }

  if (incoming.runId === existing.runId) {
    return 0;
  }

  return incoming.runId > existing.runId ? 1 : -1;
}

async function loadCursor(kv: KVNamespace, cursorKey: string): Promise<CurrentWriteCursor | null> {
  const value = await kv.get(cursorKey, "json");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const obj = value as Record<string, unknown>;
  if (typeof obj.runId !== "string" || typeof obj.fetchedAt !== "string") {
    return null;
  }

  return { runId: obj.runId, fetchedAt: obj.fetchedAt };
}

async function saveCursor(
  kv: KVNamespace,
  cursorKey: string,
  cursor: CurrentWriteCursor
): Promise<void> {
  await kv.put(cursorKey, JSON.stringify(cursor));
}

export async function loadRootHashes(kv: KVNamespace): Promise<RootHashMap> {
  const raw = await kv.get(buildRootHashIndexKey(), "json");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as RootHashMap;
}

export async function saveRootHashes(
  kv: KVNamespace,
  hashes: RootHashMap,
  ttlSeconds = KV_TTL.rootHashIndexSeconds
): Promise<void> {
  await kv.put(buildRootHashIndexKey(), JSON.stringify(hashes), {
    expirationTtl: ttlSeconds,
  });
}

export async function saveRawSnapshot(
  kv: KVNamespace,
  runId: string,
  payload: string,
  ttlSeconds = KV_TTL.rawSnapshotSeconds
): Promise<string> {
  const key = buildRawSnapshotKey(runId);
  await kv.put(key, payload, { expirationTtl: ttlSeconds });
  return key;
}

export async function loadRawSnapshot(kv: KVNamespace, runId: string): Promise<string | null> {
  return kv.get(buildRawSnapshotKey(runId));
}

export async function loadRawSnapshotByKey(kv: KVNamespace, key: string): Promise<string | null> {
  return kv.get(key);
}

export async function saveRootPayload(
  kv: KVNamespace,
  rootKey: string,
  runId: string,
  payload: string,
  ttlSeconds = KV_TTL.rootPayloadSeconds
): Promise<string> {
  const key = buildRootPayloadKey(rootKey, runId);
  await kv.put(key, payload, { expirationTtl: ttlSeconds });
  return key;
}

export async function loadCurrentRootPayload(
  kv: KVNamespace,
  rootKey: string
): Promise<unknown | null> {
  return kv.get(buildCurrentRootPayloadKey(rootKey), "json");
}

export async function saveCurrentRootPayload(
  kv: KVNamespace,
  rootKey: string,
  payload: string
): Promise<string> {
  const key = buildCurrentRootPayloadKey(rootKey);
  const ttlSeconds = KV_TTL.currentRootPayloadSeconds;

  if (ttlSeconds === null) {
    await kv.put(key, payload);
  } else {
    await kv.put(key, payload, { expirationTtl: ttlSeconds });
  }

  return key;
}

export async function loadLastKnownRootPayload(
  kv: KVNamespace,
  rootKey: string
): Promise<unknown | null> {
  return kv.get(buildLastKnownRootPayloadKey(rootKey), "json");
}

export async function saveLastKnownRootPayload(
  kv: KVNamespace,
  rootKey: string,
  payload: string
): Promise<string> {
  const key = buildLastKnownRootPayloadKey(rootKey);
  await kv.put(key, payload);
  return key;
}

export async function deleteCurrentRootPayload(kv: KVNamespace, rootKey: string): Promise<void> {
  await kv.delete(buildCurrentRootPayloadKey(rootKey));
}

export async function saveCurrentRootPayloadIfNewer(
  kv: KVNamespace,
  rootKey: string,
  payload: string,
  runId: string,
  fetchedAt: string
): Promise<{ key: string; updated: boolean }> {
  const key = buildCurrentRootPayloadKey(rootKey);
  const cursorKey = buildCurrentRootCursorKey(rootKey);
  const incoming = { runId, fetchedAt };
  const existing = await loadCursor(kv, cursorKey);

  if (compareCursorOrder(incoming, existing) < 0) {
    return { key, updated: false };
  }

  await kv.put(key, payload);
  await saveCursor(kv, cursorKey, incoming);
  return { key, updated: true };
}

export async function deleteCurrentRootPayloadIfNewer(
  kv: KVNamespace,
  rootKey: string,
  runId: string,
  fetchedAt: string
): Promise<boolean> {
  const key = buildCurrentRootPayloadKey(rootKey);
  const cursorKey = buildCurrentRootCursorKey(rootKey);
  const incoming = { runId, fetchedAt };
  const existing = await loadCursor(kv, cursorKey);

  if (compareCursorOrder(incoming, existing) < 0) {
    return false;
  }

  await kv.delete(key);
  await saveCursor(kv, cursorKey, incoming);
  return true;
}

export async function saveCurrentTranslatedRootPayloadIfNewer(
  kv: KVNamespace,
  rootKey: string,
  lang: string,
  payload: string,
  runId: string,
  fetchedAt: string
): Promise<{ key: string; updated: boolean }> {
  const key = buildCurrentTranslatedRootKey(rootKey, lang);
  const cursorKey = buildCurrentTranslatedRootCursorKey(rootKey, lang);
  const incoming = { runId, fetchedAt };
  const existing = await loadCursor(kv, cursorKey);

  if (compareCursorOrder(incoming, existing) < 0) {
    return { key, updated: false };
  }

  await kv.put(key, payload);
  await saveCursor(kv, cursorKey, incoming);
  return { key, updated: true };
}

export async function saveRunSummary(
  kv: KVNamespace,
  runId: string,
  summary: Record<string, unknown>,
  ttlSeconds = KV_TTL.runSummarySeconds
): Promise<string> {
  const key = buildRunSummaryKey(runId);
  await kv.put(key, JSON.stringify(summary), { expirationTtl: ttlSeconds });
  return key;
}

export async function saveLatestRunMeta(
  kv: KVNamespace,
  meta: LatestRunMeta,
  ttlSeconds = KV_TTL.latestRunMetaSeconds
): Promise<void> {
  await kv.put(buildLatestRunKey(), JSON.stringify(meta), {
    expirationTtl: ttlSeconds,
  });
}

export async function loadLatestRunMeta(kv: KVNamespace): Promise<LatestRunMeta | null> {
  const raw = await kv.get(buildLatestRunKey(), "json");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as LatestRunMeta;
}
