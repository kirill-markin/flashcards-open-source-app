#!/usr/bin/env bash
# Run Android instrumentation tests in Firebase Test Lab.

set -euo pipefail

PROJECT_ID=""
DEVICE_MODEL=""
DEVICE_VERSION=""
APP_PATH=""
TEST_PATH=""
RESULTS_BUCKET=""
RESULTS_DIR=""
TEST_TIMEOUT=""
MAX_MATRIX_DURATION=""
TEST_TARGETS=()
MAX_INFRASTRUCTURE_RETRIES=2
MATRIX_POLL_INTERVAL_SECONDS=30
MATRIX_CANCEL_POLL_TIMEOUT_SECONDS=120
MATRIX_ID=""
MATRIX_ACTIVE="false"
ACCESS_TOKEN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --device-model) DEVICE_MODEL="$2"; shift 2 ;;
    --device-version) DEVICE_VERSION="$2"; shift 2 ;;
    --app-path) APP_PATH="$2"; shift 2 ;;
    --test-path) TEST_PATH="$2"; shift 2 ;;
    --results-bucket) RESULTS_BUCKET="$2"; shift 2 ;;
    --results-dir) RESULTS_DIR="$2"; shift 2 ;;
    --timeout) TEST_TIMEOUT="$2"; shift 2 ;;
    --max-matrix-duration) MAX_MATRIX_DURATION="$2"; shift 2 ;;
    --test-targets) TEST_TARGETS+=("$2"); shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${PROJECT_ID}" ]]; then
  echo "ERROR: --project-id is required." >&2
  exit 1
fi

if [[ -z "${DEVICE_MODEL}" ]]; then
  echo "ERROR: --device-model is required." >&2
  exit 1
fi

if [[ -z "${DEVICE_VERSION}" ]]; then
  echo "ERROR: --device-version is required." >&2
  exit 1
fi

if [[ -z "${APP_PATH}" ]]; then
  echo "ERROR: --app-path is required." >&2
  exit 1
fi

if [[ -z "${TEST_PATH}" ]]; then
  echo "ERROR: --test-path is required." >&2
  exit 1
fi

if [[ -z "${RESULTS_BUCKET}" ]]; then
  echo "ERROR: --results-bucket is required." >&2
  exit 1
fi

if [[ -z "${RESULTS_DIR}" ]]; then
  echo "ERROR: --results-dir is required." >&2
  exit 1
fi

if [[ -z "${TEST_TIMEOUT}" ]]; then
  echo "ERROR: --timeout is required." >&2
  exit 1
fi

if [[ -z "${MAX_MATRIX_DURATION}" ]]; then
  echo "ERROR: --max-matrix-duration is required." >&2
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud is required to run Firebase Test Lab." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required to monitor Firebase Test Lab matrices." >&2
  exit 1
fi

if [[ ! -f "${APP_PATH}" ]]; then
  echo "ERROR: App APK not found at ${APP_PATH}." >&2
  exit 1
fi

if [[ ! -f "${TEST_PATH}" ]]; then
  echo "ERROR: Android test APK not found at ${TEST_PATH}." >&2
  exit 1
fi

parse_duration_to_seconds() {
  local duration_value="$1"

  python3 - "$duration_value" <<'PY'
import re
import sys

duration = sys.argv[1].strip()

if re.fullmatch(r"\d+", duration):
    print(int(duration))
    raise SystemExit(0)

match = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", duration)
if match is None or all(group is None for group in match.groups()):
    raise SystemExit(1)

hours = int(match.group(1) or 0)
minutes = int(match.group(2) or 0)
seconds = int(match.group(3) or 0)
print(hours * 3600 + minutes * 60 + seconds)
PY
}

MAX_MATRIX_DURATION_SECONDS="$(parse_duration_to_seconds "${MAX_MATRIX_DURATION}")" || {
  echo "ERROR: Invalid --max-matrix-duration value: ${MAX_MATRIX_DURATION}." >&2
  exit 1
}

if [[ "${MAX_MATRIX_DURATION_SECONDS}" -le 0 ]]; then
  echo "ERROR: --max-matrix-duration must be greater than zero." >&2
  exit 1
fi

perform_testing_api_request() {
  local method="$1"
  local url="$2"
  local attempt_number=1
  local max_attempts=3
  local response_body=""

  while true; do
    set +e
    response_body="$(
      curl \
        --silent \
        --show-error \
        --fail \
        --request "${method}" \
        --header "Authorization: Bearer ${ACCESS_TOKEN}" \
        --header "Content-Type: application/json" \
        "${url}"
    )"
    local exit_code=$?
    set -e

    if [[ ${exit_code} -eq 0 ]]; then
      printf '%s' "${response_body}"
      return 0
    fi

    if [[ ${attempt_number} -ge ${max_attempts} ]]; then
      echo "ERROR: Testing API request failed after ${attempt_number} attempts. Method=${method} Url=${url}" >&2
      return "${exit_code}"
    fi

    echo "WARNING: Testing API request failed with exit code ${exit_code}. Retrying attempt $((attempt_number + 1)) of ${max_attempts}. Method=${method} Url=${url}" >&2
    attempt_number=$((attempt_number + 1))
    sleep 5
  done
}

