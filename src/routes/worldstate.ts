import { Hono } from "hono";
import { AppEnv } from "../app/types";
import { buildCurrentTranslatedRootKey, buildTranslatedRootKey } from "../cache/keys";
import {
  getWorldStateDailyStats,
  getWorldStateStats,
  getWorldStateStatus,
} from "../pipeline/worldstate";
import { TOP_LEVEL_WORLDSTATE_KEYS } from "../types/worldstate";

/** Filter Events/HubEvents language-specific arrays and remove events with empty Messages. */
function filterEventMessagesToLang(data: unknown, lang: string): unknown {
  const isLangMatch = (item: unknown): boolean => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return true;
    }

    const obj = item as Record<string, unknown>;
    const itemLang = (obj.LanguageCode ?? obj.Language ?? "").toString().toLowerCase().trim();
    return itemLang === lang;
  };

  const filterEvent = (event: unknown): unknown => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return event;
    }

    const eventObj = event as Record<string, unknown>;
    const filtered = { ...eventObj };

    if (Array.isArray(eventObj.Messages)) {
      filtered.Messages = (eventObj.Messages as Array<unknown>).filter(isLangMatch);
    }

    if (Array.isArray(eventObj.Links)) {
      filtered.Links = (eventObj.Links as Array<unknown>).filter(isLangMatch);
    }

    return filtered;
  };

  const shouldKeepEvent = (event: unknown): boolean => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return true;
    }

    const eventObj = event as Record<string, unknown>;
    // Remove only when Messages exists and is empty after filtering.
    if (Array.isArray(eventObj.Messages)) {
      return eventObj.Messages.length > 0;
    }

    return true;
  };

  if (Array.isArray(data)) {
    return (data as Array<unknown>).map(filterEvent).filter(shouldKeepEvent);
  }

  if (!data || typeof data !== "object") {
    return data;
  }

  const obj = data as Record<string, unknown>;
  const result = { ...obj };

  for (const key of ["Events", "HubEvents"] as const) {
    if (Array.isArray(obj[key])) {
      result[key] = (obj[key] as Array<unknown>).map(filterEvent).filter(shouldKeepEvent);
    }
  }

  return result;
}

export function registerWorldStateRoutes(app: Hono<AppEnv>): void {
  app.get("/worldstate/full", async (c) => {
    // Default to English if no lang parameter provided
    const lang = (c.req.query("lang") ?? "en").trim().toLowerCase() || "en";

    // Fetch all available root keys in parallel for this language
    const payloads = await Promise.all(
      TOP_LEVEL_WORLDSTATE_KEYS.map(async (rootKey) => {
        const key = buildCurrentTranslatedRootKey(rootKey, lang);
        const payload = await c.env.TENNODEV_WORLDSTATE_KV.get(key, "json");
        return { rootKey, payload };
      })
    );

    const combined: Record<string, unknown> = {};
    const missing: string[] = [];

    for (const { rootKey, payload } of payloads) {
      if (payload !== null) {
        // Filter event messages to requested language
        combined[rootKey] = filterEventMessagesToLang(payload, lang);
      } else {
        missing.push(rootKey);
      }
    }

    return c.json(
      {
        ok: true,
        lang,
        timestamp: new Date().toISOString(),
        payloadCount: Object.keys(combined).length,
        missingKeys: missing,
        payload: combined,
      },
      {
        headers: {
          "cache-control": "public, max-age=60",
          "content-type": "application/json; charset=utf-8",
        },
      }
    );
  });

  app.get("/worldstate/status", async (c) => {
    return c.json(await getWorldStateStatus(c));
  });

  app.get("/worldstate/translated/:rootKey", async (c) => {
    const rootKey = c.req.param("rootKey");
    const lang = (c.req.query("lang") ?? "en").trim().toLowerCase() || "en";
    const key = buildCurrentTranslatedRootKey(rootKey, lang);
    const payload = await c.env.TENNODEV_WORLDSTATE_KV.get(key, "json");

    if (payload === null) {
      return c.json({ ok: false, error: "translated payload not found", rootKey, lang, key }, 404);
    }

    // Filter event messages to requested language
    const filtered = filterEventMessagesToLang(payload, lang);

    return c.json({ ok: true, rootKey, lang, key, payload: filtered });
  });

  app.get("/worldstate/translated/:rootKey/runs/:runId", async (c) => {
    const rootKey = c.req.param("rootKey");
    const runId = c.req.param("runId");
    const lang = (c.req.query("lang") ?? "en").trim().toLowerCase() || "en";
    const key = buildTranslatedRootKey(rootKey, lang, runId);
    const payload = await c.env.TENNODEV_WORLDSTATE_KV.get(key, "json");

    if (payload === null) {
      return c.json(
        { ok: false, error: "translated run payload not found", rootKey, runId, lang, key },
        404
      );
    }

    // Filter event messages to requested language
    const filtered = filterEventMessagesToLang(payload, lang);

    return c.json({ ok: true, rootKey, runId, lang, key, payload: filtered });
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