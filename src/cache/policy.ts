import { WorldStateBucketName } from "../types/worldstate";

export const BUCKET_TTL_SECONDS: Record<WorldStateBucketName, number> = {
  coreMeta: 1800,
  eventsAnnouncements: 180,
  rotationsMissions: 600,
  economyMarket: 180,
  conflictWorld: 120,
  primeSeason: 3600,
  pvpChallenges: 900,
  miscSystem: 1800,
};

export function getBucketTtlSeconds(bucket: WorldStateBucketName): number {
  return BUCKET_TTL_SECONDS[bucket];
}

export function getExpiryIso(ttlSeconds: number, now = new Date()): string {
  const expiryMs = now.getTime() + ttlSeconds * 1000;
  return new Date(expiryMs).toISOString();
}
