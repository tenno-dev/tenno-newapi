# Hono + Cloudflare Workers Base

Basic starter for Cloudflare Workers with Hono and active bindings for:

- KV (`TENNODEV_WORLDSTATE_KV`)
- R2 (`TENNODEV_ASSETS_R2`)
- D1 (`TENNODEV_WORLDSTATE_D1`)
- Queues (`TENNODEV_PUSH_QUEUE`) active with dummy consumer processing

## Setup

1. Install dependencies:

```bash
pnpm install
```

1. KV, R2, and D1 are already configured in `wrangler.jsonc`.

2. Start local dev server:

```bash
pnpm dev
```

## Routes

- `GET /` list current active routes
- `GET /health` health check
- `GET /worldstate/status` returns latest run metadata + hash index count + D1 run count
- `GET /worldstate/stats` returns item-change counts per root key for the last N days (`days`, default `30`)
- `GET /worldstate/stats/daily` returns per-day item-change counts per root key for the last N days (`days`, default `30`, optional `rootKey`)

**Debug (dev only):**

- `GET /debug/bindings` confirms bindings are available in runtime
- `GET /debug/worldstate/buckets` returns bucket mapping by top-level keys
- `GET /debug/worldstate/split` returns live worldState split into buckets
- `GET /debug/worldstate/cache-plan` returns cache keys + TTL policy per bucket
- `POST /debug/worldstate/push` push with `dryRun` and `force` flags available (`?dryRun=true`, `?force=true`)
- `GET /debug/worldstate/push-candidates` returns push-worthy vs non-push changed keys from the latest run
- `GET /debug/queue/index` list queue processing logs from D1 (`limit`)
- `GET /debug/r1/index` alias for R2 object listing
- `GET /debug/r2/index` list R2 objects (`prefix`, `limit`, `cursor`)
- `GET /debug/kv/index` list KV keys (`prefix`, `limit`, `cursor`)
- `GET /debug/d1/index` list D1 sqlite tables and indexes (`limit`)

All `/debug/*` routes return `403` outside dev.

## Push Pipeline

- Push is triggered by a cron schedule (default: every minute, configurable in `wrangler.jsonc`)
- On each tick: fetch source, write raw snapshot to KV, queue downstream fan-out stages
- Queue stages are: `prepare-run` -> per-root `process-root` -> per-root `translate-root`
- Use `POST /debug/worldstate/push?dryRun=true` or `?force=true` for manual testing in dev
- Active current snapshots are stored separately for change detection and may be removed if a root disappears from the source
- A separate last-known snapshot for each root key is stored without TTL, so the newest known entry for every root is kept regardless of age, even after source removal
- Retention only prunes per-run history and queue artifacts older than the latest 60 runs; it does not prune last-known per-root snapshots

## Stats Endpoints

- Aggregate counts by root key: `GET /worldstate/stats?days=30`
- Daily chart data for all roots: `GET /worldstate/stats/daily?days=30`
- Daily chart data for one root: `GET /worldstate/stats/daily?days=30&rootKey=Events`

## Item Diffing

- Every root key now gets item-level diffing on wet runs
- Arrays are diffed per entry when a stable identity is available (`_id`, `id`, `Node`, `Tag`, `name`)
- Objects are diffed by top-level property key
- Primitive roots are diffed as a single `value` item

## Web Push Support

### VAPID Key Setup

Generate a VAPID key pair (using any standard tool, e.g. `npx web-push generate-vapid-keys`):

```
Public Key: (base64url string)
Private Key: (base64url string)
```

Set them as Worker secrets via Wrangler:

```bash
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
```

### D1 Schema Migration

Run the provided migration to create the push subscription tables:

```bash
wrangler d1 execute tennodev_worldstate --file=migrations/0001_push_subscriptions.sql
```

The tables are also created automatically at runtime by `ensurePushTables()` when the first push route or queue ping batch is processed.

### Push API Endpoints

- `GET /push/vapid-public-key` — returns the VAPID public key for the frontend to use with `PushManager.subscribe`
- `POST /push/subscribe` — subscribe a browser for push notifications
  - Body: `{ "subscription": { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } }, "lang": "en", "rootKeys": ["Events", "*"] }`
  - `rootKeys` can contain specific keys or `"*"` to receive all notifications
- `POST /push/unsubscribe` — remove a subscription
  - Body: `{ "endpoint": "..." }` or `{ "subscription": { "endpoint": "..." } }`

### Hash-based Translated Payload Fetch

After each translation is computed, a hash index entry is stored in KV mapping `(rootKey, lang, hash)` → run payload key (7-day TTL, aligned with translated run snapshot TTL).

A new endpoint lets the Service Worker fetch the payload after receiving a ping:

- `GET /worldstate/translated/:rootKey/hashes/:hash?lang=en` — returns `{ ok: true, payload: ... }` or 404 if expired

### Push Notification Flow

1. After each `worldstate.translate-root` completes, a `worldstate.translate-ping` message is enqueued with `{ rootKey, lang, hash }`.
2. The queue consumer collects all ping messages in the batch, deduplicates by `(rootKey, lang, hash)`, then calls `sendWebPushBatch`.
3. `sendWebPushBatch` queries D1 for subscriptions matching `(lang, rootKey)` (respecting `"*"` wildcard), then sends an encrypted VAPID Web Push to each endpoint with payload `{ rootKey, lang, hash }`.
4. If the push service returns 404 or 410, the subscription is immediately removed from D1.
5. The browser Service Worker receives the push, reads `{ rootKey, lang, hash }`, and fetches `GET /worldstate/translated/:rootKey/hashes/:hash?lang=:lang` to retrieve the translated payload.


