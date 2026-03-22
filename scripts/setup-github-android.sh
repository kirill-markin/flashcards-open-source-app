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

GCP_PROJECT_ID_VALUE="$(require_non_empty_value "${GCP_PROJECT_ID:-}" "Set GCP_PROJECT_ID in root .env before running setup-github-android.sh.")"
GCP_WORKLOAD_IDENTITY_PROVIDER_VALUE="$(require_non_empty_value "${GCP_WORKLOAD_IDENTITY_PROVIDER:-}" "Set GCP_WORKLOAD_IDENTITY_PROVIDER in root .env before running setup-github-android.sh.")"
GCP_SERVICE_ACCOUNT_EMAIL_VALUE="$(require_non_empty_value "${GCP_SERVICE_ACCOUNT_EMAIL:-}" "Set GCP_SERVICE_ACCOUNT_EMAIL in root .env before running setup-github-android.sh.")"
ANDROID_FTL_DEVICE_MODEL_VALUE="$(require_non_empty_value "${ANDROID_FTL_DEVICE_MODEL:-}" "Set ANDROID_FTL_DEVICE_MODEL in root .env before running setup-github-android.sh.")"
ANDROID_FTL_DEVICE_VERSION_VALUE="$(require_non_empty_value "${ANDROID_FTL_DEVICE_VERSION:-}" "Set ANDROID_FTL_DEVICE_VERSION in root .env before running setup-github-android.sh.")"

gh variable set GCP_PROJECT_ID --body "${GCP_PROJECT_ID_VALUE}" --repo "${REPO}"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "${GCP_WORKLOAD_IDENTITY_PROVIDER_VALUE}" --repo "${REPO}"
gh variable set GCP_SERVICE_ACCOUNT_EMAIL --body "${GCP_SERVICE_ACCOUNT_EMAIL_VALUE}" --repo "${REPO}"
gh variable set ANDROID_FTL_DEVICE_MODEL --body "${ANDROID_FTL_DEVICE_MODEL_VALUE}" --repo "${REPO}"
gh variable set ANDROID_FTL_DEVICE_VERSION --body "${ANDROID_FTL_DEVICE_VERSION_VALUE}" --repo "${REPO}"

if [[ -n "${ANDROID_FTL_RESULTS_BUCKET:-}" ]]; then
  gh variable set ANDROID_FTL_RESULTS_BUCKET --body "${ANDROID_FTL_RESULTS_BUCKET}" --repo "${REPO}"
fi

if [[ -n "${ANDROID_FTL_RESULTS_DIR:-}" ]]; then
  gh variable set ANDROID_FTL_RESULTS_DIR --body "${ANDROID_FTL_RESULTS_DIR}" --repo "${REPO}"
fi

echo "Android GitHub Actions variables configured for ${REPO}."
