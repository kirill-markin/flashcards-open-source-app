#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ANDROID_DIR="${ROOT_DIR}/apps/android"

if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "ERROR: Android project not found at ${ANDROID_DIR}." >&2
  exit 1
fi

cd "${ANDROID_DIR}"

./gradlew --no-daemon --warning-mode all \
  test \
  :app:assembleDebug \
  :app:assembleDebugAndroidTest \
  :data:local:assembleDebugAndroidTest \
  :app:lintDebug
