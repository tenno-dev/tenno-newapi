import { Elysia } from "elysia";
import type { Bindings } from "../app/types";
import { SQL } from "../db/sql";
import { ensurePushTables } from "../pipeline/retention";
import { TRANSLATION_LANGS } from "../pipeline/translations/config";
import { TOP_LEVEL_WORLDSTATE_KEYS } from "../types/worldstate";

type SubscribeBody = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
  lang?: string;
  rootKeys?: string[];
  subKeyFilters?: Record<string, string[]>;
};

function parseAllowedOrigins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(",").map((part) => part.trim()).filter(Boolean));
}

function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidSubscription(body: SubscribeBody): body is Required<Pick<SubscribeBody, "endpoint" | "keys">> & SubscribeBody {
  return Boolean(body.endpoint && body.keys?.p256dh && body.keys?.auth);
}

function getClientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  const forwarded = request.headers.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",")[0]?.trim();
  return cf || firstForwarded || "unknown";
}

async function checkRateLimit(env: Bindings, request: Request, bucket: string): Promise<boolean> {
  const limit = Number(env.PUSH_SUBSCRIBE_RATE_LIMIT ?? 30);
  const windowSec = Number(env.PUSH_SUBSCRIBE_WINDOW_SECONDS ?? 60);
  const ip = getClientIp(request);
  const key = `push:ratelimit:${bucket}:${ip}`;

  const currentRaw = await env.kv.get(key);
  const current = currentRaw ? Number(currentRaw) : 0;
  if (Number.isFinite(current) && current >= limit) {
    return false;
  }

  await env.kv.put(key, String((Number.isFinite(current) ? current : 0) + 1), {
    expirationTtl: windowSec,
  });

  return true;
}

function isAllowedOrigin(env: Bindings, request: Request): boolean {
  const allowed = parseAllowedOrigins(env.PUSH_ALLOWED_ORIGINS);
  if (allowed.size === 0) return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  return allowed.has(origin);
}

function isAuthorizedPushAdmin(env: Bindings, request: Request): boolean {
  const configured = (env.PUSH_ADMIN_TOKEN ?? env.DEPLOY_TRIGGER_TOKEN ?? "").trim();
  if (!configured) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return bearerToken === configured;
}

function normalizeSubKeyFilters(
  raw: SubscribeBody["subKeyFilters"],
  canonicalRootMap: Map<string, string>
): Record<string, string[]> {
  if (!raw || typeof raw !== "object") return {};

  const normalized: Record<string, string[]> = {};

  for (const [rootKeyRaw, values] of Object.entries(raw)) {
    const rootKey = canonicalRootMap.get(rootKeyRaw.trim().toLowerCase());
    if (!rootKey || !Array.isArray(values)) continue;

    const subKeys = Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
    if (subKeys.length > 0) normalized[rootKey] = subKeys;
  }

  return normalized;
}

