#!/usr/bin/env bash
# Run the admin app on http://localhost:3001 against production data, read-only.
# The backend reads production through the SSM tunnel as reporting_readonly and
# authenticates every admin request without login (AUTH_MODE=none), so both
# servers listen on 127.0.0.1 only.
# Ctrl-C stops both servers and terminates the SSM session.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=../lib/local-dev.sh
source "${ROOT_DIR}/scripts/lib/local-dev.sh"

# The default profile resolves to a different account and answers with empty results.
# Scoped to the aws and access-script calls, so the servers never inherit it.
AWS_PROFILE_NAME="flashcards-open-source-app"
TUNNEL_PORT=15432
BACKEND_PORT=8080
ADMIN_PORT=3001

ssm_session_log=""

require_command aws "Install the AWS CLI: brew install awscli"
require_command session-manager-plugin "Install it: brew install --cask session-manager-plugin"
require_command python3 "Install Python 3."
require_command npm "Install Node.js."
require_command nc "nc ships with macOS."

read_ssm_session_id() {
  if [[ -n "$ssm_session_log" && -f "$ssm_session_log" ]]; then
    tr -d '\r' <"$ssm_session_log" | sed -n 's/^Starting session with SessionId: //p' | head -n 1
  fi
}

terminate_ssm_session() {
  local ssm_session_id

  ssm_session_id="$(read_ssm_session_id)"
  if [[ -n "$ssm_session_id" ]]; then
    echo "Terminating SSM session ${ssm_session_id}..."
    if ! aws ssm terminate-session --profile "$AWS_PROFILE_NAME" --session-id "$ssm_session_id" >/dev/null; then
      echo "ERROR: Could not terminate SSM session ${ssm_session_id}. Run: aws ssm terminate-session --profile ${AWS_PROFILE_NAME} --session-id ${ssm_session_id}" >&2
    fi
  fi
}

cleanup() {
  # Killing the CLI alone leaves the SSM session running, so terminate it first.
  terminate_ssm_session
  stop_local_processes
  if [[ -n "$ssm_session_log" ]]; then
    rm -f "$ssm_session_log"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_free_port "$TUNNEL_PORT"
require_free_port "$BACKEND_PORT"
require_free_port "$ADMIN_PORT"

ensure_node_modules apps/backend
ensure_node_modules apps/admin

echo "Resolving the analytical DB access bundle (profile ${AWS_PROFILE_NAME})..."
# The bundle carries the password, resolved fresh on every run: it stays in
# shell memory, pipes and the backend environment, never on disk or in output.
access_bundle_json="$(AWS_PROFILE="$AWS_PROFILE_NAME" bash "${ROOT_DIR}/scripts/setup/get-analytics-db-access.sh")"

read_access_bundle_field() {
  local field_name="$1"

  printf '%s' "$access_bundle_json" | python3 -c '
import json
import sys

value = json.load(sys.stdin).get(sys.argv[1])
if not isinstance(value, str) or value == "":
    raise SystemExit(f"ERROR: The access bundle has no {sys.argv[1]} value.")
print(value)
' "$field_name"
}

ssm_instance_id="$(read_access_bundle_field ssmInstanceId)"
db_endpoint="$(read_access_bundle_field dbEndpoint)"
# Production forces SSL; through the tunnel the certificate names the RDS host,
# not 127.0.0.1, so verification is skipped while encryption stays on.
reporting_database_url="$(printf '%s' "$access_bundle_json" | python3 -c '
import json
import sys
from urllib.parse import quote

bundle = json.load(sys.stdin)
username = quote(bundle["dbUsername"], safe="")
password = quote(bundle["password"], safe="")
db_name = quote(bundle["dbName"], safe="")
print(f"postgresql://{username}:{password}@127.0.0.1:{sys.argv[1]}/{db_name}?sslmode=no-verify")
' "$TUNNEL_PORT")"
unset access_bundle_json

ssm_session_log="$(mktemp -t flashcards-local-admin-ssm)"

run_ssm_tunnel() {
  exec aws ssm start-session \
    --profile "$AWS_PROFILE_NAME" \
    --target "$ssm_instance_id" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"${db_endpoint}\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"${TUNNEL_PORT}\"]}" \
    >"$ssm_session_log" 2>&1
}

run_backend() {
  cd "${ROOT_DIR}/apps/backend"
  unset_production_database_env
  export PORT="$BACKEND_PORT"
  export BACKEND_BIND_HOST="$LOCAL_DEV_BIND_HOST"
  export AUTH_MODE=none
  export ALLOW_INSECURE_LOCAL_AUTH=true
  # Admin reports read only the reporting pool; the main pool gets the same
  # read-only connection, so any write path fails instead of reaching production.
  export DATABASE_URL="$reporting_database_url"
  export REPORTING_DATABASE_URL="$reporting_database_url"
  export BACKEND_ALLOWED_ORIGINS="http://localhost:${ADMIN_PORT}"
  exec npm run dev
}

run_admin() {
  cd "${ROOT_DIR}/apps/admin"
  exec node ./node_modules/vite/bin/vite.js --host "$LOCAL_DEV_BIND_HOST"
}

echo "Opening the SSM tunnel to ${db_endpoint} on 127.0.0.1:${TUNNEL_PORT}..."
start_local_process "SSM tunnel" run_ssm_tunnel
if ! (wait_for_local_port "SSM tunnel" "$TUNNEL_PORT" 60); then
  echo "SSM session output:" >&2
  cat "$ssm_session_log" >&2
  exit 1
fi

start_local_process backend run_backend
start_local_process admin run_admin
unset reporting_database_url
wait_for_local_port backend "$BACKEND_PORT" 60
wait_for_local_port admin "$ADMIN_PORT" 60

ssm_session_id="$(read_ssm_session_id)"
echo
echo "Admin on production data (read-only): http://localhost:${ADMIN_PORT}"
echo "Press Ctrl-C to stop the servers and close the tunnel."
print_local_process_stop_command
if [[ -n "$ssm_session_id" ]]; then
  echo "and close the tunnel with: aws ssm terminate-session --profile ${AWS_PROFILE_NAME} --session-id ${ssm_session_id}"
else
  echo "and close the tunnel: find its session with aws ssm describe-sessions --profile ${AWS_PROFILE_NAME} --state Active, then aws ssm terminate-session --profile ${AWS_PROFILE_NAME} --session-id <id>"
fi
wait_while_local_processes_run
