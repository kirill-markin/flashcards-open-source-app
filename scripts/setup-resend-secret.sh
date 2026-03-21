#!/usr/bin/env bash
# Create or update the Resend API key in AWS Secrets Manager.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION=""

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/root-env.sh"
load_root_env

RESEND_SECRET_NAME="flashcards-open-source-app/resend-api-key"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${RESEND_API_KEY:-}" ]]; then
  echo "ERROR: RESEND_API_KEY must be set." >&2
  exit 1
fi

if [[ -z "$REGION" ]]; then
  REGION="${AWS_REGION:-}"
fi

if [[ -z "$REGION" ]]; then
  echo "ERROR: AWS region is required. Pass --region or set AWS_REGION in root .env." >&2
  exit 1
fi

DOMAIN_NAME="${DOMAIN_NAME:-}"

if [[ -z "$DOMAIN_NAME" ]]; then
  echo "ERROR: DOMAIN_NAME must be set in root .env before configuring Resend." >&2
  exit 1
fi

SENDER_EMAIL="no-reply@mail.${DOMAIN_NAME}"
TEMP_DIR="$(mktemp -d)"
SECRET_FILE="$(mktemp "${TEMP_DIR}/resend.XXXXXX")"
chmod 600 "$SECRET_FILE"
printf '%s' "${RESEND_API_KEY}" > "$SECRET_FILE"

cleanup() {
  rm -rf "$TEMP_DIR"
}

trap cleanup EXIT

SECRET_ARN=$(aws secretsmanager describe-secret \
  --secret-id "$RESEND_SECRET_NAME" \
  --region "$REGION" \
  --query ARN \
  --output text 2>/dev/null || true)

if [[ -n "$SECRET_ARN" && "$SECRET_ARN" != "None" ]]; then
  aws secretsmanager put-secret-value \
    --secret-id "$RESEND_SECRET_NAME" \
    --secret-string "file://${SECRET_FILE}" \
    --region "$REGION" >/dev/null
else
  SECRET_ARN=$(aws secretsmanager create-secret \
    --name "$RESEND_SECRET_NAME" \
    --description "Resend API key for flashcards-open-source-app Cognito custom email sender" \
    --secret-string "file://${SECRET_FILE}" \
    --region "$REGION" \
    --query ARN \
    --output text)
fi

echo "Configured Resend API key secret in AWS Secrets Manager: ${SECRET_ARN}"
echo "Derived deploy sender email: ${SENDER_EMAIL}"
