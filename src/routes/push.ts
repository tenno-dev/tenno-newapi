import { Context, Hono } from "hono";
import { AppEnv } from "../app/types";
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

function getClientIp(c: Context<AppEnv>): string {
  const cf = c.req.raw.headers.get("cf-connecting-ip");
  const forwarded = c.req.header("x-forwarded-for");
  const firstForwarded = forwarded?.split(",")[0]?.trim();
  return cf || firstForwarded || "unknown";
}

async function checkRateLimit(c: Context<AppEnv>, bucket: string): Promise<boolean> {
  const limit = Number(c.env.PUSH_SUBSCRIBE_RATE_LIMIT ?? 30);
  const windowSec = Number(c.env.PUSH_SUBSCRIBE_WINDOW_SECONDS ?? 60);
  const ip = getClientIp(c);
  const key = `push:ratelimit:${bucket}:${ip}`;

  const currentRaw = await c.env.kv.get(key);
  const current = currentRaw ? Number(currentRaw) : 0;
  if (Number.isFinite(current) && current >= limit) {
    return false;
  }

  await c.env.kv.put(key, String((Number.isFinite(current) ? current : 0) + 1), {
    expirationTtl: windowSec,
  });

  return true;
}

function isAllowedOrigin(c: Context<AppEnv>): boolean {
  const allowed = parseAllowedOrigins(c.env.PUSH_ALLOWED_ORIGINS);
  if (allowed.size === 0) return true;

  const origin = c.req.header("origin");
  if (!origin) return false;
  return allowed.has(origin);
}

function isAuthorizedPushAdmin(c: Context<AppEnv>): boolean {
  const configured = (c.env.PUSH_ADMIN_TOKEN ?? c.env.DEPLOY_TRIGGER_TOKEN ?? "").trim();
  if (!configured) return false;

  const authHeader = c.req.header("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return bearerToken === configured;
}

export const pushRoutes = new Hono<AppEnv>();

pushRoutes.get("/push/public-key", async (c) => {
  const publicKey = c.env.VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) {
    return c.json({ ok: false, error: "VAPID public key is not configured" }, 503);
  }
  return c.json({ ok: true, publicKey });
});

