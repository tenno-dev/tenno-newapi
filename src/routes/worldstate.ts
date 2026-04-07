import { Hono } from "hono";
import { parseBoolean } from "../app/http";
import { AppEnv } from "../app/types";
import {
  executeWorldStatePush,
  getWorldStateCachePlan,
  getWorldStateDailyStats,
  getLatestPushCandidates,
  getWorldStateSplit,
  getWorldStateStats,
  getWorldStateStatus,
  WORLDSTATE_BUCKETS,
} from "../pipeline/worldstate";

export function registerWorldStateRoutes(app: Hono<AppEnv>): void {
  app.get("/worldstate/buckets", (c) => {
    return c.json({
      buckets: WORLDSTATE_BUCKETS,
    });
  });

  app.get("/worldstate/split", async (c) => {
    return c.json(await getWorldStateSplit());
  });

  app.get("/worldstate/cache-plan", async (c) => {
    const locale = c.req.query("lang") ?? "en";
    return c.json(await getWorldStateCachePlan(locale));
  });

  app.post("/worldstate/push", async (c) => {
    const dryRun = parseBoolean(c.req.query("dryRun"));
    const force = parseBoolean(c.req.query("force"));
    return c.json(await executeWorldStatePush(c, { dryRun, force }));
  });

  app.get("/worldstate/status", async (c) => {
    return c.json(await getWorldStateStatus(c));
  });

  app.get("/worldstate/stats", async (c) => {
    const days = Number.parseInt(c.req.query("days") ?? "30", 10);
    return c.json(await getWorldStateStats(c, Number.isNaN(days) ? 30 : days));
  });

  app.get("/worldstate/stats/daily", async (c) => {
    const days = Number.parseInt(c.req.query("days") ?? "30", 10);
    const rootKey = c.req.query("rootKey") ?? undefined;
    return c.json(
      await getWorldStateDailyStats(c, Number.isNaN(days) ? 30 : days, rootKey)
    );
  });

  app.get("/worldstate/push-candidates", async (c) => {
    return c.json(await getLatestPushCandidates(c));
  });
}