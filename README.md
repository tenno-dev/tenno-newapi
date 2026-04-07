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
- `GET /bindings` confirms bindings are available in runtime
- `GET /worldstate/buckets` returns bucket mapping by top-level keys
- `GET /worldstate/split` returns live worldState split into buckets
- `GET /worldstate/cache-plan` returns cache keys + TTL policy per bucket
- `POST /worldstate/push` fetches source, writes the raw snapshot to KV, and queues downstream fan-out processing
- `GET /worldstate/status` returns latest run metadata + hash index count + D1 run count
- `GET /worldstate/stats` returns item-change counts per root key for the last N days (`days`, default `30`)
- `GET /worldstate/stats/daily` returns per-day item-change counts per root key for the last N days (`days`, default `30`, optional `rootKey`)
- `GET /worldstate/push-candidates` returns push-worthy vs non-push changed keys from the latest run
- `GET /debug/queue/index` list dummy queue processing logs from D1 (`limit`)
- `GET /debug/r1/index` alias for R2 object listing
- `GET /debug/r2/index` list R2 objects (`prefix`, `limit`, `cursor`)
- `GET /debug/kv/index` list KV keys (`prefix`, `limit`, `cursor`)
- `GET /debug/d1/index` list D1 sqlite tables and indexes (`limit`)

## Push Endpoint Notes

- Wet run: the HTTP request only fetches the source and stores the raw JSON in KV, then queue stages fan out the rest
- Queue stages are: `prepare-run` -> per-root `process-root` -> per-root `translate-root`
- Dry run (no writes): `POST /worldstate/push?dryRun=true`
- Force all keys as changed: `POST /worldstate/push?force=true`
- Dry run still computes a preview inline; wet runs return immediately with an accepted queued response
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

## Dummy Queue Cycle

- Target languages are fixed: `de, es, fr, it, ko, pl, pt, ru, zh, en, uk`
- Wet run: `POST /worldstate/push`
- Dry run preview: `POST /worldstate/push?dryRun=true`
- Inspect processed queue jobs: `GET /debug/queue/index?limit=100`
