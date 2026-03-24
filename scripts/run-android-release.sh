#!/usr/bin/env bash
# Build the Android release bundle with explicit signing inputs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${ROOT_DIR}/apps/android"
VERSION_CODE=""
KEYSTORE_PATH=""
KEYSTORE_PASSWORD=""
KEY_ALIAS=""
KEY_PASSWORD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version-code) VERSION_CODE="$2"; shift 2 ;;
    --keystore-path) KEYSTORE_PATH="$2"; shift 2 ;;
    --keystore-password) KEYSTORE_PASSWORD="$2"; shift 2 ;;
    --key-alias) KEY_ALIAS="$2"; shift 2 ;;
    --key-password) KEY_PASSWORD="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "ERROR: Android project not found at ${ANDROID_DIR}." >&2
  exit 1
fi

if [[ -z "${VERSION_CODE}" ]]; then
  echo "ERROR: --version-code is required." >&2
  exit 1
fi

if [[ -z "${KEYSTORE_PATH}" ]]; then
  echo "ERROR: --keystore-path is required." >&2
  exit 1
fi

if [[ ! -f "${KEYSTORE_PATH}" ]]; then
  echo "ERROR: Keystore not found at ${KEYSTORE_PATH}." >&2
  exit 1
fi

if [[ -z "${KEYSTORE_PASSWORD}" ]]; then
  echo "ERROR: --keystore-password is required." >&2
  exit 1
fi

if [[ -z "${KEY_ALIAS}" ]]; then
  echo "ERROR: --key-alias is required." >&2
  exit 1
fi

if [[ -z "${KEY_PASSWORD}" ]]; then
  echo "ERROR: --key-password is required." >&2
  exit 1
fi

cd "${ANDROID_DIR}"

ANDROID_VERSION_CODE="${VERSION_CODE}" \
ANDROID_RELEASE_STORE_FILE="${KEYSTORE_PATH}" \
ANDROID_RELEASE_STORE_PASSWORD="${KEYSTORE_PASSWORD}" \
ANDROID_RELEASE_KEY_ALIAS="${KEY_ALIAS}" \
ANDROID_RELEASE_KEY_PASSWORD="${KEY_PASSWORD}" \
./gradlew --no-daemon :app:bundleRelease