load_access_token() {
  ACCESS_TOKEN="$(gcloud auth print-access-token --project "${PROJECT_ID}")"
}

matrix_api_url() {
  printf 'https://testing.googleapis.com/v1/projects/%s/testMatrices/%s' "${PROJECT_ID}" "${MATRIX_ID}"
}

read_matrix_summary() {
  perform_testing_api_request GET "$(matrix_api_url)" | python3 -c '
import json
import sys

matrix = json.load(sys.stdin)
execution_states = []
progress_messages = []
error_messages = []

matrix_test_details = matrix.get("testDetails") or {}
matrix_error_message = matrix_test_details.get("errorMessage", "")
if matrix_error_message:
    error_messages.append(matrix_error_message)

for execution in matrix.get("testExecutions", []):
    execution_state = execution.get("state", "")
    if execution_state:
        execution_states.append(execution_state)

    test_details = execution.get("testDetails") or {}
    execution_error_message = test_details.get("errorMessage", "")
    if execution_error_message:
        error_messages.append(execution_error_message)

    for progress_message in test_details.get("progressMessages", []):
        progress_messages.append(progress_message)

print(matrix.get("state", ""))
print(matrix.get("outcomeSummary", ""))
print(" | ".join(execution_states))
print(" | ".join(progress_messages))
print(" | ".join(error_messages))
'
}

request_matrix_cancellation() {
  if [[ -z "${MATRIX_ID}" ]]; then
    return 0
  fi

  local cancel_response=""
  cancel_response="$(perform_testing_api_request POST "$(matrix_api_url):cancel")"
  local cancel_state=""
  cancel_state="$(printf '%s' "${cancel_response}" | python3 -c 'import json, sys; response = json.load(sys.stdin); print(response.get("testState", ""))')"

  echo "WARNING: Requested Firebase Test Lab matrix cancellation. Matrix=${MATRIX_ID} State=${cancel_state}" >&2
}

wait_for_matrix_cancellation_to_settle() {
  local wait_started_at=$SECONDS

  while (( SECONDS - wait_started_at < MATRIX_CANCEL_POLL_TIMEOUT_SECONDS )); do
    mapfile -t matrix_summary_lines < <(read_matrix_summary)
    local matrix_state="${matrix_summary_lines[0]}"
    local execution_states="${matrix_summary_lines[2]}"

    if [[ "${matrix_state}" == "FINISHED" || "${matrix_state}" == "ERROR" || "${execution_states}" == *"CANCELLED"* ]]; then
      echo "WARNING: Firebase Test Lab matrix settled after cancellation request. Matrix=${MATRIX_ID} MatrixState=${matrix_state} ExecutionStates=${execution_states}" >&2
      return 0
    fi

    sleep 5
  done

  echo "WARNING: Firebase Test Lab matrix did not settle within ${MATRIX_CANCEL_POLL_TIMEOUT_SECONDS}s after cancellation request. Matrix=${MATRIX_ID}" >&2
}

cancel_active_matrix_if_needed() {
  if [[ "${MATRIX_ACTIVE}" != "true" || -z "${MATRIX_ID}" ]]; then
    return 0
  fi

  request_matrix_cancellation
  wait_for_matrix_cancellation_to_settle || true
  MATRIX_ACTIVE="false"
}

cleanup_on_exit() {
  local exit_code=$?

  trap - EXIT INT TERM

  if [[ ${exit_code} -ne 0 ]]; then
    cancel_active_matrix_if_needed || true
  fi

  exit "${exit_code}"
}

trap cleanup_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

gcloud_args=(
  firebase
  test
  android
  run
  --project
  "${PROJECT_ID}"
  --type
  instrumentation
  --app
  "${APP_PATH}"
  --test
  "${TEST_PATH}"
  --device
  "model=${DEVICE_MODEL},version=${DEVICE_VERSION},locale=en,orientation=portrait"
  --timeout
  "${TEST_TIMEOUT}"
  --use-orchestrator
  --environment-variables
  "clearPackageData=true"
  --no-performance-metrics
)

gcloud_args+=(
  --results-bucket
  "${RESULTS_BUCKET}"
  --results-dir
  "${RESULTS_DIR}"
)

for test_target in "${TEST_TARGETS[@]}"; do
  gcloud_args+=(
    --test-targets
    "${test_target}"
  )
done

load_access_token

