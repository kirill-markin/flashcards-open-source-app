#!/usr/bin/env bash
# Run the full Android connected instrumentation suite from the repository root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${ROOT_DIR}/apps/android"
GRADLEW_PATH="${ANDROID_DIR}/gradlew"

if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "ERROR: Android project not found at ${ANDROID_DIR}." >&2
  exit 1
fi

if [[ ! -f "${GRADLEW_PATH}" ]]; then
  echo "ERROR: Android Gradle wrapper not found at ${GRADLEW_PATH}." >&2
  exit 1
fi

if [[ ! -x "${GRADLEW_PATH}" ]]; then
  echo "ERROR: Android Gradle wrapper is not executable at ${GRADLEW_PATH}." >&2
  exit 1
fi

cd "${ANDROID_DIR}"

./gradlew --no-daemon connectedAndroidTest
