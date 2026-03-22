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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --device-model) DEVICE_MODEL="$2"; shift 2 ;;
    --device-version) DEVICE_VERSION="$2"; shift 2 ;;
    --app-path) APP_PATH="$2"; shift 2 ;;
    --test-path) TEST_PATH="$2"; shift 2 ;;
    --results-bucket) RESULTS_BUCKET="$2"; shift 2 ;;
    --results-dir) RESULTS_DIR="$2"; shift 2 ;;
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

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud is required to run Firebase Test Lab." >&2
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
)

if [[ -n "${RESULTS_BUCKET}" ]]; then
  gcloud_args+=(
    --results-bucket
    "${RESULTS_BUCKET}"
  )
fi

if [[ -n "${RESULTS_DIR}" ]]; then
  gcloud_args+=(
    --results-dir
    "${RESULTS_DIR}"
  )
fi

gcloud "${gcloud_args[@]}"
