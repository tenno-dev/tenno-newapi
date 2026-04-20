import { KVStore } from "../../app/types";
import {
  diffRootHashes,
  hashRootValues,
  RootHashMap,
  stableStringify,
  hashString,
} from "../../tennodev/diff";
import { classifyPushCandidates } from "../classification";
import { loadCurrentRootPayload, loadRootHashes, saveRootHashes } from "../../cache/store";
import { TOP_LEVEL_WORLDSTATE_KEYS, RawWorldState } from "../../types/worldstate";

export async function loadCurrentRootHashes(kv: KVStore): Promise<RootHashMap> {
  const currentEntries = await Promise.all(
    TOP_LEVEL_WORLDSTATE_KEYS.map(async (rootKey: string) => ({
      rootKey,
      value: await loadCurrentRootPayload(kv, rootKey),
    }))
  );
  const hashes: RootHashMap = {};

  await Promise.all(
    currentEntries.map(async (entry) => {
      if (entry.value !== null) {
        hashes[entry.rootKey] = await hashString(stableStringify(entry.value));
      }
    })
  );

  return hashes;
}

export async function analyzeWorldStateDiffs(
  kv: KVStore,
  worldState: RawWorldState,
  force: boolean
): Promise<{
  nextHashes: RootHashMap;
  changed: Array<{ rootKey: string; previousHash: string | null; nextHash: string; changed: boolean }>;
  classification: { pushCandidateKeys: string[]; nonPushKeys: string[] };
}> {
  const nextHashes = await hashRootValues(worldState);

  let previousHashes = await loadRootHashes(kv);
  if (Object.keys(previousHashes).length === 0) {
    previousHashes = await loadCurrentRootHashes(kv);
  }

  const diffs = diffRootHashes(previousHashes, nextHashes, force);
  const changed = diffs.filter((item) => item.changed);

  await saveRootHashes(kv, nextHashes);

  return {
    nextHashes,
    changed,
    classification: classifyPushCandidates(changed),
  };
}
