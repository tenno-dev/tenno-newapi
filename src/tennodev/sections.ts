import {
  TOP_LEVEL_WORLDSTATE_KEYS,
  RawWorldState,
  SplitWorldStateResult,
  TopLevelWorldStateKey,
  WorldStateBucketName,
  WorldStateBuckets,
} from "../types/worldstate";

export const WORLDSTATE_BUCKETS: WorldStateBuckets = {
  coreMeta: ["WorldSeed", "Version", "MobileVersion", "BuildLabel", "Time"],
  eventsAnnouncements: [
    "Events",
    "Alerts",
    "Goals",
    "HubEvents",
    "GlobalUpgrades",
    "TwitchPromos",
  ],
  rotationsMissions: [
    "Sorties",
    "LiteSorties",
    "SyndicateMissions",
    "ActiveMissions",
    "VoidStorms",
    "VoidTraders",
    "PrimeVaultTraders",
  ],
  economyMarket: ["FlashSales", "SkuSales", "InGameMarket", "DailyDeals"],
  conflictWorld: ["Invasions", "NodeOverrides", "ConstructionProjects", "ProjectPct"],
  primeSeason: [
    "PrimeAccessAvailability",
    "PrimeVaultAvailabilities",
    "PrimeTokenAvailability",
    "SeasonInfo",
    "KnownCalendarSeasons",
  ],
  pvpChallenges: [
    "PVPChallengeInstances",
    "PVPAlternativeModes",
    "PVPActiveTournaments",
    "Conquests",
    "Descents",
  ],
  miscSystem: [
    "LibraryInfo",
    "PersistentEnemies",
    "ExperimentRecommended",
    "EndlessXpChoices",
    "EndlessXpSchedule",
    "ForceLogoutVersion",
    "FeaturedGuilds",
    "Tmp",
  ],
};

function pickKeys(
  source: RawWorldState,
  keys: TopLevelWorldStateKey[]
): Partial<Record<TopLevelWorldStateKey, unknown>> {
  const selected: Partial<Record<TopLevelWorldStateKey, unknown>> = {};

  for (const key of keys) {
    if (key in source) {
      selected[key] = source[key];
    }
  }

  return selected;
}

export function splitWorldStateByBuckets(worldState: RawWorldState): SplitWorldStateResult {
  const bucketNames = Object.keys(WORLDSTATE_BUCKETS) as WorldStateBucketName[];
  const buckets = {} as SplitWorldStateResult["buckets"];

  for (const bucketName of bucketNames) {
    buckets[bucketName] = pickKeys(worldState, WORLDSTATE_BUCKETS[bucketName]);
  }

  const known = new Set<string>(TOP_LEVEL_WORLDSTATE_KEYS);
  const unknownKeys = Object.keys(worldState).filter((k) => !known.has(k));

  return { buckets, unknownKeys };
}