export function pushPlugin(env: Bindings) {
  return new Elysia({ prefix: "/push" })
    .get("/public-key", ({ set }) => {
      const publicKey = env.VAPID_PUBLIC_KEY?.trim();
      if (!publicKey) {
        set.status = 503;
        return { ok: false, error: "VAPID public key is not configured" };
      }
      set.headers["cache-control"] = "public, max-age=2592000, s-maxage=2592000, immutable";
      return { ok: true, publicKey };
    })

    .get("/subscriptions", async ({ request, set, status }) => {
      if (!isAuthorizedPushAdmin(env, request)) {
        return status(401, { ok: false, error: "unauthorized" });
      }

      await ensurePushTables(env.sql);

      type SubscriptionRow = {
        id: string; endpoint: string; p256dh: string; auth: string; lang: string;
        createdAt: string; updatedAt: string; lastSeenAt: string | null; disabledAt: string | null;
      };
      type RootKeyRow = { subscriptionId: string; rootKey: string };
      type SubKeyRow = { subscriptionId: string; rootKey: string; subKey: string };

      const [subsResult, rootKeysResult, subKeysResult] = await Promise.all([
        env.sql.prepare(SQL.selectAllPushSubscriptions).bind().all<SubscriptionRow>(),
        env.sql.prepare(SQL.selectAllPushSubscriptionRootKeys).bind().all<RootKeyRow>(),
        env.sql.prepare(SQL.selectAllPushSubscriptionSubKeys).bind().all<SubKeyRow>(),
      ]);

      const rootKeysById = new Map<string, string[]>();
      for (const row of rootKeysResult.results) {
        const arr = rootKeysById.get(row.subscriptionId) ?? [];
        arr.push(row.rootKey);
        rootKeysById.set(row.subscriptionId, arr);
      }

      const subKeysById = new Map<string, Record<string, string[]>>();
      for (const row of subKeysResult.results) {
        const byRoot = subKeysById.get(row.subscriptionId) ?? {};
        const arr = byRoot[row.rootKey] ?? [];
        arr.push(row.subKey);
        byRoot[row.rootKey] = arr;
        subKeysById.set(row.subscriptionId, byRoot);
      }

      const subscriptions = subsResult.results.map((row: SubscriptionRow) => ({
        id: row.id, endpoint: row.endpoint, lang: row.lang,
        createdAt: row.createdAt, updatedAt: row.updatedAt,
        lastSeenAt: row.lastSeenAt, disabledAt: row.disabledAt,
        rootKeys: rootKeysById.get(row.id) ?? [],
        subKeyFilters: subKeysById.get(row.id) ?? {},
      }));

      set.headers["cache-control"] = "no-store";
      return { ok: true, count: subscriptions.length, subscriptions };
    })

    .post("/subscriptions/clear", async ({ request, set, status }) => {
      if (!isAuthorizedPushAdmin(env, request)) {
        return status(401, { ok: false, error: "unauthorized" });
      }

      await ensurePushTables(env.sql);
      await env.sql.batch([
        env.sql.prepare(SQL.deleteAllPushSubscriptionSubKeys).bind(),
        env.sql.prepare(SQL.deleteAllPushSubscriptionRootKeys).bind(),
        env.sql.prepare(SQL.deleteAllPushSubscriptions).bind(),
      ]);

      set.headers["cache-control"] = "no-store";
      return { ok: true, cleared: true };
    })

    .post("/subscribe", async ({ request, set, body, status }) => {
      if (!isAllowedOrigin(env, request)) {
        return status(403, { ok: false, error: "origin not allowed" });
      }

      if (!(await checkRateLimit(env, request, "subscribe"))) {
        return status(429, { ok: false, error: "rate limit exceeded" });
      }

      const bodyData = (body ?? null) as SubscribeBody | null;
      if (!bodyData || !isValidSubscription(bodyData)) {
        return status(400, { ok: false, error: "invalid subscription" });
      }

      if (!isValidHttpsUrl(bodyData.endpoint)) {
        return status(400, { ok: false, error: "endpoint must be a valid https URL" });
      }

      const langRaw = (bodyData.lang ?? "en").trim().toLowerCase();
      const languageSet = new Set<string>(TRANSLATION_LANGS);
      if (!languageSet.has(langRaw)) {
        return status(400, { ok: false, error: "unsupported language" });
      }
      const lang = langRaw as (typeof TRANSLATION_LANGS)[number];

      const requestedRootKeys = Array.isArray(bodyData.rootKeys) ? bodyData.rootKeys : [];
      const dedupedRootKeys = Array.from(new Set(requestedRootKeys.map((k) => k.trim()).filter(Boolean)));

      if (dedupedRootKeys.length === 0) {
        return status(400, { ok: false, error: "rootKeys must include at least one key" });
      }

      const canonicalRootMap = new Map<string, string>(
        TOP_LEVEL_WORLDSTATE_KEYS.map((key) => [key.toLowerCase(), key])
      );
      const normalizedRootKeys = dedupedRootKeys.includes("*")
        ? ["*"]
        : Array.from(
            new Set(
              dedupedRootKeys
                .map((key) => canonicalRootMap.get(key.toLowerCase()))
                .filter((key): key is string => Boolean(key))
            )
          );

      if (normalizedRootKeys.length === 0) {
        return status(400, { ok: false, error: "no valid rootKeys provided" });
      }

      const subKeyFilters = normalizeSubKeyFilters(bodyData.subKeyFilters, canonicalRootMap);
      if (normalizedRootKeys.includes("*") && Object.keys(subKeyFilters).length > 0) {
        return status(400, { ok: false, error: "subKeyFilters cannot be used with wildcard root key" });
      }

      for (const rootKey of Object.keys(subKeyFilters)) {
        if (!normalizedRootKeys.includes(rootKey)) {
          return status(400, { ok: false, error: `subKeyFilters root '${rootKey}' is not included in rootKeys` });
        }
      }

      await ensurePushTables(env.sql);

      const id = bodyData.endpoint;
      const now = new Date().toISOString();
      await env.sql.prepare(SQL.upsertPushSubscription)
        .bind(id, bodyData.endpoint, bodyData.keys.p256dh, bodyData.keys.auth, lang, now, now)
        .run();

      if (normalizedRootKeys.includes("*")) {
        await env.sql.batch([
          env.sql.prepare(SQL.deletePushSubscriptionRootKeysBySubscriptionId).bind(id),
          env.sql.prepare(SQL.deletePushSubscriptionSubKeysBySubscriptionId).bind(id),
          env.sql.prepare(SQL.insertPushSubscriptionRootKey).bind(id, "*", now),
        ]);
      } else {
        const statements = [
          env.sql.prepare(SQL.deletePushSubscriptionRootKeysBySubscriptionId).bind(id),
          env.sql.prepare(SQL.deletePushSubscriptionSubKeysBySubscriptionId).bind(id),
          ...normalizedRootKeys.map((rootKey) =>
            env.sql.prepare(SQL.insertPushSubscriptionRootKey).bind(id, rootKey, now)
          ),
          ...Object.entries(subKeyFilters).flatMap(([rootKey, subKeys]) =>
            subKeys.map((subKey) =>
              env.sql.prepare(SQL.insertPushSubscriptionSubKey).bind(id, rootKey, subKey, now)
            )
          ),
        ];
        await env.sql.batch(statements);
      }

      set.headers["cache-control"] = "no-store";
      return { ok: true, id, lang, rootKeys: normalizedRootKeys, subKeyFilters };
    })

    .post("/unsubscribe", async ({ request, set, body, status }) => {
      if (!isAllowedOrigin(env, request)) {
        return status(403, { ok: false, error: "origin not allowed" });
      }

      if (!(await checkRateLimit(env, request, "unsubscribe"))) {
        return status(429, { ok: false, error: "rate limit exceeded" });
      }

      const bodyData = (body ?? null) as { endpoint?: string } | null;
      const endpoint = bodyData?.endpoint?.trim();
      if (!endpoint || !isValidHttpsUrl(endpoint)) {
        return status(400, { ok: false, error: "invalid endpoint" });
      }

      await ensurePushTables(env.sql);
      await env.sql.batch([
        env.sql.prepare(SQL.deletePushSubscriptionSubKeysByEndpoint).bind(endpoint),
        env.sql.prepare(SQL.deletePushSubscriptionRootKeysByEndpoint).bind(endpoint),
        env.sql.prepare(SQL.deletePushSubscriptionByEndpoint).bind(endpoint),
      ]);

      set.headers["cache-control"] = "no-store";
      return { ok: true };
    });
}
