import { RawWorldState } from "../types/worldstate";

export type RootHashMap = Record<string, string>;

export type RootDiffItem = {
  rootKey: string;
  previousHash: string | null;
  nextHash: string;
  changed: boolean;
};

export type RootItemChangeType = "new" | "removed" | "changed";

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
  _rootKey: string,
  previousValue: unknown,
  nextValue: unknown
): Promise<RootItemChange[]> {
  const previousItems = normalizeRootItems(previousValue);
  const nextItems = normalizeRootItems(nextValue);

  const previousMap = new Map<string, string>();
  const nextMap = new Map<string, string>();

  await Promise.all([
    Promise.all(previousItems.map(async (item) => {
      previousMap.set(item.itemId, await hashValue(item.value));
    })),
    Promise.all(nextItems.map(async (item) => {
      nextMap.set(item.itemId, await hashValue(item.value));
    })),
  ]);

  const itemIds = new Set([...previousMap.keys(), ...nextMap.keys()]);
  const changes: RootItemChange[] = [];

  for (const itemId of Array.from(itemIds).sort((a, b) => a.localeCompare(b))) {
    const prev = previousMap.get(itemId) ?? null;
    const next = nextMap.get(itemId) ?? null;

    if (prev === null && next !== null) {
      changes.push({ rootKey: _rootKey, itemId, changeType: "new", previousHash: null, nextHash: next });
    } else if (prev !== null && next === null) {
      changes.push({ rootKey: _rootKey, itemId, changeType: "removed", previousHash: prev, nextHash: null });
    } else if (prev !== null && next !== null && prev !== next) {
      changes.push({ rootKey: _rootKey, itemId, changeType: "changed", previousHash: prev, nextHash: next });
    }
  }

  return changes;
}

export async function hashRootValues(worldState: RawWorldState): Promise<RootHashMap> {
  const entries = Object.entries(worldState);
  const hashes: RootHashMap = {};

  await Promise.all(
    entries.map(async ([key, value]) => {
      hashes[key] = await hashString(stableStringify(value));
    })
  );

  return hashes;
}

export function diffRootHashes(
  previous: RootHashMap,
  next: RootHashMap,
  force: boolean
): RootDiffItem[] {
  const allKeys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const result: RootDiffItem[] = [];

  for (const rootKey of allKeys) {
    const previousHash = previous[rootKey] ?? null;
    const nextHash = next[rootKey];

    if (nextHash === undefined) continue;

    const changed = force || previousHash !== nextHash;
    result.push({ rootKey, previousHash, nextHash, changed });
  }

  return result;
}
