#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/infra/compose/docker-compose.yml"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[deploy] ERROR: $ENV_FILE not found — copy .env.example and fill in values"
  exit 1
fi

echo "[deploy] pulling latest code..."
git pull

echo "[deploy] building images..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build

echo "[deploy] starting services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans

echo "[deploy] done"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