monitor_matrix_until_finished() {
  local monitor_started_at=$SECONDS
  local last_matrix_state=""
  local last_execution_states=""
  local last_progress_messages=""

  while true; do
    mapfile -t matrix_summary_lines < <(read_matrix_summary)
    local matrix_state="${matrix_summary_lines[0]}"
    local outcome_summary="${matrix_summary_lines[1]}"
    local execution_states="${matrix_summary_lines[2]}"
    local progress_messages="${matrix_summary_lines[3]}"
    local error_messages="${matrix_summary_lines[4]}"
    local elapsed_seconds=$((SECONDS - monitor_started_at))

    if [[ "${matrix_state}" != "${last_matrix_state}" || "${execution_states}" != "${last_execution_states}" ]]; then
      echo "INFO: Firebase Test Lab matrix progress. Matrix=${MATRIX_ID} MatrixState=${matrix_state} ExecutionStates=${execution_states:-n/a} ElapsedSeconds=${elapsed_seconds}" >&2
      last_matrix_state="${matrix_state}"
      last_execution_states="${execution_states}"
    fi

    if [[ -n "${progress_messages}" && "${progress_messages}" != "${last_progress_messages}" ]]; then
      echo "INFO: Firebase Test Lab progress messages. Matrix=${MATRIX_ID} Messages=${progress_messages}" >&2
      last_progress_messages="${progress_messages}"
    fi

    if (( elapsed_seconds >= MAX_MATRIX_DURATION_SECONDS )); then
      echo "ERROR: Firebase Test Lab did not finish within ${MAX_MATRIX_DURATION}. Matrix=${MATRIX_ID} MatrixState=${matrix_state} ExecutionStates=${execution_states:-n/a}" >&2
      if [[ -n "${error_messages}" ]]; then
        echo "ERROR: Firebase Test Lab reported errors before timeout. Matrix=${MATRIX_ID} Errors=${error_messages}" >&2
      fi
      request_matrix_cancellation
      wait_for_matrix_cancellation_to_settle || true
      MATRIX_ACTIVE="false"
      return 124
    fi

    if [[ "${matrix_state}" == "ERROR" ]]; then
      MATRIX_ACTIVE="false"
      if [[ -n "${error_messages}" ]]; then
        echo "ERROR: Firebase Test Lab matrix failed due to infrastructure error. Matrix=${MATRIX_ID} Errors=${error_messages}" >&2
      else
        echo "ERROR: Firebase Test Lab matrix failed due to infrastructure error. Matrix=${MATRIX_ID}" >&2
      fi
      return 20
    fi

    if [[ "${matrix_state}" == "FINISHED" ]]; then
      MATRIX_ACTIVE="false"

      if [[ "${outcome_summary}" == "SUCCESS" ]]; then
        echo "INFO: Firebase Test Lab matrix finished successfully. Matrix=${MATRIX_ID}" >&2
        return 0
      fi

      if [[ "${execution_states}" == *"ERROR"* ]]; then
        if [[ -n "${error_messages}" ]]; then
          echo "ERROR: Firebase Test Lab execution hit an infrastructure error. Matrix=${MATRIX_ID} Errors=${error_messages}" >&2
        else
          echo "ERROR: Firebase Test Lab execution hit an infrastructure error. Matrix=${MATRIX_ID}" >&2
        fi
        return 20
      fi

      echo "ERROR: Firebase Test Lab matrix finished unsuccessfully. Matrix=${MATRIX_ID} Outcome=${outcome_summary:-UNKNOWN} ExecutionStates=${execution_states:-n/a}" >&2
      if [[ -n "${error_messages}" ]]; then
        echo "ERROR: Firebase Test Lab reported unsuccessful result details. Matrix=${MATRIX_ID} Errors=${error_messages}" >&2
      fi
      return 1
    fi

    sleep "${MATRIX_POLL_INTERVAL_SECONDS}"
  done
}

attempt_number=1

while true; do
  MATRIX_ID=""
  MATRIX_ACTIVE="false"

  set +e
  command_output="$(gcloud "${gcloud_args[@]}" --async 2>&1)"
  exit_code=$?
  set -e

  printf '%s\n' "${command_output}"

  if [[ ${exit_code} -eq 0 ]]; then
    MATRIX_ID="$(printf '%s\n' "${command_output}" | grep -o 'matrix-[[:alnum:]]\+' | head -n 1 || true)"

    if [[ -z "${MATRIX_ID}" ]]; then
      echo "ERROR: Firebase Test Lab matrix id was not found in gcloud output." >&2
      exit 1
    fi

    MATRIX_ACTIVE="true"
    set +e
    monitor_matrix_until_finished
    exit_code=$?
    set -e
  fi

  if [[ ${exit_code} -eq 0 ]]; then
    exit 0
  fi

  if [[ ${exit_code} -ne 20 ]]; then
    exit "${exit_code}"
  fi

  if [[ ${attempt_number} -gt ${MAX_INFRASTRUCTURE_RETRIES} ]]; then
    echo "ERROR: Firebase Test Lab infrastructure failure persisted after ${attempt_number} attempts." >&2
    exit "${exit_code}"
  fi

  echo "WARNING: Firebase Test Lab returned infrastructure failure (exit code ${exit_code}). Retrying attempt $((attempt_number + 1)) of $((MAX_INFRASTRUCTURE_RETRIES + 1))." >&2
  attempt_number=$((attempt_number + 1))
done
