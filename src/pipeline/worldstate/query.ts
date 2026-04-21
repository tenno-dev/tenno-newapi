import type { Bindings } from "../../app/types";
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

export async function getWorldStateStatus(env: Bindings) {
  const [latestRun, rootHashes, totalRuns] = await Promise.all([
    loadLatestRunMeta(env.kv),
    loadCurrentRootHashes(env.kv),
    getPipelineRunCount(env.sql),
  ]);

  return buildWorldStateStatusModel({
    latestRun,
    rootHashCount: Object.keys(rootHashes).length,
    d1RunCount: totalRuns,
    source: buildSourceStatus(env.WORLDSTATE_SOURCE_URL, env.WORLDSTATE_SOURCE_TOKEN),
  });
}

export async function getLatestPushCandidates(env: Bindings) {
  const latestRun = await loadLatestRunMeta(env.kv);
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

export async function getWorldStateStats(env: Bindings, days: number) {
  const safeDays = Math.max(1, Math.min(days, 365));
  const rootKeyStats = await getItemChangeStats(env.sql, safeDays);

  return {
    ok: true,
    days: safeDays,
    rootKeyStats,
  };
}

export async function getWorldStateDailyStats(env: Bindings, days: number, rootKey?: string) {
  const safeDays = Math.max(1, Math.min(days, 365));
  const dailyRootKeyStats = await getItemChangeDailyStats(env.sql, safeDays, rootKey);

  return {
    ok: true,
    days: safeDays,
    rootKey: rootKey ?? null,
    dailyRootKeyStats,
  };
}
