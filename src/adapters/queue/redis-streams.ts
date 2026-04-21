import { RedisClient } from "bun";
import type { QueueClient } from "../../app/types";

export const STREAM_NAME = "worldstate:translate";

export class BunRedisQueueClient implements QueueClient {
  constructor(private readonly redis: RedisClient) {}

  async send(message: unknown): Promise<void> {
    await this.redis.send("XADD", [STREAM_NAME, "*", "body", JSON.stringify(message)]);
  }
}

export function createBunRedisQueueClient(redis: RedisClient): QueueClient {
  return new BunRedisQueueClient(redis);
}
