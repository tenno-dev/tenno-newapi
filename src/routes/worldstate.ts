import { Hono } from "hono";
import { AppEnv } from "../app/types";
import { buildCurrentTranslatedRootKey, buildTranslatedRootKey } from "../cache/keys";
import {
  getWorldStateDailyStats,
  getWorldStateStats,
  getWorldStateStatus,
} from "../pipeline/worldstate";

export function registerWorldStateRoutes(app: Hono<AppEnv>): void {
  app.get("/worldstate/status", async (c) => {
    return c.json(await getWorldStateStatus(c));
  });

  app.get("/worldstate/translated/:rootKey", async (c) => {
    const rootKey = c.req.param("rootKey");
    const lang = (c.req.query("lang") ?? "en").trim().toLowerCase();
    const key = buildCurrentTranslatedRootKey(rootKey, lang);
    const payload = await c.env.TENNODEV_WORLDSTATE_KV.get(key, "json");

    if (payload === null) {
      return c.json({ ok: false, error: "translated payload not found", rootKey, lang, key }, 404);
    }

    return c.json({ ok: true, rootKey, lang, key, payload });
  });

  app.get("/worldstate/translated/:rootKey/runs/:runId", async (c) => {
    const rootKey = c.req.param("rootKey");
    const runId = c.req.param("runId");
    const lang = (c.req.query("lang") ?? "en").trim().toLowerCase();
    const key = buildTranslatedRootKey(rootKey, lang, runId);
    const payload = await c.env.TENNODEV_WORLDSTATE_KV.get(key, "json");

    if (payload === null) {
      return c.json(
        { ok: false, error: "translated run payload not found", rootKey, runId, lang, key },
        404
      );
    }

    return c.json({ ok: true, rootKey, runId, lang, key, payload });
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
}