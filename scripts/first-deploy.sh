#!/usr/bin/env bash
# End-to-end first deploy helper for a new environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/cloudflare/dns-utils.sh"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/deploy-config.sh"
load_root_env

STACK_NAME="FlashcardsOpenSourceApp"
REGION="${AWS_REGION:-}"
DOMAIN="${DOMAIN_NAME:-}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
GITHUB_REPO="${GITHUB_REPO:-}"
SETUP_GITHUB="true"
SETUP_DNS="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --alert-email) ALERT_EMAIL="$2"; shift 2 ;;
    --github-repo) GITHUB_REPO="$2"; shift 2 ;;
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --skip-github) SETUP_GITHUB="false"; shift 1 ;;
    --skip-dns) SETUP_DNS="false"; shift 1 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REGION" || -z "$DOMAIN" || -z "$ALERT_EMAIL" ]]; then
  echo "Usage: $0 --region <aws-region> --domain <domain> --alert-email <email> [--github-repo <owner/repo>]" >&2
  exit 1
fi

if [[ -z "$GITHUB_REPO" ]]; then
  GITHUB_REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

export AWS_REGION="$REGION"
export DOMAIN_NAME="$DOMAIN"
export ALERT_EMAIL="$ALERT_EMAIL"
export GITHUB_REPO="$GITHUB_REPO"

if [[ -z "$(find_certificate_arn "$REGION" "api.${DOMAIN}" "api-domain")" ]]; then
  bash "${ROOT_DIR}/scripts/cloudflare/setup-api-domain.sh" \
    --domain "$DOMAIN" \
    --region "$REGION"
fi

if [[ -z "$(find_certificate_arn "$REGION" "auth.${DOMAIN}" "auth-domain")" ]]; then
  bash "${ROOT_DIR}/scripts/cloudflare/setup-auth-domain.sh" \
    --domain "$DOMAIN" \
    --region "$REGION"
fi

if [[ -z "$(find_certificate_arn "us-east-1" "app.${DOMAIN}" "web-domain")" ]]; then
  bash "${ROOT_DIR}/scripts/cloudflare/setup-web-domain.sh" \
    --domain "$DOMAIN"
fi

APEX_RECORDS_JSON=$(cloudflare_fetch_name_records "$DOMAIN")
APEX_RECORD_COUNT=$(cloudflare_count_managed_name_records "$APEX_RECORDS_JSON")
APEX_RECORD_SUMMARY=$(cloudflare_managed_name_summary "$APEX_RECORDS_JSON")

if [[ "$APEX_RECORD_COUNT" == "0" ]]; then
  if [[ -z "$(find_certificate_arn "us-east-1" "${DOMAIN}" "apex-redirect-domain")" ]]; then
    bash "${ROOT_DIR}/scripts/cloudflare/setup-apex-redirect-domain.sh" \
      --domain "$DOMAIN"
  fi
else
  echo "Skipping apex redirect bootstrap for ${DOMAIN}: apex is already in use (${APEX_RECORD_SUMMARY})."
fi

bash "${ROOT_DIR}/scripts/bootstrap.sh" --region "$REGION" --stack-name "$STACK_NAME"

if [[ "$SETUP_DNS" == "true" ]]; then
  bash "${ROOT_DIR}/scripts/cloudflare/setup-dns.sh" --stack-name "$STACK_NAME" --domain "$DOMAIN"
  bash "${ROOT_DIR}/scripts/check-public-endpoints.sh" --stack-name "$STACK_NAME"
fi

if [[ "$SETUP_GITHUB" == "true" ]]; then
  bash "${ROOT_DIR}/scripts/setup-github.sh" --stack-name "$STACK_NAME" --repo "$GITHUB_REPO"
fi

echo "First deploy finished."
