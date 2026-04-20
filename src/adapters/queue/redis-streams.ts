import Redis from "ioredis";
import type { QueueClient } from "../../app/types";

export const STREAM_NAME = "worldstate:translate";

export function createRedisQueueClient(redis: Redis): QueueClient {
  return {
    async send(message: unknown): Promise<void> {
      await redis.xadd(STREAM_NAME, "*", "body", JSON.stringify(message));
    },
  };
}
