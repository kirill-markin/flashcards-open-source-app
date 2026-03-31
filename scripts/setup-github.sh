#!/usr/bin/env bash
# Configure GitHub Actions vars and secrets for this repository.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_NAME="FlashcardsOpenSourceApp"
REPO=""

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/deploy-config.sh"
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

  gh secret set "$secret_name" --body "$secret_value" --repo "$REPO"
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
APEX_REDIRECT_CERT_ARN="$(find_certificate_arn "us-east-1" "${DOMAIN_NAME}" "apex-redirect-domain")"
OPENAI_SECRET_ARN="$(find_secret_arn "$REGION" "flashcards-open-source-app/openai-api-key")"
LANGFUSE_PUBLIC_KEY_SECRET_ARN="$(find_secret_arn "$REGION" "flashcards-open-source-app/langfuse-public-key")"
LANGFUSE_SECRET_KEY_SECRET_ARN="$(find_secret_arn "$REGION" "flashcards-open-source-app/langfuse-secret-key")"
RESEND_SECRET_ARN="$(find_secret_arn "$REGION" "flashcards-open-source-app/resend-api-key")"
DEMO_PASSWORD_SECRET_ARN="$(find_secret_arn "$REGION" "flashcards-open-source-app/demo-password-dostip")"
DEMO_EMAIL_DOSTIP="${DEMO_EMAIL_DOSTIP:-}"
GUEST_AI_QUOTA_CAP="${GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP:-}"
LANGFUSE_BASE_URL="${LANGFUSE_BASE_URL:-}"
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
set_variable_if_missing CDK_APEX_REDIRECT_CERTIFICATE_ARN_US_EAST_1 "$APEX_REDIRECT_CERT_ARN"
set_variable_if_missing CDK_SES_SENDER_EMAIL ""
set_variable_if_missing CDK_RESEND_API_KEY_SECRET_ARN "$RESEND_SECRET_ARN"
set_variable_if_missing CDK_RESEND_SENDER_EMAIL "$RESEND_SENDER_EMAIL"
set_variable_if_missing CDK_OPENAI_API_KEY_SECRET_ARN "$OPENAI_SECRET_ARN"
set_variable_if_missing CDK_LANGFUSE_PUBLIC_KEY_SECRET_ARN "$LANGFUSE_PUBLIC_KEY_SECRET_ARN"
set_variable_if_missing CDK_LANGFUSE_SECRET_KEY_SECRET_ARN "$LANGFUSE_SECRET_KEY_SECRET_ARN"
set_variable_if_missing CDK_LANGFUSE_BASE_URL "$LANGFUSE_BASE_URL"
set_variable_if_missing CDK_DEMO_EMAIL_DOSTIP "$DEMO_EMAIL_DOSTIP"
set_variable_if_missing CDK_DEMO_PASSWORD_SECRET_ARN "$DEMO_PASSWORD_SECRET_ARN"
set_variable_if_missing CDK_GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP "$GUEST_AI_QUOTA_CAP"

set_secret_if_missing AWS_DEPLOY_ROLE_ARN "$DEPLOY_ROLE_ARN"

echo "Missing GitHub Actions variables and secrets configured for ${REPO}."
