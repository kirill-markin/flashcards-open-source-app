#!/usr/bin/env bash
# Create or update optional AI provider secrets in AWS Secrets Manager.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGION=""
TEMP_DIR="$(mktemp -d)"

OPENAI_SECRET_NAME="flashcards-open-source-app/openai-api-key"
ANTHROPIC_SECRET_NAME="flashcards-open-source-app/anthropic-api-key"
LANGFUSE_PUBLIC_KEY_SECRET_NAME="flashcards-open-source-app/langfuse-public-key"
LANGFUSE_SECRET_KEY_SECRET_NAME="flashcards-open-source-app/langfuse-secret-key"

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

if [[ -n "${LANGFUSE_PUBLIC_KEY:-}" && -z "${LANGFUSE_SECRET_KEY:-}" ]]; then
  echo "ERROR: LANGFUSE_PUBLIC_KEY is set but LANGFUSE_SECRET_KEY is missing." >&2
  exit 1
fi

if [[ -z "${LANGFUSE_PUBLIC_KEY:-}" && -n "${LANGFUSE_SECRET_KEY:-}" ]]; then
  echo "ERROR: LANGFUSE_SECRET_KEY is set but LANGFUSE_PUBLIC_KEY is missing." >&2
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" && -z "${LANGFUSE_PUBLIC_KEY:-}" && -z "${LANGFUSE_SECRET_KEY:-}" ]]; then
  echo "Skipping optional AI secret setup: OPENAI_API_KEY, ANTHROPIC_API_KEY, and LANGFUSE_* are not set."
  exit 0
fi

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  OPENAI_SECRET_ARN=$(create_or_update_secret \
    "$OPENAI_SECRET_NAME" \
    "${OPENAI_API_KEY}" \
    "OpenAI API key for flashcards-open-source-app backend chat")
  echo "Configured OpenAI API key secret in AWS Secrets Manager: ${OPENAI_SECRET_ARN}"
fi

if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  ANTHROPIC_SECRET_ARN=$(create_or_update_secret \
    "$ANTHROPIC_SECRET_NAME" \
    "${ANTHROPIC_API_KEY}" \
    "Anthropic API key for flashcards-open-source-app backend chat")
  echo "Configured Anthropic API key secret in AWS Secrets Manager: ${ANTHROPIC_SECRET_ARN}"
fi

if [[ -n "${LANGFUSE_PUBLIC_KEY:-}" ]]; then
  LANGFUSE_PUBLIC_SECRET_ARN=$(create_or_update_secret \
    "$LANGFUSE_PUBLIC_KEY_SECRET_NAME" \
    "${LANGFUSE_PUBLIC_KEY}" \
    "Langfuse public key for flashcards-open-source-app backend AI telemetry")
  echo "Configured Langfuse public key secret in AWS Secrets Manager: ${LANGFUSE_PUBLIC_SECRET_ARN}"

  LANGFUSE_SECRET_SECRET_ARN=$(create_or_update_secret \
    "$LANGFUSE_SECRET_KEY_SECRET_NAME" \
    "${LANGFUSE_SECRET_KEY}" \
    "Langfuse secret key for flashcards-open-source-app backend AI telemetry")
  echo "Configured Langfuse secret key secret in AWS Secrets Manager: ${LANGFUSE_SECRET_SECRET_ARN}"
fi
