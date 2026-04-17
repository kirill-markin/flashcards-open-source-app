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

if [[ -n "${BACKEND_DB_PASSWORD:-}" ]]; then
  run_psql -v "role_name=backend_app" -v "role_pass=$BACKEND_DB_PASSWORD" <<'SQL'
SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'role_name', :'role_pass')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name')
\gexec
SQL
fi

if [[ -n "${AUTH_DB_PASSWORD:-}" ]]; then
  run_psql -v "role_name=auth_app" -v "role_pass=$AUTH_DB_PASSWORD" <<'SQL'
SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'role_name', :'role_pass')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name')
\gexec
SQL
fi

if [[ -n "${REPORTING_DB_PASSWORD:-}" ]]; then
  run_psql -v "role_name=reporting_readonly" -v "role_pass=$REPORTING_DB_PASSWORD" <<'SQL'
SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'role_name', :'role_pass')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name')
\gexec
SQL
fi

run_psql -v "admin_emails=${ADMIN_EMAILS:-}" <<'SQL'
CREATE TEMP TABLE desired_bootstrap_admins (
  email TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO desired_bootstrap_admins (email)
SELECT DISTINCT lower(btrim(raw_email))
FROM regexp_split_to_table(:'admin_emails', ',') AS raw_email
WHERE btrim(raw_email) <> '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM desired_bootstrap_admins
    WHERE position('@' IN email) = 0
  ) THEN
    RAISE EXCEPTION 'ADMIN_EMAILS contains one or more invalid email values';
  END IF;
END
$$;

INSERT INTO auth.admin_users (email, granted_at, granted_by, revoked_at, note, source)
SELECT email, now(), 'bootstrap:ADMIN_EMAILS', NULL, NULL, 'bootstrap'
FROM desired_bootstrap_admins
ON CONFLICT (email) DO UPDATE
SET granted_at = now(),
    granted_by = EXCLUDED.granted_by,
    revoked_at = NULL,
    note = NULL,
    source = 'bootstrap'
WHERE auth.admin_users.source = 'bootstrap'
  AND auth.admin_users.revoked_at IS NOT NULL;

UPDATE auth.admin_users
SET revoked_at = now()
WHERE source = 'bootstrap'
  AND revoked_at IS NULL
  AND email NOT IN (
    SELECT email
    FROM desired_bootstrap_admins
  );
SQL

echo "Migrations complete."
