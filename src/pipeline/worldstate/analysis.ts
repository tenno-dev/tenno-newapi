/**
 * Worldstate analysis and hash operations.
 * Handles computing and comparing hashes for worldstate roots.
 */

import { diffRootHashes, diffRootItems, hashRootValues, RootDiffItem, RootHashMap, stableStringify, hashString } from "../../tennodev/diff";
import { classifyPushCandidates } from "../classification";
import { loadCurrentRootPayload } from "../../cache/store";
import { TOP_LEVEL_WORLDSTATE_KEYS, RawWorldState } from "../../types/worldstate";

export async function loadCurrentRootHashes(kv: KVNamespace): Promise<RootHashMap> {
  const currentEntries = await Promise.all(
    TOP_LEVEL_WORLDSTATE_KEYS.map(async (rootKey: string) => ({
      rootKey,
      value: await loadCurrentRootPayload(kv, rootKey),
    }))
  );
  const hashes: RootHashMap = {};

  await Promise.all(
    currentEntries.map(async (entry: any) => {
      if (entry.value !== null) {
        hashes[entry.rootKey] = await hashString(stableStringify(entry.value));
      }
    })
  );

  return hashes;
}

export async function analyzeWorldStateDiffs(
  kv: KVNamespace,
  worldState: RawWorldState,
  force: boolean
): Promise<{
  nextHashes: RootHashMap;
  changed: RootDiffItem[];
  classification: { pushCandidateKeys: string[]; nonPushKeys: string[] };
}> {
  const nextHashes = await hashRootValues(worldState);
  const previousHashes = await loadCurrentRootHashes(kv);
  const diffs = diffRootHashes(previousHashes, nextHashes, force);
  const changed = diffs.filter((item: any) => item.changed);

  return {
    nextHashes,
    changed,
    classification: classifyPushCandidates(changed),
  };
}
