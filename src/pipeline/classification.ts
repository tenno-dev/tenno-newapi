import { RootDiffItem } from "../tennodev/diff";

const HIGH_SIGNAL_ROOT_KEYS = new Set([
  "Alerts",
  "Events",
  "Invasions",
  "Sorties",
  "SyndicateMissions",
  "VoidTraders",
  "FlashSales",
  "DailyDeals",
  "WorldSeed",
]);

export type PushClassification = {
  pushCandidateKeys: string[];
  nonPushKeys: string[];
};

export function classifyPushCandidateKeys(rootKeys: string[]): PushClassification {
  const pushCandidateKeys: string[] = [];
  const nonPushKeys: string[] = [];

  for (const rootKey of rootKeys) {
    if (HIGH_SIGNAL_ROOT_KEYS.has(rootKey)) {
      pushCandidateKeys.push(rootKey);
    } else {
      nonPushKeys.push(rootKey);
    }
  }

  return { pushCandidateKeys, nonPushKeys };
}

export function classifyPushCandidates(changed: RootDiffItem[]): PushClassification {
  return classifyPushCandidateKeys(changed.map((item) => item.rootKey));
}
