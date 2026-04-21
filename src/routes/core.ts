import { Elysia } from "elysia";
import * as os from "os";
import { ACTIVE_ROUTES } from "../app/routes";
import type { Bindings } from "../app/types";
import { executeTranslationSync } from "../pipeline/translations";
import { executeWorldStatePush } from "../pipeline/worldstate";
import { parseBoolean } from "../app/http";
import { processTranslationMessage } from "../queue/translator";
import { buildCurrentRootPayloadKey } from "../cache/keys";
import { TRANSLATION_LANGS } from "../pipeline/translations/config";

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

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function getOperationParameters(rawPath: string): Array<Record<string, unknown>> {
  const parameters: Array<Record<string, unknown>> = [];

  const pathParamMatches = rawPath.matchAll(/:([A-Za-z0-9_]+)/g);
  for (const match of pathParamMatches) {
    const name = match[1];
    parameters.push({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }

  if (
    rawPath === "/worldstate/full" ||
    rawPath === "/worldstate/translated/:rootKey" ||
    rawPath === "/worldstate/translated/:rootKey/runs/:runId"
  ) {
    parameters.push({
      name: "lang",
      in: "query",
      required: false,
      description: "Language code (default: en)",
      schema: { type: "string", example: "en" },
    });
  }

  if (rawPath === "/worldstate/stats" || rawPath === "/worldstate/stats/daily") {
    parameters.push({
      name: "days",
      in: "query",
      required: false,
      description: "Number of days to include (default: 30)",
      schema: { type: "integer", minimum: 1, example: 30 },
    });
  }

  if (rawPath === "/worldstate/stats/daily") {
    parameters.push({
      name: "rootKey",
      in: "query",
      required: false,
      description: "Optional worldstate root key filter",
      schema: { type: "string", example: "Events" },
    });
  }

  return parameters;
}

function buildOpenApiSpec(origin: string) {
  const publicRoutes = ACTIVE_ROUTES.filter(
    (entry) =>
      !entry.includes(" /debug") &&
      !entry.includes(" /debug-public") &&
      !entry.includes(" /internal/")
  );

  const paths: Record<string, Record<string, unknown>> = {};
  for (const entry of publicRoutes) {
    const [method, ...pathParts] = entry.split(" ");
    const rawPath = pathParts.join(" ").trim();
    if (!method || !rawPath) continue;

    const openApiPath = toOpenApiPath(rawPath);
    const methodLower = method.toLowerCase();

    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }

    paths[openApiPath][methodLower] = {
      summary: `${method} ${rawPath}`,
      parameters: getOperationParameters(rawPath),
      responses: {
        "200": { description: "OK" },
      },
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Tenno New API",
      version: "1.0.0",
      description: "Swagger docs for non-debug routes",
    },
    servers: [{ url: origin }],
    paths,
  };
}

const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Tenno New API</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script>window.onload = () => SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui" });</script>
</body>
</html>`;

export function corePlugin(env: Bindings) {
  return new Elysia()
    .get("/openapi.json", ({ request, set }) => {
      const url = new URL(request.url);
      const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
      const host = request.headers.get("host") || url.host;
      const origin = `${protocol}://${host}`;
      set.headers["cache-control"] = "public, max-age=3600, s-maxage=86400";
      return buildOpenApiSpec(origin);
    })

    .get("/docs", ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return SWAGGER_UI_HTML;
    })

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

    .post("/internal/translations/sync", async ({ request, set }) => {
      const configuredToken = env.DEPLOY_TRIGGER_TOKEN?.trim();
      const authHeader = request.headers.get("authorization") ?? "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
      if (!configuredToken) { set.status = 503; return { ok: false, error: "deploy trigger token is not configured" }; }
      if (!bearerToken || bearerToken !== configuredToken) { set.status = 401; return { ok: false, error: "unauthorized" }; }
      const result = await executeTranslationSync(env);
      return { ok: true, trigger: "post-deploy", result };
    })

    .post("/internal/worldstate/push", async ({ request, query, set }) => {
      const configuredToken = env.DEPLOY_TRIGGER_TOKEN?.trim();
      const authHeader = request.headers.get("authorization") ?? "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
      if (!configuredToken) { set.status = 503; return { ok: false, error: "deploy trigger token is not configured" }; }
      if (!bearerToken || bearerToken !== configuredToken) { set.status = 401; return { ok: false, error: "unauthorized" }; }
      const force = parseBoolean(query.force);
      const dryRun = parseBoolean(query.dryRun);
      const result = await executeWorldStatePush(env, { dryRun, force });
      return { ok: true, trigger: "internal", dryRun, force, result };
    })

    .post("/internal/translations/rebuild-root", async ({ request, query, set }) => {
      const configuredToken = env.DEPLOY_TRIGGER_TOKEN?.trim();
      const authHeader = request.headers.get("authorization") ?? "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
      if (!configuredToken) { set.status = 503; return { ok: false, error: "deploy trigger token is not configured" }; }
      if (!bearerToken || bearerToken !== configuredToken) { set.status = 401; return { ok: false, error: "unauthorized" }; }

      const rootKey = (query.rootKey ?? "").trim();
      if (!rootKey) { set.status = 400; return { ok: false, error: "rootKey is required" }; }

      const langsRaw = query.langs?.trim();
      const requestedLangs = langsRaw
        ? langsRaw.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean)
        : [...TRANSLATION_LANGS];
      const supportedSet = new Set<string>(TRANSLATION_LANGS);
      const targetLanguages = Array.from(new Set(requestedLangs)).filter((lang) => supportedSet.has(lang));
      if (targetLanguages.length === 0) {
        set.status = 400;
        return { ok: false, error: "no valid languages requested", supported: TRANSLATION_LANGS };
      }

      const payloadKey = buildCurrentRootPayloadKey(rootKey);
      const hasPayload = await env.kv.get(payloadKey);
      if (!hasPayload) {
        set.status = 404;
        return { ok: false, error: `current root payload not found for rootKey '${rootKey}'` };
      }

      const runId = `${Date.now()}-manual-rebuild-${rootKey}`;
      const fetchedAt = new Date().toISOString();
      await processTranslationMessage(env, {
        type: "worldstate.translate-root",
        runId, fetchedAt, sourceVersion: null, sourceLocale: "en",
        targetLanguages, rootKey, payloadKey,
      });

      return { ok: true, trigger: "internal", rootKey, runId, fetchedAt, targetLanguages, payloadKey };
    });
}
