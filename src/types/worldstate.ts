export const TOP_LEVEL_WORLDSTATE_KEYS = [
  "WorldSeed",
  "Version",
  "MobileVersion",
  "BuildLabel",
  "Time",
  "Events",
  "Goals",
  "Alerts",
  "Sorties",
  "LiteSorties",
  "SyndicateMissions",
  "ActiveMissions",
  "GlobalUpgrades",
  "FlashSales",
  "SkuSales",
  "InGameMarket",
  "Invasions",
  "HubEvents",
  "NodeOverrides",
  "VoidTraders",
  "PrimeVaultTraders",
  "VoidStorms",
  "PrimeAccessAvailability",
  "PrimeVaultAvailabilities",
  "PrimeTokenAvailability",
  "DailyDeals",
  "LibraryInfo",
  "PVPChallengeInstances",
  "PersistentEnemies",
  "PVPAlternativeModes",
  "PVPActiveTournaments",
  "ProjectPct",
  "ConstructionProjects",
  "TwitchPromos",
  "ExperimentRecommended",
  "EndlessXpChoices",
  "EndlessXpSchedule",
  "ForceLogoutVersion",
  "FeaturedGuilds",
  "SeasonInfo",
  "KnownCalendarSeasons",
  "Conquests",
  "Descents",
  "Tmp",
] as const;

export type TopLevelWorldStateKey = (typeof TOP_LEVEL_WORLDSTATE_KEYS)[number];

export type WorldStateBucketName =
  | "coreMeta"
  | "eventsAnnouncements"
  | "rotationsMissions"
  | "economyMarket"
  | "conflictWorld"
  | "primeSeason"
  | "pvpChallenges"
  | "miscSystem";

export type RawWorldState = Partial<Record<TopLevelWorldStateKey, unknown>> &
  Record<string, unknown>;

export type WorldStateBuckets = Record<WorldStateBucketName, TopLevelWorldStateKey[]>;

export type SplitWorldStateResult = {
  buckets: Record<WorldStateBucketName, Partial<Record<TopLevelWorldStateKey, unknown>>>;
  unknownKeys: string[];
};
