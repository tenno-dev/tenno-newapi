import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import * as os from "os";
import { ACTIVE_ROUTES } from "../app/routes";
import { AppEnv } from "../app/types";
import { executeTranslationSync } from "../pipeline/translations";
import { executeWorldStatePush } from "../pipeline/worldstate";
import { parseBoolean } from "../app/http";
import { processTranslationMessage } from "../queue/translator";
import { buildCurrentRootPayloadKey } from "../cache/keys";
import { TRANSLATION_LANGS } from "../pipeline/translations/config";

const WARFRAME_WORLDSTATE_URL = "https://api.warframe.com/cdn/worldState.php";

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

export function registerCoreRoutes(app: Hono<AppEnv>): void {
  app.get("/openapi.json", (c) => {
    const protocol = c.req.header("x-forwarded-proto") || new URL(c.req.url).protocol.replace(":", "");
    const host = c.req.header("host") || new URL(c.req.url).host;
    const origin = `${protocol}://${host}`;
    const spec = buildOpenApiSpec(origin);
    return c.json(spec, {
      headers: {
        "cache-control": "public, max-age=86400",
      },
    });
  });

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  app.get("/", (c) => {
    const publicRoutes = ACTIVE_ROUTES.filter(
      (entry) =>
        !entry.includes(" /debug") &&
        !entry.includes(" /debug-public") &&
        !entry.includes(" /internal/")
    );

    return c.json(
      {
        ok: true,
        message: "Active routes",
        routes: publicRoutes,
      },
      {
        headers: {
          "cache-control": "public, max-age=3600",
        },
      }
    );
  });

  app.get("/health", (c) => {
    const mem = process.memoryUsage();
    const load = os.loadavg();
    const cpuCount = os.cpus().length;
    const uptime = process.uptime();

    return c.json(
      {
        status: "healthy",
        uptime: Math.round(uptime),
        memory: {
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          rss: Math.round(mem.rss / 1024 / 1024),
          external: Math.round(mem.external / 1024 / 1024),
        },
        cpu: {
          cores: cpuCount,
          loadAverage: {
            "1m": load[0].toFixed(2),
            "5m": load[1].toFixed(2),
            "15m": load[2].toFixed(2),
          },
        },
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "cache-control": "no-cache",
        },
      }
    );
  });

  app.get("/debug-public/warframe/fetch", async (c) => {
    const response = await fetch(WARFRAME_WORLDSTATE_URL, {
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
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
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
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

    return c.json({
      ok: response.ok,
      sourceUrl: WARFRAME_WORLDSTATE_URL,
      status: response.status,
      statusText: response.statusText,
      headers,
      contentType,
      parseError,
      result: parsedBody,
      rawBody,
    });
  });

  app.post("/internal/translations/sync", async (c) => {
    const configuredToken = c.env.DEPLOY_TRIGGER_TOKEN?.trim();
    const authHeader = c.req.header("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!configuredToken) {
      return c.json({ ok: false, error: "deploy trigger token is not configured" }, 503);
    }

    if (!bearerToken || bearerToken !== configuredToken) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }

    const result = await executeTranslationSync(c.env);
    return c.json({ ok: true, trigger: "post-deploy", result });
  });

  app.post("/internal/worldstate/push", async (c) => {
    const configuredToken = c.env.DEPLOY_TRIGGER_TOKEN?.trim();
    const authHeader = c.req.header("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!configuredToken) {
      return c.json({ ok: false, error: "deploy trigger token is not configured" }, 503);
    }

    if (!bearerToken || bearerToken !== configuredToken) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }

    const force = parseBoolean(c.req.query("force"));
    const dryRun = parseBoolean(c.req.query("dryRun"));
    const result = await executeWorldStatePush(c.env, { dryRun, force });

    return c.json({ ok: true, trigger: "internal", dryRun, force, result });
  });

  app.post("/internal/translations/rebuild-root", async (c) => {
    const configuredToken = c.env.DEPLOY_TRIGGER_TOKEN?.trim();
    const authHeader = c.req.header("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    if (!configuredToken) {
      return c.json({ ok: false, error: "deploy trigger token is not configured" }, 503);
    }

    if (!bearerToken || bearerToken !== configuredToken) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }

    const rootKey = (c.req.query("rootKey") ?? "").trim();
    if (!rootKey) {
      return c.json({ ok: false, error: "rootKey is required" }, 400);
    }

    const langsRaw = c.req.query("langs")?.trim();
    const requestedLangs = langsRaw
      ? langsRaw
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      : [...TRANSLATION_LANGS];

    const supportedSet = new Set<string>(TRANSLATION_LANGS);
    const targetLanguages = Array.from(new Set(requestedLangs)).filter((lang) => supportedSet.has(lang));
    if (targetLanguages.length === 0) {
      return c.json({ ok: false, error: "no valid languages requested", supported: TRANSLATION_LANGS }, 400);
    }

    const payloadKey = buildCurrentRootPayloadKey(rootKey);
    const hasPayload = await c.env.kv.get(payloadKey);
    if (!hasPayload) {
      return c.json({ ok: false, error: `current root payload not found for rootKey '${rootKey}'` }, 404);
    }

    const runId = `${Date.now()}-manual-rebuild-${rootKey}`;
    const fetchedAt = new Date().toISOString();

    await processTranslationMessage(c.env, {
      type: "worldstate.translate-root",
      runId,
      fetchedAt,
      sourceVersion: null,
      sourceLocale: "en",
      targetLanguages,
      rootKey,
      payloadKey,
    });

    return c.json({
      ok: true,
      trigger: "internal",
      rootKey,
      runId,
      fetchedAt,
      targetLanguages,
      payloadKey,
    });
  });
}
