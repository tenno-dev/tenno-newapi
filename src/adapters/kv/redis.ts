import { RedisClient } from "bun";
import type { KVStore, KVListResult } from "../../app/types";

function parseScanResponse(raw: unknown): { nextCursor: number; keys: string[] } {
  if (Array.isArray(raw) && raw.length >= 2) {
    const nextCursor = Number.parseInt(String(raw[0] ?? "0"), 10);
    const keysRaw = Array.isArray(raw[1]) ? raw[1] : [];
    const keys = keysRaw.map((value) => String(value));
    return {
      nextCursor: Number.isNaN(nextCursor) ? 0 : nextCursor,
      keys,
    };
  }

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const cursorRaw = obj.cursor ?? obj.nextCursor ?? obj[0] ?? "0";
    const nextCursor = Number.parseInt(String(cursorRaw), 10);
    const keysRaw = obj.keys ?? obj.elements ?? obj.results ?? obj[1] ?? [];
    const keys = Array.isArray(keysRaw)
      ? keysRaw.map((value) => String(value))
      : [];
    return {
      nextCursor: Number.isNaN(nextCursor) ? 0 : nextCursor,
      keys,
    };
  }

  return { nextCursor: 0, keys: [] };
}

export class BunRedisKVStore implements KVStore {
  constructor(private readonly redis: RedisClient) {}

  get(key: string): Promise<string | null>;
  get(key: string, type: "json"): Promise<unknown>;
  async get(key: string, type?: "json"): Promise<string | null | unknown> {
    const value = await this.redis.get(key);
    if (value === null) return null;
    if (type === "json") {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    if (opts?.expirationTtl && opts.expirationTtl > 0) {
      await this.redis.set(key, value, "EX", String(opts.expirationTtl));
    } else {
      await this.redis.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async list(
    opts: { prefix?: string; cursor?: string; limit?: number } = {}
  ): Promise<KVListResult> {
    const pattern = opts.prefix ? `${opts.prefix}*` : "*";
    const count = opts.limit ?? 50;
    const startCursor = opts.cursor ? parseInt(opts.cursor, 10) : 0;

    const scanResult = await this.redis.send("SCAN", [
      String(startCursor),
      "MATCH",
      pattern,
      "COUNT",
      String(count),
    ]);

    const { nextCursor, keys } = parseScanResponse(scanResult);

    return {
      keys: keys.sort().map((name) => ({ name })),
      list_complete: nextCursor === 0,
      cursor: nextCursor !== 0 ? String(nextCursor) : undefined,
    };
  }
}

export function createBunRedisKVStore(redis: RedisClient): KVStore {
  return new BunRedisKVStore(redis);
}
