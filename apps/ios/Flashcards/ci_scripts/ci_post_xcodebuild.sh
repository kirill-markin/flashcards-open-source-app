#!/bin/sh

set -eu

SENTRY_CLI_VERSION="2.58.2"
SENTRY_CLI_DEFAULT_SHA256="5c893f7bc57dbcb87ec941c08420ef07cf485e931238c83cc8fbbe2ba69fec9f"
SENTRY_CLI_DOWNLOAD_ATTEMPTS="3"
SENTRY_CLI_DOWNLOAD_RETRY_SLEEP_SECONDS="2"
SENTRY_CLI_UPLOAD_ATTEMPTS="3"
SENTRY_CLI_UPLOAD_RETRY_SLEEP_SECONDS="2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT_DIR="$(cd "${PROJECT_DIR}/../../.." && pwd)"
LOCAL_ENV_PATH="${REPO_ROOT_DIR}/.env"
LOCAL_SENTRY_ENV_PATH="${REPO_ROOT_DIR}/.env.sentry"

append_missing_key() {
  key="$1"

  if [ -n "${MISSING_KEYS}" ]; then
    MISSING_KEYS="${MISSING_KEYS}, ${key}"
    return
  fi

  MISSING_KEYS="${key}"
}

validate_required_value() {
  key="$1"
  value="$2"

  if [ -n "${value}" ]; then
    return
  fi

  append_missing_key "${key}"
}

validate_sha256_value() {
  key="$1"
  value="$2"

  if [ "${#value}" -ne 64 ]; then
    echo "${key} must be a 64-character SHA-256 hex digest. Received length: ${#value}" >&2
    exit 1
  fi

  case "${value}" in
    *[!0123456789abcdefABCDEF]*)
      echo "${key} must contain only SHA-256 hex characters." >&2
      exit 1
      ;;
  esac
}

download_sentry_cli() {
  download_url="$1"
  download_path="$2"
  attempt="1"

  while [ "${attempt}" -le "${SENTRY_CLI_DOWNLOAD_ATTEMPTS}" ]; do
    if curl -fsSL "${download_url}" -o "${download_path}"; then
      return
    fi

    rm -f "${download_path}"

    if [ "${attempt}" -lt "${SENTRY_CLI_DOWNLOAD_ATTEMPTS}" ]; then
      echo "sentry-cli download attempt ${attempt} failed; retrying in ${SENTRY_CLI_DOWNLOAD_RETRY_SLEEP_SECONDS}s. URL: ${download_url}" >&2
      sleep "${SENTRY_CLI_DOWNLOAD_RETRY_SLEEP_SECONDS}"
    fi

    attempt=$((attempt + 1))
  done

  echo "Failed to download sentry-cli ${SENTRY_CLI_VERSION} after ${SENTRY_CLI_DOWNLOAD_ATTEMPTS} attempts. URL: ${download_url}" >&2
  exit 1
}

install_verified_sentry_cli() {
  expected_sha256="$1"

  validate_sha256_value "SENTRY_CLI_EXPECTED_SHA256" "${expected_sha256}"

  install_dir="$(mktemp -d "${TMPDIR:-/tmp}/flashcards-sentry-cli.XXXXXX")"
  binary_path="${install_dir}/sentry-cli"
  download_path="${binary_path}.download"
  download_url="https://downloads.sentry-cdn.com/sentry-cli/${SENTRY_CLI_VERSION}/sentry-cli-Darwin-universal"

  download_sentry_cli "${download_url}" "${download_path}"

  actual_sha256="$(shasum -a 256 "${download_path}" | sed 's/ .*//')"
  expected_sha256="$(printf "%s" "${expected_sha256}" | tr '[:upper:]' '[:lower:]')"

  if [ "${actual_sha256}" != "${expected_sha256}" ]; then
    rm -f "${download_path}"
    echo "Downloaded sentry-cli ${SENTRY_CLI_VERSION} failed SHA-256 verification. Expected: ${expected_sha256}. Actual: ${actual_sha256}. URL: ${download_url}" >&2
    exit 1
  fi

  chmod +x "${download_path}"
  mv "${download_path}" "${binary_path}"
  SENTRY_CLI_BINARY_PATH="${binary_path}"
  export SENTRY_CLI_BINARY_PATH
}

