#!/usr/bin/env bash
# Run the web app on http://localhost:3000 against a local Docker Postgres.
# Production is never touched. The backend authenticates every request as the
# local user without login (AUTH_MODE=none), so it and the web server listen on
# 127.0.0.1 only. The database starts empty and normal onboarding seeds the
# demo card. Ctrl-C stops the servers; Docker Postgres keeps running (stop it
# with make db-down).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=../lib/local-dev.sh
source "${ROOT_DIR}/scripts/lib/local-dev.sh"

COMPOSE_FILE="${ROOT_DIR}/infra/docker/compose.yml"
BACKEND_PORT=8080
AUTH_PORT=8081
WEB_PORT=3000
WEB_ORIGIN="http://localhost:${WEB_PORT}"
DOCKER_START_TIMEOUT_SECONDS=120

require_command docker "Install Docker Desktop."
require_command npm "Install Node.js."
require_command nc "nc ships with macOS."

trap stop_local_processes EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ensure_docker_running() {
  local waited_seconds=0

  if docker info >/dev/null 2>&1; then
    return
  fi

  echo "Docker is not running; starting Docker Desktop..."
  open -a Docker
  until docker info >/dev/null 2>&1; do
    if (( waited_seconds >= DOCKER_START_TIMEOUT_SECONDS )); then
      echo "ERROR: Docker did not become ready within ${DOCKER_START_TIMEOUT_SECONDS}s. Check Docker Desktop and retry." >&2
      exit 1
    fi
    sleep 2
    waited_seconds=$((waited_seconds + 2))
  done
}

start_local_database() {
  local migrate_container_id
  local migrate_exit_code

  echo "Starting local Postgres and applying migrations..."
  docker compose -f "$COMPOSE_FILE" up -d postgres migrate
  migrate_container_id="$(docker compose -f "$COMPOSE_FILE" ps --all --quiet migrate)"
  if [[ -z "$migrate_container_id" ]]; then
    echo "ERROR: The migrate container was not created by docker compose." >&2
    exit 1
  fi

  migrate_exit_code="$(docker wait "$migrate_container_id")"
  if [[ "$migrate_exit_code" != "0" ]]; then
    docker compose -f "$COMPOSE_FILE" logs migrate >&2
    echo "ERROR: Migrations failed with exit code ${migrate_exit_code}; see the migrate log above." >&2
    exit 1
  fi
}

# Role passwords are the compose defaults applied by scripts/deploy/migrate.sh.
run_backend() {
  cd "${ROOT_DIR}/apps/backend"
  unset_production_database_env
  export PORT="$BACKEND_PORT"
  export BACKEND_BIND_HOST="$LOCAL_DEV_BIND_HOST"
  export AUTH_MODE=none
  export ALLOW_INSECURE_LOCAL_AUTH=true
  export DATABASE_URL="postgresql://backend_app:backend_app@localhost:5432/flashcards"
  export REPORTING_DATABASE_URL="postgresql://reporting_readonly:reporting_readonly@localhost:5432/flashcards"
  export BACKEND_ALLOWED_ORIGINS="$WEB_ORIGIN"
  export PUBLIC_APP_BASE_URL="$WEB_ORIGIN"
  export COOKIE_DOMAIN=localhost
  exec npm run dev
}

# The web app reads browser sign-in hints from the auth origin's bridge frame
# even without login, so auth runs too, in development mode without Cognito.
# Auth has no bind-host option and listens on every interface; it reaches only
# the local Docker Postgres, never production data.
run_auth() {
  cd "${ROOT_DIR}/apps/auth"
  unset_production_database_env
  export NODE_ENV=development
  export PORT="$AUTH_PORT"
  export ALLOWED_REDIRECT_URIS="$WEB_ORIGIN"
  export COOKIE_DOMAIN=localhost
  export DATABASE_URL="postgresql://auth_app:auth_app@localhost:5432/flashcards"
  exec npm run dev
}

run_web() {
  export VITE_LOCAL_AUTH_MODE=none
  cd "${ROOT_DIR}/apps/web"
  exec node ./node_modules/vite/bin/vite.js --host "$LOCAL_DEV_BIND_HOST"
}

require_free_port "$BACKEND_PORT"
require_free_port "$AUTH_PORT"
require_free_port "$WEB_PORT"

ensure_node_modules apps/backend
ensure_node_modules apps/auth
ensure_node_modules apps/web

ensure_docker_running
start_local_database

start_local_process backend run_backend
start_local_process auth run_auth
start_local_process web run_web
wait_for_local_port backend "$BACKEND_PORT" 60
wait_for_local_port auth "$AUTH_PORT" 60
wait_for_local_port web "$WEB_PORT" 60

echo
echo "Web app on local Docker Postgres: ${WEB_ORIGIN}"
echo "Press Ctrl-C to stop the servers. Docker Postgres keeps running; stop it with make db-down."
print_local_process_stop_command
wait_while_local_processes_run
