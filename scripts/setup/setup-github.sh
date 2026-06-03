#!/usr/bin/env bash
# Configure GitHub Actions vars and secrets for this repository.
# This helper is bootstrap-only: it creates missing repo vars and secrets,
# but it does not update or remove existing values. If a configured value
# needs to change later, update it manually in GitHub or via `gh`.
# This includes CDK_ADMIN_EMAILS for CI/CD-driven bootstrap admin grants.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_NAME="FlashcardsOpenSourceApp"
REPO=""
SENTRY_DSN_SECRET_NAME="flashcards-open-source-app/sentry-dsn"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/deploy-config.sh"
load_root_env

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REPO" ]]; then
  REPO="${GITHUB_REPO:-}"
fi

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

has_variable() {
  local variable_name="$1"

  gh variable list --repo "$REPO" --json name --jq ".[] | select(.name == \"${variable_name}\") | .name" | grep -qx "$variable_name"
}

set_variable_if_missing() {
  local variable_name="$1"
  local variable_value="$2"

  if [[ -z "$variable_value" ]]; then
    return
  fi

  if has_variable "$variable_name"; then
    return
  fi

  gh variable set "$variable_name" --body "$variable_value" --repo "$REPO"
}

validate_sentry_traces_sample_rate() {
  local variable_name="$1"
  local value="$2"

  python3 - "$variable_name" "$value" <<'PY'
import math
import sys

variable_name = sys.argv[1]
value = sys.argv[2]

try:
    traces_sample_rate = float(value)
except ValueError:
    print(f"ERROR: Set {variable_name} to a number between 0 and 1.", file=sys.stderr)
    sys.exit(1)

if not math.isfinite(traces_sample_rate) or traces_sample_rate < 0 or traces_sample_rate > 1:
    print(f"ERROR: Set {variable_name} to a number between 0 and 1.", file=sys.stderr)
    sys.exit(1)
PY
}

set_required_variable_if_missing() {
  local variable_name="$1"
  local variable_value="$2"
  local error_message="$3"

  if has_variable "$variable_name"; then
    return
  fi

  variable_value="$(require_non_empty_value "$variable_value" "$error_message")"
  gh variable set "$variable_name" --body "$variable_value" --repo "$REPO"
}

set_required_sentry_traces_sample_rate_variable_if_missing() {
  local variable_name="$1"
  local variable_value="$2"
  local error_message="$3"

  if has_variable "$variable_name"; then
    return
  fi

  variable_value="$(require_non_empty_value "$variable_value" "$error_message")"
  validate_sentry_traces_sample_rate "$variable_name" "$variable_value"
  gh variable set "$variable_name" --body "$variable_value" --repo "$REPO"
}

has_secret() {
  local secret_name="$1"

  gh secret list --repo "$REPO" --json name --jq ".[] | select(.name == \"${secret_name}\") | .name" | grep -qx "$secret_name"
}

set_secret_if_missing() {
  local secret_name="$1"
  local secret_value="$2"

  if [[ -z "$secret_value" ]]; then
    return
  fi

  if has_secret "$secret_name"; then
    return
  fi

  printf '%s' "$secret_value" | gh secret set "$secret_name" --repo "$REPO"
}

set_required_secret_if_missing() {
  local secret_name="$1"
  local secret_value="$2"
  local error_message="$3"

  if has_secret "$secret_name"; then
    return
  fi

  secret_value="$(require_non_empty_value "$secret_value" "$error_message")"
  printf '%s' "$secret_value" | gh secret set "$secret_name" --repo "$REPO"
}

get_output() {
  local output_key="$1"

  aws --region "$REGION" cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text
}

REGION="$(require_non_empty_value "${AWS_REGION:-}" "Set AWS_REGION in root .env before running setup-github.sh.")"
DOMAIN_NAME="$(require_non_empty_value "${DOMAIN_NAME:-}" "Set DOMAIN_NAME in root .env before running setup-github.sh.")"
ALERT_EMAIL="$(require_non_empty_value "${ALERT_EMAIL:-}" "Set ALERT_EMAIL in root .env before running setup-github.sh.")"
GITHUB_REPO_VALUE="$(require_non_empty_value "${GITHUB_REPO:-$REPO}" "Set GITHUB_REPO in root .env or pass --repo.")"

