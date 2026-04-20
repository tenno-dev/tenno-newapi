import { AppContext } from "../../app/types";
import { loadLatestRunMeta } from "../../cache/store";
import { classifyPushCandidateKeys } from "../classification";
import { getItemChangeDailyStats, getItemChangeStats, getPipelineRunCount } from "../persistence";
import { buildWorldStateStatusModel } from "../read-models";
import { loadCurrentRootHashes } from "./analysis";

function buildSourceStatus(configuredSource: string | undefined, configuredToken: string | undefined) {
  const trimmedSource = configuredSource?.trim();
  const trimmedToken = configuredToken?.trim();

  if (!trimmedSource) {
    return {
      mode: "official" as const,
      url: "https://api.warframe.com/cdn/worldState.php",
      tokenConfigured: false,
    };
  }

  try {
    const url = new URL(trimmedSource);
    const tokenInUrl = url.searchParams.get("url")?.trim();
    const tokenConfigured = !!trimmedToken || !!tokenInUrl;

    if (tokenConfigured) {
      url.searchParams.set("url", "[redacted]");
    }

    return {
      mode: "proxy" as const,
      url: url.toString(),
      tokenConfigured,
    };
  } catch {
    return {
      mode: "proxy" as const,
      url: trimmedToken ? `${trimmedSource}[redacted]` : trimmedSource,
      tokenConfigured: !!trimmedToken,
    };
  }
}

export async function getWorldStateStatus(c: AppContext) {
  const [latestRun, rootHashes, totalRuns] = await Promise.all([
    loadLatestRunMeta(c.env.kv),
    loadCurrentRootHashes(c.env.kv),
    getPipelineRunCount(c.env.sql),
  ]);

  return buildWorldStateStatusModel({
    latestRun,
    rootHashCount: Object.keys(rootHashes).length,
    d1RunCount: totalRuns,
    source: buildSourceStatus(c.env.WORLDSTATE_SOURCE_URL, c.env.WORLDSTATE_SOURCE_TOKEN),
  });
}

export async function getLatestPushCandidates(c: AppContext) {
  const latestRun = await loadLatestRunMeta(c.env.kv);
  const changedRootKeys = latestRun?.changedRootKeys ?? [];
  const classification = classifyPushCandidateKeys(changedRootKeys);

  return {
    ok: true,
    latestRun,
    changedRootKeys,
    pushCandidateKeys: classification.pushCandidateKeys,
    nonPushKeys: classification.nonPushKeys,
  };
}

export async function getWorldStateStats(c: AppContext, days: number) {
  const safeDays = Math.max(1, Math.min(days, 365));
  const rootKeyStats = await getItemChangeStats(c.env.sql, safeDays);

  return {
    ok: true,
    days: safeDays,
    rootKeyStats,
  };
}

export async function getWorldStateDailyStats(c: AppContext, days: number, rootKey?: string) {
  const safeDays = Math.max(1, Math.min(days, 365));
  const dailyRootKeyStats = await getItemChangeDailyStats(c.env.sql, safeDays, rootKey);

  return {
    ok: true,
    days: safeDays,
    rootKey: rootKey ?? null,
    dailyRootKeyStats,
  };
}
