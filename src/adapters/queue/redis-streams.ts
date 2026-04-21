import { Redis } from "bun";
import type { QueueClient } from "../../app/types";

export const STREAM_NAME = "worldstate:translate";

export class BunRedisQueueClient implements QueueClient {
  constructor(private readonly redis: Redis) {}

  async send(message: unknown): Promise<void> {
    await this.redis.call("XADD", STREAM_NAME, "*", "body", JSON.stringify(message));
  }
}

export function createBunRedisQueueClient(redis: Redis): QueueClient {
  return new BunRedisQueueClient(redis);
}
