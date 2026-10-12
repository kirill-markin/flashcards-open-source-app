#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION=""
TEMP_DIR="$(mktemp -d)"

OPENAI_SECRET_NAME="flashcards-open-source-app/openai-api-key"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/root-env.sh"
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

create_secret_if_missing() {
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
    echo "Secret already exists in AWS Secrets Manager and was left unchanged: ${secret_arn}" >&2
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

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Skipping optional AI secret setup: OPENAI_API_KEY is not set."
  exit 0
fi

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  OPENAI_SECRET_ARN=$(create_secret_if_missing \
    "$OPENAI_SECRET_NAME" \
    "${OPENAI_API_KEY}" \
    "OpenAI API key for flashcards-open-source-app backend chat")
  echo "Configured OpenAI API key secret in AWS Secrets Manager: ${OPENAI_SECRET_ARN}"
fi