upload_sentry_debug_files() {
  sentry_org="$1"
  sentry_project="$2"
  dsym_path="$3"
  attempt="1"

  while [ "${attempt}" -le "${SENTRY_CLI_UPLOAD_ATTEMPTS}" ]; do
    if "${SENTRY_CLI_BINARY_PATH}" debug-files upload \
      -o "${sentry_org}" \
      -p "${sentry_project}" \
      --include-sources \
      "${dsym_path}"; then
      return
    fi

    if [ "${attempt}" -lt "${SENTRY_CLI_UPLOAD_ATTEMPTS}" ]; then
      echo "sentry-cli debug file upload attempt ${attempt} failed; retrying in ${SENTRY_CLI_UPLOAD_RETRY_SLEEP_SECONDS}s. dSYM path: ${dsym_path}" >&2
      sleep "${SENTRY_CLI_UPLOAD_RETRY_SLEEP_SECONDS}"
    fi

    attempt=$((attempt + 1))
  done

  echo "Failed to upload Sentry debug files after ${SENTRY_CLI_UPLOAD_ATTEMPTS} attempts. dSYM path: ${dsym_path}" >&2
  exit 1
}

load_local_env_file() {
  env_path="$1"

  if [ ! -f "${env_path}" ]; then
    return
  fi

  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      "" | \#*)
        continue
        ;;
      *=*)
        key="${line%%=*}"
        value="${line#*=}"
        ;;
      *)
        continue
        ;;
    esac

    case "${key}" in
      SENTRY_AUTH_TOKEN | SENTRY_ORG | SENTRY_IOS_PROJECT | SENTRY_URL | SENTRY_CLI_EXPECTED_SHA256)
        eval "current_value=\${${key}:-}"

        if [ -n "${current_value}" ]; then
          continue
        fi

        escaped_value=$(printf "%s" "${value}" | sed "s/'/'\\\\''/g")
        eval "${key}='${escaped_value}'"
        export "${key}"
        ;;
    esac
  done < "${env_path}"
}

load_local_env_defaults() {
  load_local_env_file "${LOCAL_SENTRY_ENV_PATH}"
  load_local_env_file "${LOCAL_ENV_PATH}"
}

if [ -z "${CI_ARCHIVE_PATH:-}" ]; then
  echo "No CI_ARCHIVE_PATH is set; skipping Sentry debug file upload."
  exit 0
fi

if [ "${CI_XCODE_CLOUD:-}" != "TRUE" ]; then
  load_local_env_defaults
fi

DSYM_PATH="${CI_ARCHIVE_PATH}/dSYMs"
if [ ! -d "${DSYM_PATH}" ]; then
  echo "Archive dSYM directory is missing: ${DSYM_PATH}" >&2
  exit 1
fi

SENTRY_AUTH_TOKEN_VALUE="${SENTRY_AUTH_TOKEN:-}"
SENTRY_ORG_VALUE="${SENTRY_ORG:-}"
SENTRY_IOS_PROJECT_VALUE="${SENTRY_IOS_PROJECT:-}"
SENTRY_URL_VALUE="${SENTRY_URL:-}"
SENTRY_CLI_EXPECTED_SHA256_VALUE="${SENTRY_CLI_EXPECTED_SHA256:-${SENTRY_CLI_DEFAULT_SHA256}}"
MISSING_KEYS=""

validate_required_value "SENTRY_AUTH_TOKEN" "${SENTRY_AUTH_TOKEN_VALUE}"
validate_required_value "SENTRY_ORG" "${SENTRY_ORG_VALUE}"
validate_required_value "SENTRY_IOS_PROJECT" "${SENTRY_IOS_PROJECT_VALUE}"

if [ -n "${MISSING_KEYS}" ]; then
  echo "Sentry debug file upload requires these workflow environment variables: ${MISSING_KEYS}" >&2
  exit 1
fi

if [ -n "${SENTRY_URL_VALUE}" ]; then
  export SENTRY_URL="${SENTRY_URL_VALUE}"
fi

install_verified_sentry_cli "${SENTRY_CLI_EXPECTED_SHA256_VALUE}"

upload_sentry_debug_files "${SENTRY_ORG_VALUE}" "${SENTRY_IOS_PROJECT_VALUE}" "${DSYM_PATH}"
