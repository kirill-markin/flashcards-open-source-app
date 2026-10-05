#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID=""
DEVICES=()
APP_PATH=""
TEST_PATH=""
RESULTS_BUCKET=""
TEST_TIMEOUT=""
MAX_SESSION_DURATION=""
LABELS=""
TEST_TARGETS=()
SESSION_OUTPUT=""
ASYNC_SUBMISSION="false"
SESSION_ID=""
SESSION_ACTIVE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --device) DEVICES+=("$2"); shift 2 ;;
    --app-path) APP_PATH="$2"; shift 2 ;;
    --test-path) TEST_PATH="$2"; shift 2 ;;
    --results-bucket) RESULTS_BUCKET="$2"; shift 2 ;;
    --timeout) TEST_TIMEOUT="$2"; shift 2 ;;
    --max-session-duration) MAX_SESSION_DURATION="$2"; shift 2 ;;
    --labels) LABELS="$2"; shift 2 ;;
    --test-targets) TEST_TARGETS+=("$2"); shift 2 ;;
    --session-output) SESSION_OUTPUT="$2"; shift 2 ;;
    --async) ASYNC_SUBMISSION="true"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

for value_name in PROJECT_ID APP_PATH TEST_PATH RESULTS_BUCKET TEST_TIMEOUT SESSION_OUTPUT; do
  if [[ -z "${!value_name}" ]]; then
    echo "ERROR: ${value_name} must be supplied explicitly to Device Run." >&2
    exit 1
  fi
done

if [[ "${#DEVICES[@]}" -eq 0 ]]; then
  echo "ERROR: At least one --device catalog ID is required." >&2
  exit 1
fi

for device in "${DEVICES[@]}"; do
  if [[ ! "${device}" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "ERROR: --device requires a catalog ID, got ${device}." >&2
    exit 1
  fi
done

if [[ ! "${RESULTS_BUCKET}" =~ ^[a-z0-9][a-z0-9._-]+$ ]]; then
  echo "ERROR: --results-bucket must be a bucket name without gs:// or a path." >&2
  exit 1
fi

for command_name in gcloud jq; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: ${command_name} is required to run Device Run." >&2
    exit 1
  fi
done

for apk_path in "${APP_PATH}" "${TEST_PATH}"; do
  if [[ ! -f "${apk_path}" ]]; then
    echo "ERROR: APK not found at ${apk_path}." >&2
    exit 1
  fi
done

if [[ "${ASYNC_SUBMISSION}" != "true" ]]; then
  if [[ -z "${MAX_SESSION_DURATION}" ]] || ! command -v timeout >/dev/null 2>&1; then
    echo "ERROR: Synchronous Device Run requires --max-session-duration and GNU timeout." >&2
    exit 1
  fi
  if [[ ! "${MAX_SESSION_DURATION}" =~ ^[1-9][0-9]*[smh]?$ ]]; then
    echo "ERROR: --max-session-duration must be a positive duration such as 35m." >&2
    exit 1
  fi
fi

cleanup_on_exit() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ "${SESSION_ACTIVE}" == "true" ]]; then
    echo "WARNING: Cancelling Device Run session ${SESSION_ID} after exit ${exit_code}." >&2
    if ! timeout --kill-after=10s 60s gcloud beta device-run sessions cancel "${SESSION_ID}" \
      --project "${PROJECT_ID}" --location global --quiet; then
      echo "ERROR: Cancellation failed for ${SESSION_ID}; inspect it with gcloud beta device-run sessions describe --full." >&2
    fi
  fi
  exit "${exit_code}"
}
trap cleanup_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

submit_args=(
  beta device-run sessions submit instrumentation
  --project "${PROJECT_ID}" --location global
  --apps "${APP_PATH}" --test "${TEST_PATH}"
  --bucket-name "${RESULTS_BUCKET}"
  --instrumentation-timeout "${TEST_TIMEOUT}"
  --orchestrator-version auto
  # The runner needs this argument before Application.onCreate on physical devices.
  --additional-test-options "clearPackageData=true,isAutomation=true"
  --locale en-US --orientation portrait
  --video always
  --async --quiet
)
for device in "${DEVICES[@]}"; do
  submit_args+=(--device "${device}")
done
for test_target in "${TEST_TARGETS[@]+"${TEST_TARGETS[@]}"}"; do
  submit_args+=(--test-targets "${test_target}")
done
if [[ -n "${LABELS}" ]]; then
  submit_args+=(--labels "${LABELS}")
fi

set +e
command_output="$(gcloud "${submit_args[@]}" 2>&1)"
command_exit_code=$?
set -e
printf '%s\n' "${command_output}"
SESSION_ID="$(sed -nE 's/.*Creating session \[(session-[a-f0-9-]+)\] in location \[global\].*/\1/p' <<< "${command_output}")"
if [[ -n "${SESSION_ID}" && "${ASYNC_SUBMISSION}" != "true" ]]; then
  SESSION_ACTIVE="true"
