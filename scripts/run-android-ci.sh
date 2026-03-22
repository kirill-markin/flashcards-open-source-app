#!/usr/bin/env bash
# Build the Android debug app, the Android test APK, and the lint report.

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
  :app:assembleDebug \
  :app:assembleDebugAndroidTest \
  :app:lintDebug