API_CERT_ARN="$(find_certificate_arn "$REGION" "api.${DOMAIN_NAME}" "api-domain")"
AUTH_CERT_ARN="$(find_certificate_arn "$REGION" "auth.${DOMAIN_NAME}" "auth-domain")"
WEB_CERT_ARN="$(find_certificate_arn "us-east-1" "app.${DOMAIN_NAME}" "web-domain")"
ADMIN_CERT_ARN="$(find_certificate_arn "us-east-1" "admin.${DOMAIN_NAME}" "admin-domain")"
APEX_REDIRECT_CERT_ARN="$(find_certificate_arn "us-east-1" "${DOMAIN_NAME}" "apex-redirect-domain")"
OPENAI_SECRET_ARN="$(find_secret_arn "$REGION" "flashcards-open-source-app/openai-api-key")"
LANGFUSE_PUBLIC_KEY_SECRET_ARN="$(find_secret_arn "$REGION" "flashcards-open-source-app/langfuse-public-key")"
LANGFUSE_SECRET_KEY_SECRET_ARN="$(find_secret_arn "$REGION" "flashcards-open-source-app/langfuse-secret-key")"
RESEND_SECRET_ARN="$(find_secret_arn "$REGION" "flashcards-open-source-app/resend-api-key")"
DEMO_PASSWORD_SECRET_ARN="$(find_secret_arn "$REGION" "flashcards-open-source-app/demo-password-dostip")"
SENTRY_DSN_SECRET_ARN="${SENTRY_DSN_SECRET_ARN:-$(find_secret_arn "$REGION" "$SENTRY_DSN_SECRET_NAME")}"
DEMO_EMAIL_DOSTIP="${DEMO_EMAIL_DOSTIP:-}"
GUEST_AI_QUOTA_CAP="${GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP:-}"
ADMIN_EMAILS="${ADMIN_EMAILS:-}"
LANGFUSE_BASE_URL="${LANGFUSE_BASE_URL:-}"
SENTRY_ENVIRONMENT="${SENTRY_ENVIRONMENT:-production}"
SENTRY_TRACES_SAMPLE_RATE="${SENTRY_TRACES_SAMPLE_RATE:-0}"
SENTRY_ORG="${SENTRY_ORG:-}"
SENTRY_BACKEND_PROJECT="${SENTRY_BACKEND_PROJECT:-}"
VITE_SENTRY_DSN="${VITE_SENTRY_DSN:-}"
VITE_SENTRY_TRACES_SAMPLE_RATE="${VITE_SENTRY_TRACES_SAMPLE_RATE:-0}"
SENTRY_WEB_PROJECT="${SENTRY_WEB_PROJECT:-}"
SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN:-}"
ANALYTICS_SSH_PUBLIC_KEYS="${ANALYTICS_SSH_PUBLIC_KEYS:-}"
ANALYTICS_SSH_ALLOWED_CIDRS="${ANALYTICS_SSH_ALLOWED_CIDRS:-}"
ANALYTICS_SSH_USERNAME="${ANALYTICS_SSH_USERNAME:-}"
GLOBAL_METRICS_VISIBLE="${GLOBAL_METRICS_VISIBLE:-}"
if [[ -n "${ANALYTICS_SSH_PUBLIC_KEYS}" || -n "${ANALYTICS_SSH_ALLOWED_CIDRS}" || -n "${ANALYTICS_SSH_USERNAME}" ]]; then
  require_non_empty_value "${ANALYTICS_SSH_PUBLIC_KEYS}" "Set ANALYTICS_SSH_PUBLIC_KEYS in root .env before running setup-github.sh when enabling analytical SSH access." >/dev/null
  require_non_empty_value "${ANALYTICS_SSH_ALLOWED_CIDRS}" "Set ANALYTICS_SSH_ALLOWED_CIDRS in root .env before running setup-github.sh when enabling analytical SSH access." >/dev/null
  require_non_empty_value "${ANALYTICS_SSH_USERNAME}" "Set ANALYTICS_SSH_USERNAME in root .env before running setup-github.sh when enabling analytical SSH access." >/dev/null
fi
RESEND_SENDER_EMAIL=""

if [[ -n "$RESEND_SECRET_ARN" ]]; then
  RESEND_SENDER_EMAIL="$(build_resend_sender_email "$DOMAIN_NAME")"
fi

DEPLOY_ROLE_ARN="$(get_output "GithubDeployRoleArn")"

if [[ -z "$DEPLOY_ROLE_ARN" || "$DEPLOY_ROLE_ARN" == "None" ]]; then
  echo "ERROR: GithubDeployRoleArn output not found. Deploy the stack first." >&2
  exit 1
fi

