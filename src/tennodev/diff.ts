import { RawWorldState } from "../types/worldstate";

export type RootHashMap = Record<string, string>;

export type RootDiffItem = {
  rootKey: string;
  previousHash: string | null;
  nextHash: string;
  changed: boolean;
};

export type RootItemChangeType = "new" | "changed" | "removed";

export type RootItemChange = {
  rootKey: string;
  itemId: string;
  changeType: RootItemChangeType;
  previousHash: string | null;
  nextHash: string | null;
};

type NormalizedRootItem = {
  itemId: string;
  value: unknown;
};

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export async function hashString(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  return Array.from(view)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashValue(value: unknown): Promise<string> {
  return hashString(stableStringify(value));
}

function extractObjectIdentity(value: Record<string, unknown>): string | null {
  const identityKeys = ["_id", "id", "Id", "Node", "node", "Tag", "tag", "name", "Name"];

  for (const key of identityKeys) {
    const candidate = value[key];
    if (typeof candidate === "string" || typeof candidate === "number") {
      return `${key}:${String(candidate)}`;
    }
  }

  return null;
}

function normalizeRootItems(rootValue: unknown): NormalizedRootItem[] {
  if (Array.isArray(rootValue)) {
    return rootValue.map((item, index) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const identity = extractObjectIdentity(item as Record<string, unknown>);
        if (identity) {
          return { itemId: identity, value: item };
        }
      }

      return {
        itemId: `index:${index}`,
        value: item,
      };
    });
  }

  if (rootValue && typeof rootValue === "object") {
    return Object.entries(rootValue as Record<string, unknown>)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => ({ itemId: key, value }));
  }

  return [{ itemId: "value", value: rootValue }];
}

export async function diffRootItems(
  rootKey: string,
  previousValue: unknown,
  nextValue: unknown
): Promise<RootItemChange[]> {
  const previousItems = normalizeRootItems(previousValue);
  const nextItems = normalizeRootItems(nextValue);

  const previousMap = new Map<string, string>();
  const nextMap = new Map<string, string>();

  for (const item of previousItems) {
    previousMap.set(item.itemId, await hashValue(item.value));
  }

  for (const item of nextItems) {
    nextMap.set(item.itemId, await hashValue(item.value));
  }

  const itemIds = new Set([...previousMap.keys(), ...nextMap.keys()]);
  const changes: RootItemChange[] = [];

  for (const itemId of Array.from(itemIds).sort((a, b) => a.localeCompare(b))) {
    const previousHash = previousMap.get(itemId) ?? null;
    const nextHash = nextMap.get(itemId) ?? null;

    if (previousHash === null && nextHash !== null) {
      changes.push({ rootKey, itemId, changeType: "new", previousHash, nextHash });
      continue;
    }

    if (previousHash !== null && nextHash === null) {
      changes.push({ rootKey, itemId, changeType: "removed", previousHash, nextHash });
      continue;
    }

    if (previousHash !== nextHash) {
      changes.push({ rootKey, itemId, changeType: "changed", previousHash, nextHash });
    }
  }

  return changes;
}

export async function hashRootValues(worldState: RawWorldState): Promise<RootHashMap> {
  const hashes: RootHashMap = {};
  const keys = Object.keys(worldState).sort((a, b) => a.localeCompare(b));

  for (const key of keys) {
    hashes[key] = await hashString(stableStringify(worldState[key]));
  }

  return hashes;
}

export function diffRootHashes(
  previousHashes: RootHashMap,
  nextHashes: RootHashMap,
  force = false
): RootDiffItem[] {
  const allKeys = new Set([...Object.keys(previousHashes), ...Object.keys(nextHashes)]);
  const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b));

  return sortedKeys.map((rootKey) => {
    const previousHash = previousHashes[rootKey] ?? null;
    const nextHash = nextHashes[rootKey] ?? "";
    const changed = force || previousHash !== nextHash;

    return {
      rootKey,
      previousHash,
      nextHash,
      changed,
    };
  });
}
