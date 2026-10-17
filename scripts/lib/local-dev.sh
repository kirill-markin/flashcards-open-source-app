#!/usr/bin/env bash
# Process helpers shared by the scripts/local/ development loops.

LOCAL_DEV_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_DEV_ROOT_DIR="$(cd "${LOCAL_DEV_LIB_DIR}/../.." && pwd)"
LOCAL_DEV_PIDS=()
LOCAL_DEV_NAMES=()

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "ERROR: ${command_name} is not installed. ${install_hint}" >&2
    exit 1
  fi
}

ensure_node_modules() {
  local app_dir="$1"

  if [[ ! -d "${LOCAL_DEV_ROOT_DIR}/${app_dir}/node_modules" ]]; then
    echo "Installing ${app_dir} dependencies (node_modules is missing)..."
    npm ci --prefix "${LOCAL_DEV_ROOT_DIR}/${app_dir}"
  fi
}

require_free_port() {
  local port="$1"

  if nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
    echo "ERROR: Port ${port} is already in use. Find the listener with 'lsof -nP -iTCP:${port} -sTCP:LISTEN', stop it, and retry." >&2
    exit 1
  fi
}

# The local servers listen on loopback only: their insecure local auth trusts
# the client-supplied Host header, so an all-interfaces bind would let any
# machine on the network in.
LOCAL_DEV_BIND_HOST="127.0.0.1"

# The backend and auth prefer a Secrets Manager credential over DATABASE_URL,
# so an inherited production variable would silently replace the local one.
unset_production_database_env() {
  unset DB_SECRET_ARN REPORTING_DB_SECRET_ARN DB_HOST DB_NAME
}

# Runs a shell function in the background in its own process group, so the
# cleanup trap can stop the whole tree (npm/tsx/vite/session-manager-plugin
# children included). Stdin is /dev/null so a background child never stops on
# terminal reads.
start_local_process() {
  local name="$1"
  local function_name="$2"

  set -m
  "$function_name" </dev/null &
  set +m
  LOCAL_DEV_PIDS+=("$!")
  LOCAL_DEV_NAMES+=("$name")
}

require_local_processes_running() {
  local index

  for index in "${!LOCAL_DEV_PIDS[@]}"; do
    if ! kill -0 "${LOCAL_DEV_PIDS[$index]}" 2>/dev/null; then
      echo "ERROR: ${LOCAL_DEV_NAMES[$index]} exited unexpectedly; see its output above." >&2
      exit 1
    fi
  done
}

wait_for_local_port() {
  local name="$1"
  local port="$2"
  local timeout_seconds="$3"
  local waited_seconds=0

  until nc -z 127.0.0.1 "$port" >/dev/null 2>&1; do
    require_local_processes_running
    if (( waited_seconds >= timeout_seconds )); then
      echo "ERROR: ${name} did not listen on 127.0.0.1:${port} within ${timeout_seconds}s." >&2
      exit 1
    fi
    sleep 1
    waited_seconds=$((waited_seconds + 1))
  done
}

# A SIGKILL skips the cleanup trap, so print the manual stop command up front.
print_local_process_stop_command() {
  local pid
  local group_ids=""

  for pid in "${LOCAL_DEV_PIDS[@]}"; do
    group_ids+=" -${pid}"
  done
  echo "If this script dies without cleanup, stop the servers with: kill -TERM --${group_ids}"
}

# Blocks until Ctrl-C or until any started process exits, which fails the loop.
wait_while_local_processes_run() {
  while true; do
    require_local_processes_running
    sleep 1
  done
}

stop_local_processes() {
  local index
  local pid

  for ((index = ${#LOCAL_DEV_PIDS[@]} - 1; index >= 0; index--)); do
    pid="${LOCAL_DEV_PIDS[$index]}"
    if kill -0 -- "-${pid}" 2>/dev/null; then
      echo "Stopping ${LOCAL_DEV_NAMES[$index]}..."
      kill -TERM -- "-${pid}"
    fi
  done

  for ((index = ${#LOCAL_DEV_PIDS[@]} - 1; index >= 0; index--)); do
    # The status is the TERM we just sent; only the reaping matters here.
    wait "${LOCAL_DEV_PIDS[$index]}" 2>/dev/null || true
  done
}