set_variable_if_missing AWS_REGION "$REGION"
set_variable_if_missing CDK_DOMAIN_NAME "$DOMAIN_NAME"
set_variable_if_missing CDK_ALERT_EMAIL "$ALERT_EMAIL"
set_variable_if_missing CDK_GITHUB_REPO "$GITHUB_REPO_VALUE"
set_variable_if_missing CDK_API_CERTIFICATE_ARN "$API_CERT_ARN"
set_variable_if_missing CDK_AUTH_CERTIFICATE_ARN "$AUTH_CERT_ARN"
set_variable_if_missing CDK_WEB_CERTIFICATE_ARN_US_EAST_1 "$WEB_CERT_ARN"
set_variable_if_missing CDK_ADMIN_CERTIFICATE_ARN_US_EAST_1 "$ADMIN_CERT_ARN"
set_variable_if_missing CDK_APEX_REDIRECT_CERTIFICATE_ARN_US_EAST_1 "$APEX_REDIRECT_CERT_ARN"
set_variable_if_missing CDK_SES_SENDER_EMAIL ""
set_variable_if_missing CDK_RESEND_API_KEY_SECRET_ARN "$RESEND_SECRET_ARN"
set_variable_if_missing CDK_RESEND_SENDER_EMAIL "$RESEND_SENDER_EMAIL"
set_variable_if_missing CDK_OPENAI_API_KEY_SECRET_ARN "$OPENAI_SECRET_ARN"
set_variable_if_missing CDK_LANGFUSE_PUBLIC_KEY_SECRET_ARN "$LANGFUSE_PUBLIC_KEY_SECRET_ARN"
set_variable_if_missing CDK_LANGFUSE_SECRET_KEY_SECRET_ARN "$LANGFUSE_SECRET_KEY_SECRET_ARN"
set_variable_if_missing CDK_LANGFUSE_BASE_URL "$LANGFUSE_BASE_URL"
set_required_variable_if_missing CDK_SENTRY_DSN_SECRET_ARN "$SENTRY_DSN_SECRET_ARN" "Set SENTRY_DSN_SECRET_ARN in root .env or create the AWS secret ${SENTRY_DSN_SECRET_NAME} before running setup-github.sh."
set_required_variable_if_missing CDK_SENTRY_ENVIRONMENT "$SENTRY_ENVIRONMENT" "Set SENTRY_ENVIRONMENT in root .env before running setup-github.sh."
set_required_sentry_traces_sample_rate_variable_if_missing CDK_SENTRY_TRACES_SAMPLE_RATE "$SENTRY_TRACES_SAMPLE_RATE" "Set SENTRY_TRACES_SAMPLE_RATE in root .env before running setup-github.sh."
set_required_variable_if_missing SENTRY_ORG "$SENTRY_ORG" "Set SENTRY_ORG in root .env before running setup-github.sh."
set_required_variable_if_missing SENTRY_BACKEND_PROJECT "$SENTRY_BACKEND_PROJECT" "Set SENTRY_BACKEND_PROJECT in root .env before running setup-github.sh."
set_variable_if_missing VITE_SENTRY_DSN "$VITE_SENTRY_DSN"
set_required_sentry_traces_sample_rate_variable_if_missing VITE_SENTRY_TRACES_SAMPLE_RATE "$VITE_SENTRY_TRACES_SAMPLE_RATE" "Set VITE_SENTRY_TRACES_SAMPLE_RATE in root .env before running setup-github.sh."
if [[ -n "$VITE_SENTRY_DSN" ]]; then
  set_required_variable_if_missing SENTRY_WEB_PROJECT "$SENTRY_WEB_PROJECT" "Set SENTRY_WEB_PROJECT in root .env before running setup-github.sh when VITE_SENTRY_DSN is set."
else
  set_variable_if_missing SENTRY_WEB_PROJECT "$SENTRY_WEB_PROJECT"
fi
set_variable_if_missing CDK_DEMO_EMAIL_DOSTIP "$DEMO_EMAIL_DOSTIP"
set_variable_if_missing CDK_DEMO_PASSWORD_SECRET_ARN "$DEMO_PASSWORD_SECRET_ARN"
set_variable_if_missing CDK_GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP "$GUEST_AI_QUOTA_CAP"
set_variable_if_missing CDK_GLOBAL_METRICS_VISIBLE "$GLOBAL_METRICS_VISIBLE"
# CDK_ADMIN_EMAILS stays write-once here on purpose. After bootstrap,
# GitHub is the deploy-time source of truth for this non-secret CI input,
# so later admin-list changes must be edited manually in GitHub or via `gh`.
set_variable_if_missing CDK_ADMIN_EMAILS "$ADMIN_EMAILS"
set_variable_if_missing CDK_ANALYTICS_SSH_PUBLIC_KEYS "$ANALYTICS_SSH_PUBLIC_KEYS"
set_variable_if_missing CDK_ANALYTICS_SSH_ALLOWED_CIDRS "$ANALYTICS_SSH_ALLOWED_CIDRS"
set_variable_if_missing CDK_ANALYTICS_SSH_USERNAME "$ANALYTICS_SSH_USERNAME"

set_secret_if_missing AWS_DEPLOY_ROLE_ARN "$DEPLOY_ROLE_ARN"
set_required_secret_if_missing SENTRY_AUTH_TOKEN "$SENTRY_AUTH_TOKEN" "Set SENTRY_AUTH_TOKEN in root .env before running setup-github.sh."

echo "Global metrics visibility input: root .env GLOBAL_METRICS_VISIBLE -> GitHub variable CDK_GLOBAL_METRICS_VISIBLE."
echo "Only the exact raw string 'true' exposes GET /v1/global/snapshot; any other value or an unset variable keeps it hidden."
echo "setup-github.sh does not overwrite an existing CDK_GLOBAL_METRICS_VISIBLE. If deployed visibility must change, update or delete that GitHub variable manually before redeploying."
echo "Missing GitHub Actions variables and secrets configured for ${REPO}."
