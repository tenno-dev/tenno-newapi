import Redis from "ioredis";
import type { QueueClient } from "../../app/types";

export const STREAM_NAME = "worldstate:translate";

export class RedisStreamsQueueClient implements QueueClient {
  constructor(private readonly redis: Redis) {}

  async send(message: unknown): Promise<void> {
    await this.redis.xadd(STREAM_NAME, "*", "body", JSON.stringify(message));
  }
}

export function createRedisQueueClient(redis: Redis): QueueClient {
  return new RedisStreamsQueueClient(redis);
}
