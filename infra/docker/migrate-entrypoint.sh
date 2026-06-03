#!/bin/bash
set -euo pipefail
# Use native libpq env vars — no URL assembly, no special-character encoding risks.
export PGUSER="$DB_USER"
export PGPASSWORD="$DB_PASSWORD"
export PGHOST="$DB_HOST"
export PGPORT=5432
export PGDATABASE="$DB_NAME"
export PGSSLMODE=require
exec bash /scripts/deploy/migrate.sh
