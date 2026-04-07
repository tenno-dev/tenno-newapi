import { buildBucketCacheKey, buildMetaCacheKey } from "../cache/keys";
import { getBucketTtlSeconds, getExpiryIso } from "../cache/policy";
import { TRANSLATE_TARGET_LANGUAGES } from "../tennodev/languages";
import { fetchWorldState } from "../tennodev/client";
import { splitWorldStateByBuckets } from "../tennodev/sections";
import { WorldStateBucketName } from "../types/worldstate";
import { MAX_RETAINED_RUNS } from "./retention";

export async function buildWorldStateSplitModel() {
  const worldState = await fetchWorldState();
  const split = splitWorldStateByBuckets(worldState);

  return {
    fetchedAt: new Date().toISOString(),
    unknownKeys: split.unknownKeys,
    buckets: split.buckets,
  };
}

export async function buildWorldStateCachePlanModel(locale = "en") {
  const worldState = await fetchWorldState();
  const split = splitWorldStateByBuckets(worldState);
  const versionValue = worldState.Version;
  const version =
    typeof versionValue === "number" || typeof versionValue === "string"
      ? String(versionValue)
      : undefined;

  const bucketNames = Object.keys(split.buckets) as WorldStateBucketName[];
  const plan = bucketNames.map((bucket) => {
    const ttlSeconds = getBucketTtlSeconds(bucket);

    return {
      bucket,
      key: buildBucketCacheKey(bucket, { locale, version }),
      ttlSeconds,
      expiresAt: getExpiryIso(ttlSeconds),
      hasData: Object.keys(split.buckets[bucket]).length > 0,
    };
  });

  return {
    fetchedAt: new Date().toISOString(),
    locale,
    metaKey: buildMetaCacheKey(),
    plan,
  };
}

export function buildWorldStateStatusModel(input: {
  latestRun: unknown;
  rootHashCount: number;
  d1RunCount: number;
  source: {
    mode: "official" | "proxy";
    url: string;
    tokenConfigured: boolean;
  };
}) {
  return {
    ok: true,
    latestRun: input.latestRun,
    rootHashCount: input.rootHashCount,
    d1RunCount: input.d1RunCount,
    source: input.source,
    retainedRunLimit: MAX_RETAINED_RUNS,
    queueLanguages: TRANSLATE_TARGET_LANGUAGES,
  };
}
