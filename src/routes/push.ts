import { Hono } from "hono";
import { AppEnv } from "../app/types";
import { SQL } from "../db/sql";
import { ensurePushTables } from "../pipeline/retention";

type PushSubscriptionJSON = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

function generateUuidV4(): string {
  // Generate a UUID v4-like id using Web Crypto
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function registerPushRoutes(app: Hono<AppEnv>): void {
  // GET /push/vapid-public-key
  app.get("/push/vapid-public-key", (c) => {
    const key = c.env.VAPID_PUBLIC_KEY;
    if (!key) {
      return c.json({ ok: false, error: "VAPID public key not configured" }, 503);
    }
    return c.json({ ok: true, key });
  });

  // POST /push/subscribe
  app.post("/push/subscribe", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ ok: false, error: "Body must be a JSON object" }, 400);
    }

    const req = body as Record<string, unknown>;
    const subscription = req.subscription as PushSubscriptionJSON | undefined;
    const lang = req.lang;
    const rootKeys = req.rootKeys;

    if (
      !subscription ||
      typeof subscription.endpoint !== "string" ||
      !subscription.keys ||
      typeof subscription.keys.p256dh !== "string" ||
      typeof subscription.keys.auth !== "string"
    ) {
      return c.json({ ok: false, error: "subscription must include endpoint and keys (p256dh, auth)" }, 400);
    }

    if (typeof lang !== "string" || !lang.trim()) {
      return c.json({ ok: false, error: "lang is required" }, 400);
    }

    if (!Array.isArray(rootKeys) || rootKeys.length === 0) {
      return c.json({ ok: false, error: "rootKeys[] is required and must not be empty" }, 400);
    }

    const normalizedLang = lang.trim().toLowerCase();
    const normalizedKeys = (rootKeys as unknown[])
      .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
      .map((k) => k.trim());

    if (normalizedKeys.length === 0) {
      return c.json({ ok: false, error: "rootKeys[] must contain at least one valid string" }, 400);
    }

    await ensurePushTables(c.env.TENNODEV_WORLDSTATE_D1);

    const now = new Date().toISOString();

    // Check if subscription already exists (to get/reuse id)
    const existing = await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectPushSubscriptionByEndpoint)
      .bind(subscription.endpoint)
      .first<{ id: string } | null>();

    const subscriptionId = existing?.id ?? generateUuidV4();

    // Upsert subscription row
    await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.upsertPushSubscription)
      .bind(
        subscriptionId,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        normalizedLang,
        now,
        now
      )
      .run();

    // Re-fetch the actual id (in case the upsert matched by endpoint and preserved the original id)
    const saved = await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.selectPushSubscriptionByEndpoint)
      .bind(subscription.endpoint)
      .first<{ id: string } | null>();

    const actualId = saved?.id ?? subscriptionId;

    // Replace root key rows for this subscription
    await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deletePushSubscriptionRootKeysBySubscriptionId)
      .bind(actualId)
      .run();

    // If '*' is present, insert only '*' (treat as all keys)
    const keysToInsert = normalizedKeys.includes("*") ? ["*"] : normalizedKeys;

    for (const key of keysToInsert) {
      await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.insertPushSubscriptionRootKey)
        .bind(actualId, key, now)
        .run();
    }

    return c.json({ ok: true, subscriptionId: actualId });
  });

  // POST /push/unsubscribe
  app.post("/push/unsubscribe", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ ok: false, error: "Body must be a JSON object" }, 400);
    }

    const req = body as Record<string, unknown>;
    const endpoint =
      typeof req.endpoint === "string"
        ? req.endpoint
        : typeof (req.subscription as Record<string, unknown> | undefined)?.endpoint === "string"
          ? (req.subscription as Record<string, unknown>).endpoint as string
          : null;

    if (!endpoint) {
      return c.json({ ok: false, error: "endpoint is required (or subscription.endpoint)" }, 400);
    }

    await ensurePushTables(c.env.TENNODEV_WORLDSTATE_D1);

    await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deletePushSubscriptionRootKeysByEndpoint)
      .bind(endpoint)
      .run();

    await c.env.TENNODEV_WORLDSTATE_D1.prepare(SQL.deletePushSubscriptionByEndpoint)
      .bind(endpoint)
      .run();

    return c.json({ ok: true });
  });
}
