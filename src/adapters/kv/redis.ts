import Redis from "ioredis";
import type { KVStore, KVListResult } from "../../app/types";

class RedisKVStore implements KVStore {
  constructor(private readonly redis: Redis) {}

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
      await this.redis.set(key, value, "EX", opts.expirationTtl);
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

    const [nextCursor, keys] = await this.redis.scan(startCursor, "MATCH", pattern, "COUNT", count);

    return {
      keys: keys.sort().map((name) => ({ name })),
      list_complete: nextCursor === "0",
      cursor: nextCursor !== "0" ? nextCursor : undefined,
    };
  }
}

export function createRedisKVStore(redis: Redis): KVStore {
  return new RedisKVStore(redis);
}
