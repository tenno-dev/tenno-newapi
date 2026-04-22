import { Elysia, t } from "elysia";
import { bearer } from "@elysiajs/bearer";
import * as os from "os";
import type { Bindings } from "../app/types";
import { executeTranslationSync } from "../pipeline/translations";
import { executeWorldStatePush } from "../pipeline/worldstate";
// Removed redundant parseBoolean in favor of TypeBox
import { processTranslationMessage } from "../queue/translator";
import { buildCurrentRootPayloadKey } from "../cache/keys";
import { TRANSLATION_LANGS } from "../pipeline/translations/config";
import { isAuthorizedPushAdmin } from "./push";

const WARFRAME_WORLDSTATE_URL = "https://api.warframe.com/cdn/worldState.php";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;

  return days > 0 ? `${days} ${time}` : time;
}

export function corePlugin(env: Bindings) {
  return new Elysia()
    .use(bearer())
    .get("/", () => Bun.file("./web/static/routes-info.html"))

    .get("/health", ({ set }) => {
      const mem = process.memoryUsage();
      const load = os.loadavg();
      const cpuCount = os.cpus().length;
      const uptime = process.uptime();
      set.headers["cache-control"] = "no-store, must-revalidate";
      return {
        status: "healthy",
        uptime: { seconds: Math.round(uptime), formatted: formatUptime(Math.round(uptime)) },
        memory: {
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          rss: Math.round(mem.rss / 1024 / 1024),
          external: Math.round(mem.external / 1024 / 1024),
        },
        cpu: {
          cores: cpuCount,
          loadAverage: { "1m": load[0].toFixed(2), "5m": load[1].toFixed(2), "15m": load[2].toFixed(2) },
        },
        timestamp: new Date().toISOString(),
      };
    })

    .get("/debug-public/warframe/fetch", async () => {
      const response = await fetch(WARFRAME_WORLDSTATE_URL, {
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "accept-encoding": "gzip, deflate, br, zstd",
          "accept-language": "en-US,en;q=0.9",
          referer: "https://www.warframe.com/",
          origin: "https://www.warframe.com",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "upgrade-insecure-requests": "1",
          "sec-ch-ua": '"Chromium";v="147", "Not=A?Brand";v="8"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "sec-fetch-user": "?1",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        },
        redirect: "follow",
      });

      const headers: Record<string, string> = {};
      for (const [key, value] of response.headers.entries()) {
        headers[key] = value;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const rawBody = await response.text();
      let parsedBody: unknown = null;
      let parseError: string | null = null;
      if (contentType.includes("application/json") || rawBody.trim().startsWith("{")) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch (error) {
          parseError = error instanceof Error ? error.message : "failed to parse JSON";
        }
      }
      return { ok: response.ok, sourceUrl: WARFRAME_WORLDSTATE_URL, status: response.status, statusText: response.statusText, headers, contentType, parseError, result: parsedBody, rawBody };
    })

    .post("/internal/translations/sync", async ({ bearer, status }) => {
      const configuredToken = (env.DEPLOY_TRIGGER_TOKEN ?? "").trim();
      if (!isAuthorizedPushAdmin(env, bearer)) {
        return status(401, { ok: false, error: "unauthorized" });
      }
      const result = await executeTranslationSync(env);
      return { ok: true, trigger: "post-deploy", result };
    })

    .post("/internal/worldstate/push", async ({ query, bearer, status }) => {
      if (!isAuthorizedPushAdmin(env, bearer)) {
        return status(401, { ok: false, error: "unauthorized" });
      }
      const result = await executeWorldStatePush(env, { dryRun: query.dryRun, force: query.force });
      return { ok: true, trigger: "internal", dryRun: query.dryRun, force: query.force, result };
    }, {
      query: t.Object({
        dryRun: t.Boolean({ default: false }),
        force: t.Boolean({ default: false })
      })
    })

    .post("/internal/translations/rebuild-root", async ({ query, bearer, status }) => {
      if (!isAuthorizedPushAdmin(env, bearer)) {
        return status(401, { ok: false, error: "unauthorized" });
      }

      const rootKey = query.rootKey;
      const langsRaw = query.langs?.trim();
      const requestedLangs = langsRaw
        ? langsRaw.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean)
        : [...TRANSLATION_LANGS];
      const supportedSet = new Set<string>(TRANSLATION_LANGS);
      const targetLanguages = Array.from(new Set(requestedLangs)).filter((lang) => supportedSet.has(lang));
      if (targetLanguages.length === 0) {
        return status(400, { ok: false, error: "no valid languages requested", supported: TRANSLATION_LANGS });
      }

      const payloadKey = buildCurrentRootPayloadKey(rootKey);
      const hasPayload = await env.kv.get(payloadKey);
      if (!hasPayload) {
        return status(404, { ok: false, error: `current root payload not found for rootKey '${rootKey}'` });
      }

      const runId = `${Date.now()}-manual-rebuild-${rootKey}`;
      const fetchedAt = new Date().toISOString();
      await processTranslationMessage(env, {
        type: "worldstate.translate-root",
        runId, fetchedAt, sourceVersion: null, sourceLocale: "en",
        targetLanguages, rootKey, payloadKey,
      });

      return { ok: true, trigger: "internal", rootKey, runId, fetchedAt, targetLanguages, payloadKey };
    }, {
      query: t.Object({
        rootKey: t.String({ minLength: 1 }),
        langs: t.Optional(t.String())
      })
    });
}