fi
if [[ "${command_exit_code}" -ne 0 || -z "${SESSION_ID}" ]]; then
  echo "ERROR: Device Run submission failed or returned no session ID. Exit=${command_exit_code} Project=${PROJECT_ID}." >&2
  exit 1
fi

describe_session() {
  local attempt
  local error_path="${SESSION_OUTPUT}.stderr"
  # Creation is asynchronous; retry only the temporary absence of this exact session.
  for attempt in 1 2 3 4 5 6; do
    if gcloud beta device-run sessions describe "${SESSION_ID}" --full --format=json \
      --project "${PROJECT_ID}" --location global > "${SESSION_OUTPUT}" 2> "${error_path}"; then
      return 0
    fi
    cat "${error_path}" >&2
    if [[ "${attempt}" == 6 ]] || ! grep -q 'NOT_FOUND' "${error_path}"; then
      echo "ERROR: Could not describe Device Run session ${SESSION_ID}." >&2
      return 1
    fi
    echo "WARNING: Session ${SESSION_ID} is still being created; describe attempt $((attempt + 1))/6 in 5s." >&2
    sleep 5
  done
}

describe_session
expected_devices="$(jq -cn --args '$ARGS.positional | sort' -- "${DEVICES[@]}")"
expected_targets="$(jq -cn --args '$ARGS.positional | sort' -- "${TEST_TARGETS[@]+"${TEST_TARGETS[@]}"}")"
expected_labels="$(jq -cn --arg labels "${LABELS}" '
  $labels | if length == 0 then {} else
    split(",") | map(split("=") | {key: .[0], value: .[1]}) | from_entries
  end
')"
if ! jq -e --arg id "${SESSION_ID}" --arg bucket "${RESULTS_BUCKET}" --argjson devices "${expected_devices}" \
  --argjson targets "${expected_targets}" --argjson labels "${expected_labels}" '
  (.name | endswith("/locations/global/sessions/" + $id)) and
  (.sessionConfig.outputDirectoryConfig.gcsOutputDirectory.path == ("gs://" + $bucket + "/automation/sessions")) and
  ([.sessionConfig.jobConfigs[].allocationConfig.deviceConfigs[].requirement.deviceId] | sort == $devices) and
  all(.sessionConfig.jobConfigs[];
    ((.labels // {}) == $labels) and
    (.action.androidInstrumentationTest |
      ((.testTargets // []) | sort == $targets) and
      .additionalTestOptions.clearPackageData == "true" and
      .additionalTestOptions.isAutomation == "true"))
' "${SESSION_OUTPUT}" >/dev/null; then
  echo "ERROR: Device Run returned an unexpected session identity, results directory, devices, targets, labels, or instrumentation options: ${SESSION_OUTPUT}." >&2
  cat "${SESSION_OUTPUT}" >&2
  exit 1
fi
results_path="$(jq -r '.sessionConfig.outputDirectoryConfig.gcsOutputDirectory.path' "${SESSION_OUTPUT}")/${SESSION_ID}/"
echo "INFO: Session=${SESSION_ID} ResultsPath=${results_path} Report=${SESSION_OUTPUT}"

if [[ "${ASYNC_SUBMISSION}" == "true" ]]; then
  exit 0
fi

set +e
timeout --kill-after=10s "${MAX_SESSION_DURATION}" gcloud beta device-run sessions wait "${SESSION_ID}" \
  --project "${PROJECT_ID}" --location global
wait_exit_code=$?
set -e
if [[ "${wait_exit_code}" -ne 0 ]]; then
  echo "ERROR: Device Run wait failed or exceeded ${MAX_SESSION_DURATION}. Session=${SESSION_ID} Exit=${wait_exit_code}." >&2
  exit "${wait_exit_code}"
fi
SESSION_ACTIVE="false"
describe_session
# Vendor wait returns rows for failed tests too; only the full report proves success.
if ! jq -e --argjson count "${#DEVICES[@]}" '
  .sessionReport |
  .status.statusType == "DONE" and .result.resultType == "PASSED" and
  (.jobReports | length == $count) and
  all(.jobReports[];
    .status.statusType == "DONE" and .result.resultType == "PASSED" and
    (.executionReports | length > 0) and
    all(.executionReports[]; .status.statusType == "DONE" and .result.resultType == "PASSED"))
' "${SESSION_OUTPUT}" >/dev/null; then
  echo "ERROR: Device Run session or a required job/execution did not pass. Session=${SESSION_ID}." >&2
  cat "${SESSION_OUTPUT}" >&2
  exit 1
fi