pushRoutes.get("/push/subscriptions", async (c) => {
  if (!isAuthorizedPushAdmin(c)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }

  await ensurePushTables(c.env.sql);

  type SubscriptionRow = {
    id: string; endpoint: string; p256dh: string; auth: string; lang: string;
    createdAt: string; updatedAt: string; lastSeenAt: string | null; disabledAt: string | null;
  };
  type RootKeyRow = { subscriptionId: string; rootKey: string };
  type SubKeyRow = { subscriptionId: string; rootKey: string; subKey: string };

  const [subsResult, rootKeysResult, subKeysResult] = await Promise.all([
    c.env.sql.prepare(SQL.selectAllPushSubscriptions).bind().all<SubscriptionRow>(),
    c.env.sql.prepare(SQL.selectAllPushSubscriptionRootKeys).bind().all<RootKeyRow>(),
    c.env.sql.prepare(SQL.selectAllPushSubscriptionSubKeys).bind().all<SubKeyRow>(),
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

  return c.json({ ok: true, count: subscriptions.length, subscriptions });
});

pushRoutes.post("/push/subscriptions/clear", async (c) => {
  if (!isAuthorizedPushAdmin(c)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }

  await ensurePushTables(c.env.sql);
  await c.env.sql.batch([
    c.env.sql.prepare(SQL.deleteAllPushSubscriptionSubKeys).bind(),
    c.env.sql.prepare(SQL.deleteAllPushSubscriptionRootKeys).bind(),
    c.env.sql.prepare(SQL.deleteAllPushSubscriptions).bind(),
  ]);

  return c.json({ ok: true, cleared: true });
});

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

pushRoutes.post("/push/subscribe", async (c) => {
  if (!isAllowedOrigin(c)) {
    return c.json({ ok: false, error: "origin not allowed" }, 403);
  }

  if (!(await checkRateLimit(c, "subscribe"))) {
    return c.json({ ok: false, error: "rate limit exceeded" }, 429);
  }

  const body = (await c.req.json().catch(() => null)) as SubscribeBody | null;
  if (!body || !isValidSubscription(body)) {
    return c.json({ ok: false, error: "invalid subscription" }, 400);
  }

  if (!isValidHttpsUrl(body.endpoint)) {
    return c.json({ ok: false, error: "endpoint must be a valid https URL" }, 400);
  }

  const langRaw = (body.lang ?? "en").trim().toLowerCase();
  const languageSet = new Set<string>(TRANSLATION_LANGS);
  if (!languageSet.has(langRaw)) {
    return c.json({ ok: false, error: "unsupported language" }, 400);
  }
  const lang = langRaw as (typeof TRANSLATION_LANGS)[number];

  const requestedRootKeys = Array.isArray(body.rootKeys) ? body.rootKeys : [];
  const dedupedRootKeys = Array.from(new Set(requestedRootKeys.map((k) => k.trim()).filter(Boolean)));

  if (dedupedRootKeys.length === 0) {
    return c.json({ ok: false, error: "rootKeys must include at least one key" }, 400);
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
    return c.json({ ok: false, error: "no valid rootKeys provided" }, 400);
  }

  const subKeyFilters = normalizeSubKeyFilters(body.subKeyFilters, canonicalRootMap);
  if (normalizedRootKeys.includes("*") && Object.keys(subKeyFilters).length > 0) {
    return c.json({ ok: false, error: "subKeyFilters cannot be used with wildcard root key" }, 400);
  }

  for (const rootKey of Object.keys(subKeyFilters)) {
    if (!normalizedRootKeys.includes(rootKey)) {
      return c.json({ ok: false, error: `subKeyFilters root '${rootKey}' is not included in rootKeys` }, 400);
    }
  }

  await ensurePushTables(c.env.sql);

  const id = body.endpoint;
  const now = new Date().toISOString();
  await c.env.sql.prepare(SQL.upsertPushSubscription)
    .bind(id, body.endpoint, body.keys.p256dh, body.keys.auth, lang, now, now)
    .run();

  if (normalizedRootKeys.includes("*")) {
    await c.env.sql.batch([
      c.env.sql.prepare(SQL.deletePushSubscriptionRootKeysBySubscriptionId).bind(id),
      c.env.sql.prepare(SQL.deletePushSubscriptionSubKeysBySubscriptionId).bind(id),
      c.env.sql.prepare(SQL.insertPushSubscriptionRootKey).bind(id, "*", now),
    ]);
  } else {
    const statements = [
      c.env.sql.prepare(SQL.deletePushSubscriptionRootKeysBySubscriptionId).bind(id),
      c.env.sql.prepare(SQL.deletePushSubscriptionSubKeysBySubscriptionId).bind(id),
      ...normalizedRootKeys.map((rootKey) =>
        c.env.sql.prepare(SQL.insertPushSubscriptionRootKey).bind(id, rootKey, now)
      ),
      ...Object.entries(subKeyFilters).flatMap(([rootKey, subKeys]) =>
        subKeys.map((subKey) =>
          c.env.sql.prepare(SQL.insertPushSubscriptionSubKey).bind(id, rootKey, subKey, now)
        )
      ),
    ];
    await c.env.sql.batch(statements);
  }

  return c.json({ ok: true, id, lang, rootKeys: normalizedRootKeys, subKeyFilters });
});

pushRoutes.post("/push/unsubscribe", async (c) => {
  if (!isAllowedOrigin(c)) {
    return c.json({ ok: false, error: "origin not allowed" }, 403);
  }

  if (!(await checkRateLimit(c, "unsubscribe"))) {
    return c.json({ ok: false, error: "rate limit exceeded" }, 429);
  }

  const body = (await c.req.json().catch(() => null)) as { endpoint?: string } | null;
  const endpoint = body?.endpoint?.trim();
  if (!endpoint || !isValidHttpsUrl(endpoint)) {
    return c.json({ ok: false, error: "invalid endpoint" }, 400);
  }

  await ensurePushTables(c.env.sql);
  await c.env.sql.batch([
    c.env.sql.prepare(SQL.deletePushSubscriptionSubKeysByEndpoint).bind(endpoint),
    c.env.sql.prepare(SQL.deletePushSubscriptionRootKeysByEndpoint).bind(endpoint),
    c.env.sql.prepare(SQL.deletePushSubscriptionByEndpoint).bind(endpoint),
  ]);

  return c.json({ ok: true });
});
