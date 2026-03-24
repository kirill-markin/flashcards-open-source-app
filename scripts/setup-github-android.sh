#!/usr/bin/env bash
# Configure GitHub Actions variables for Android CI and Firebase Test Lab.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO=""

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/deploy-config.sh"
load_root_env

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${REPO}" ]]; then
  REPO="${GITHUB_REPO:-}"
fi

if [[ -z "${REPO}" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

has_variable() {
  local variable_name="$1"

  gh variable list --repo "${REPO}" --json name --jq ".[] | select(.name == \"${variable_name}\") | .name" | grep -qx "${variable_name}"
}

set_or_delete_variable() {
  local variable_name="$1"
  local variable_value="$2"

  if [[ -n "${variable_value}" ]]; then
    gh variable set "${variable_name}" --body "${variable_value}" --repo "${REPO}"
    return
  fi

  if has_variable "${variable_name}"; then
    gh variable delete "${variable_name}" --repo "${REPO}"
  fi
}

set_secret_if_present() {
  local secret_name="$1"
  local secret_value="$2"

  if [[ -n "${secret_value}" ]]; then
    gh secret set "${secret_name}" --body "${secret_value}" --repo "${REPO}"
  fi
}

GCP_PROJECT_ID_VALUE="$(require_non_empty_value "${GCP_PROJECT_ID:-}" "Set GCP_PROJECT_ID in root .env before running setup-github-android.sh.")"
GCP_WORKLOAD_IDENTITY_PROVIDER_VALUE="$(require_non_empty_value "${GCP_WORKLOAD_IDENTITY_PROVIDER:-}" "Set GCP_WORKLOAD_IDENTITY_PROVIDER in root .env before running setup-github-android.sh.")"
GCP_SERVICE_ACCOUNT_EMAIL_VALUE="$(require_non_empty_value "${GCP_SERVICE_ACCOUNT_EMAIL:-}" "Set GCP_SERVICE_ACCOUNT_EMAIL in root .env before running setup-github-android.sh.")"
ANDROID_FTL_DEVICE_MODEL_VALUE="$(require_non_empty_value "${ANDROID_FTL_DEVICE_MODEL:-}" "Set ANDROID_FTL_DEVICE_MODEL in root .env before running setup-github-android.sh.")"
ANDROID_FTL_DEVICE_VERSION_VALUE="$(require_non_empty_value "${ANDROID_FTL_DEVICE_VERSION:-}" "Set ANDROID_FTL_DEVICE_VERSION in root .env before running setup-github-android.sh.")"
GCP_PLAY_SERVICE_ACCOUNT_EMAIL_VALUE="${GCP_PLAY_SERVICE_ACCOUNT_EMAIL:-}"
ANDROID_PLAY_PACKAGE_NAME_VALUE="${ANDROID_PLAY_PACKAGE_NAME:-}"
ANDROID_UPLOAD_KEYSTORE_BASE64_VALUE="${ANDROID_UPLOAD_KEYSTORE_BASE64:-}"
ANDROID_UPLOAD_KEYSTORE_PASSWORD_VALUE="${ANDROID_UPLOAD_KEYSTORE_PASSWORD:-}"
ANDROID_UPLOAD_KEY_ALIAS_VALUE="${ANDROID_UPLOAD_KEY_ALIAS:-}"
ANDROID_UPLOAD_KEY_PASSWORD_VALUE="${ANDROID_UPLOAD_KEY_PASSWORD:-}"

gh variable set GCP_PROJECT_ID --body "${GCP_PROJECT_ID_VALUE}" --repo "${REPO}"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "${GCP_WORKLOAD_IDENTITY_PROVIDER_VALUE}" --repo "${REPO}"
gh variable set GCP_SERVICE_ACCOUNT_EMAIL --body "${GCP_SERVICE_ACCOUNT_EMAIL_VALUE}" --repo "${REPO}"
gh variable set ANDROID_FTL_DEVICE_MODEL --body "${ANDROID_FTL_DEVICE_MODEL_VALUE}" --repo "${REPO}"
gh variable set ANDROID_FTL_DEVICE_VERSION --body "${ANDROID_FTL_DEVICE_VERSION_VALUE}" --repo "${REPO}"
set_or_delete_variable GCP_PLAY_SERVICE_ACCOUNT_EMAIL "${GCP_PLAY_SERVICE_ACCOUNT_EMAIL_VALUE}"
set_or_delete_variable ANDROID_PLAY_PACKAGE_NAME "${ANDROID_PLAY_PACKAGE_NAME_VALUE}"

if [[ -n "${ANDROID_FTL_RESULTS_BUCKET:-}" ]]; then
  gh variable set ANDROID_FTL_RESULTS_BUCKET --body "${ANDROID_FTL_RESULTS_BUCKET}" --repo "${REPO}"
fi

if [[ -n "${ANDROID_FTL_RESULTS_DIR:-}" ]]; then
  gh variable set ANDROID_FTL_RESULTS_DIR --body "${ANDROID_FTL_RESULTS_DIR}" --repo "${REPO}"
fi

set_secret_if_present ANDROID_UPLOAD_KEYSTORE_BASE64 "${ANDROID_UPLOAD_KEYSTORE_BASE64_VALUE}"
set_secret_if_present ANDROID_UPLOAD_KEYSTORE_PASSWORD "${ANDROID_UPLOAD_KEYSTORE_PASSWORD_VALUE}"
set_secret_if_present ANDROID_UPLOAD_KEY_ALIAS "${ANDROID_UPLOAD_KEY_ALIAS_VALUE}"
set_secret_if_present ANDROID_UPLOAD_KEY_PASSWORD "${ANDROID_UPLOAD_KEY_PASSWORD_VALUE}"

echo "Android GitHub Actions variables configured for ${REPO}."
