#!/usr/bin/env bash
# Run fast Android CI checks, then build the debug artifacts consumed by later jobs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${ROOT_DIR}/apps/android"

if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "ERROR: Android project not found at ${ANDROID_DIR}." >&2
  exit 1
fi

cd "${ANDROID_DIR}"

./gradlew --no-daemon \
  test \
  :app:assembleDebug \
  :app:assembleDebugAndroidTest \
  :data:local:assembleDebugAndroidTest \
  :app:lintDebug
