import {
  buildCurrentRootPayloadKey,
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
