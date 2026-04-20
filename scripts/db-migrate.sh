#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/infra/compose/docker-compose.yml"
ENV_FILE="$ROOT/.env"
SQL_FILE="${1:-}"

# Load POSTGRES_USER and POSTGRES_DB from .env for use in this script
if [[ -f "$ENV_FILE" ]]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -E '^POSTGRES_(USER|DB)=' | xargs)
fi

PGUSER="${POSTGRES_USER:-tennodev}"
PGDB="${POSTGRES_DB:-tennodev}"

if [[ -n "$SQL_FILE" ]]; then
  echo "[db-migrate] running $SQL_FILE against postgres..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
    psql -U "$PGUSER" -d "$PGDB" < "$SQL_FILE"
else
  echo "[db-migrate] opening psql shell..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec postgres \
    psql -U "$PGUSER" -d "$PGDB"
fi
