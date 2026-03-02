#!/usr/bin/env bash
# Apply SQL migrations and views to Postgres.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

run_psql() {
  if [[ -n "${MIGRATION_DATABASE_URL:-}" ]]; then
    psql "$MIGRATION_DATABASE_URL" "$@"
  else
    psql "$@"
  fi
}

if [[ -z "${MIGRATION_DATABASE_URL:-}" && -z "${PGHOST:-}" ]]; then
  echo "ERROR: Set MIGRATION_DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE" >&2
  exit 1
fi

run_psql -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

echo "Running migrations..."
for f in "$ROOT_DIR"/db/migrations/*.sql; do
  BASENAME=$(basename "$f")
  ALREADY=$(echo "SELECT 1 FROM schema_migrations WHERE filename = :'fname'" | run_psql -v "fname=$BASENAME" -tA)
  if [[ "$ALREADY" == "1" ]]; then
    echo "  Skipping $BASENAME (already applied)"
    continue
  fi
  echo "  Applying $BASENAME"
  run_psql -v ON_ERROR_STOP=1 -f "$f"
  echo "INSERT INTO schema_migrations (filename) VALUES (:'fname')" | run_psql -v "fname=$BASENAME"
done

echo "Applying views..."
for f in "$ROOT_DIR"/db/views/*.sql; do
  echo "  Applying $(basename "$f")"
  run_psql -v ON_ERROR_STOP=1 -f "$f"
done

if [[ -n "${APP_DB_PASSWORD:-}" ]]; then
  run_psql -v "app_pass=$APP_DB_PASSWORD" <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    EXECUTE format('ALTER ROLE app WITH PASSWORD %L', :'app_pass');
  END IF;
END
$$;
SQL
fi

if [[ -n "${WORKER_DB_PASSWORD:-}" ]]; then
  run_psql -v "worker_pass=$WORKER_DB_PASSWORD" <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker') THEN
    EXECUTE format('ALTER ROLE worker WITH PASSWORD %L', :'worker_pass');
  END IF;
END
$$;
SQL
fi

echo "Migrations complete."
