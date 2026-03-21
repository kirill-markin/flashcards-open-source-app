#!/usr/bin/env bash
# Create or update auth-related Secrets Manager secrets.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION=""
TEMP_DIR="$(mktemp -d)"

DEMO_PASSWORD_SECRET_NAME="flashcards-open-source-app/demo-password-dostip"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/root-env.sh"
load_root_env

cleanup() {
  rm -rf "$TEMP_DIR"
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REGION" ]]; then
  REGION="${AWS_REGION:-}"
fi

if [[ -z "$REGION" ]]; then
  echo "ERROR: AWS region is required. Pass --region or set AWS_REGION in root .env." >&2
  exit 1
fi

if [[ -z "${DEMO_PASSWORD_DOSTIP:-}" ]]; then
  echo "ERROR: DEMO_PASSWORD_DOSTIP must be set before running $0." >&2
  exit 1
fi

create_or_update_secret() {
  local secret_name="$1"
  local secret_value="$2"
  local description="$3"
  local secret_arn=""
  local secret_file=""

  secret_file=$(mktemp "${TEMP_DIR}/secret.XXXXXX")
  chmod 600 "$secret_file"
  printf '%s' "$secret_value" > "$secret_file"

  secret_arn=$(aws secretsmanager describe-secret \
    --secret-id "$secret_name" \
    --region "$REGION" \
    --query ARN \
    --output text 2>/dev/null || true)

  if [[ -n "$secret_arn" && "$secret_arn" != "None" ]]; then
    aws secretsmanager put-secret-value \
      --secret-id "$secret_name" \
      --secret-string "file://${secret_file}" \
      --region "$REGION" >/dev/null
    printf '%s\n' "$secret_arn"
    return
  fi

  aws secretsmanager create-secret \
    --name "$secret_name" \
    --description "$description" \
    --secret-string "file://${secret_file}" \
    --region "$REGION" \
    --query ARN \
    --output text
}

DEMO_PASSWORD_SECRET_ARN=$(create_or_update_secret \
  "$DEMO_PASSWORD_SECRET_NAME" \
  "${DEMO_PASSWORD_DOSTIP}" \
  "Shared insecure review/demo password for flashcards-open-source-app auth bypass")

echo "Configured demo auth password secret in AWS Secrets Manager: ${DEMO_PASSWORD_SECRET_ARN}"
