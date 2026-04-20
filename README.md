# tenno-newapi

Self-hosted Node.js rewrite of the previous Cloudflare-based API.

## Runtime

- Node.js 22
- Hono
- PostgreSQL
- Redis
- Redis Streams worker
- Local filesystem blob storage
- Docker Compose deployment

## Services

- `api`: HTTP API and cron jobs
- `worker-translate`: queue consumer for translation work
- `postgres`: SQL storage
- `redis`: KV + queue backend

## Config

Single config source:

- `.env`

Compose reads `.env` via `env_file`.

Important variables:

- `DATABASE_URL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `REDIS_URL`
- `BLOB_BASE_PATH`
- `WORLDSTATE_SOURCE_URL`
- `WORLDSTATE_SOURCE_TOKEN`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `PUSH_ALLOWED_ORIGINS`
- `PUSH_ADMIN_TOKEN`
- `DEPLOY_TRIGGER_TOKEN`
- `CORS_ALLOWED_ORIGINS`

Proxy source format:

```dotenv
WORLDSTATE_SOURCE_URL=https://api2.mediathek.community/worldstate?url=
WORLDSTATE_SOURCE_TOKEN=<token>
```

## Run

Build and start:

```bash
docker compose -f infra/compose/docker-compose.yml --env-file .env up -d --build
```

Show logs:

```bash
docker compose -f infra/compose/docker-compose.yml --env-file .env logs -f api
docker compose -f infra/compose/docker-compose.yml --env-file .env logs -f worker-translate
```

Health check:

```bash
curl http://127.0.0.1:3000/health
```

## Public routes

### General

- `GET /`
  - Returns a JSON list of active non-debug, non-internal routes.

- `GET /health`
  - Returns `{"status":"healthy"}`.

- `GET /openapi.json`
  - Returns the OpenAPI document for public routes.

- `GET /docs`
  - Returns Swagger UI for `/openapi.json`.

### Worldstate

- `GET /worldstate/full?lang=en`
  - Returns the combined translated worldstate payload for one language.
  - Response includes `payload`, `missingKeys`, `payloadCount`, `timestamp`.

- `GET /worldstate/status`
  - Returns current pipeline status.
  - Response includes `latestRun`, `rootHashCount`, `d1RunCount`, `source`, `queueLanguages`.

- `GET /worldstate/runs/current?limit=20`
  - Returns the currently active run if one exists, otherwise the latest run.
  - Includes queue progress and selected/latest run metadata.

- `GET /worldstate/runs/:runId/progress`
  - Returns queue progress for one run.
  - Includes `queued`, `processed`, `failed`, `pending`, `progressPercent`, `errorRootKeys`.

- `GET /worldstate/runs/:runId/changes?rootKey=<rootKey>`
  - Returns item-level changes for one run.
  - Optional `rootKey` filters the result.

- `GET /worldstate/translated/:rootKey?lang=en`
  - Returns current translated payload for one root key and language.

- `GET /worldstate/translated/:rootKey/runs/:runId?lang=en`
  - Returns translated payload for one root key, language and run.

- `GET /worldstate/translated/:rootKey/hashes/:hash?lang=en`
  - Returns translated payload for one root key, language and content hash.

- `GET /worldstate/stats?days=30`
  - Returns aggregated change stats per root key.

- `GET /worldstate/stats/daily?days=30&rootKey=<rootKey>`
  - Returns daily change stats.
  - Optional `rootKey` limits the series to one root key.

### Push

- `GET /push/public-key`
  - Returns the public VAPID key.

- `POST /push/subscribe`
  - Creates or updates a push subscription.
  - Expected body:

```json
{
  "endpoint": "https://...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  },
  "lang": "en",
  "rootKeys": ["ActiveMissions"],
  "subKeyFilters": {
    "ActiveMissions": ["SolNode123"]
  }
}
```

- `POST /push/unsubscribe`
  - Deletes a push subscription.
  - Expected body:

```json
{
  "endpoint": "https://..."
}
```

### Public debug helper

- `GET /debug-public/warframe/fetch`
  - Fetches the official Warframe worldstate directly and returns raw response details.
  - Intended for diagnostics.

## Authenticated internal routes

All internal routes require:

```http
Authorization: Bearer <DEPLOY_TRIGGER_TOKEN>
```

- `POST /internal/worldstate/push`
  - Triggers a worldstate run.
  - Query params:
    - `force=true|false`
    - `dryRun=true|false`

- `POST /internal/translations/sync`
  - Triggers translation sync.

- `POST /internal/translations/rebuild-root?rootKey=<rootKey>&langs=en,de`
  - Rebuilds translated payloads for a root key.

## Push admin routes

Require:

```http
Authorization: Bearer <PUSH_ADMIN_TOKEN>
```

Fallback: `DEPLOY_TRIGGER_TOKEN` if `PUSH_ADMIN_TOKEN` is not set.

- `GET /push/subscriptions`
  - Returns all stored push subscriptions.

- `POST /push/subscriptions/clear`
  - Deletes all stored push subscriptions.

## Debug routes

`/debug/*` routes are dev-only. They are rejected outside a dev request context.

Available debug endpoints:

- `GET /debug/bindings`
- `GET /debug/worldstate/buckets`
- `GET /debug/worldstate/split`
- `GET /debug/worldstate/cache-plan`
- `POST /debug/worldstate/push`
- `GET /debug/worldstate/push-candidates`
- `POST /debug/translations/sync`
- `GET /debug/translations/status`
- `GET /debug/translations/view?lang=en`
- `GET /debug/queue/index`
- `GET /debug/blob/index`
- `GET /debug/r1/index`
- `GET /debug/r2/index`
- `GET /debug/kv/index`
- `GET /debug/sql/index`
- `GET /debug/d1/index`
