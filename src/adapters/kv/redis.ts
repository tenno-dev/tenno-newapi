import { RedisClient } from "bun";
import type { KVStore, KVListResult } from "../../app/types";

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

    const [nextCursorStr, keys] = (await this.redis.send(
      "SCAN", [String(startCursor), "MATCH", pattern, "COUNT", String(count)]
    )) as [string, string[]];

    const nextCursor = parseInt(nextCursorStr, 10);

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
