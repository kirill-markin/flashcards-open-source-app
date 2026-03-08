#!/usr/bin/env bash
# Create or update optional AI provider secrets in AWS Secrets Manager
# and store their ARNs in the CDK context file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTEXT_FILE="${ROOT_DIR}/infra/aws/cdk.context.local.json"
REGION=""
TEMP_DIR="$(mktemp -d)"

OPENAI_SECRET_NAME="flashcards-open-source-app/openai-api-key"
ANTHROPIC_SECRET_NAME="flashcards-open-source-app/anthropic-api-key"

cleanup() {
  rm -rf "$TEMP_DIR"
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --context-file) CONTEXT_FILE="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$CONTEXT_FILE" ]]; then
  echo "ERROR: Context file not found: $CONTEXT_FILE" >&2
  exit 1
fi

if [[ -z "$REGION" ]]; then
  REGION=$(python3 - "$CONTEXT_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
value = data.get("region", "")
if not isinstance(value, str):
    raise SystemExit("Context key 'region' must be a string")
print(value)
PY
)
fi

if [[ -z "$REGION" ]]; then
  echo "ERROR: AWS region is required. Pass --region or set it in the context file." >&2
  exit 1
fi

write_context_value() {
  local context_key="$1"
  local context_value="$2"

  python3 - "$CONTEXT_FILE" "$context_key" "$context_value" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
context = json.loads(path.read_text())
context[key] = value
path.write_text(json.dumps(context, indent=2) + "\n")
PY
}

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

if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "Skipping optional AI secret setup: OPENAI_API_KEY and ANTHROPIC_API_KEY are not set."
  exit 0
fi

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  OPENAI_SECRET_ARN=$(create_or_update_secret \
    "$OPENAI_SECRET_NAME" \
    "${OPENAI_API_KEY}" \
    "OpenAI API key for flashcards-open-source-app backend chat")
  write_context_value "openAiApiKeySecretArn" "$OPENAI_SECRET_ARN"
  echo "Configured OpenAI API key secret in AWS Secrets Manager."
fi

if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  ANTHROPIC_SECRET_ARN=$(create_or_update_secret \
    "$ANTHROPIC_SECRET_NAME" \
    "${ANTHROPIC_API_KEY}" \
    "Anthropic API key for flashcards-open-source-app backend chat")
  write_context_value "anthropicApiKeySecretArn" "$ANTHROPIC_SECRET_ARN"
  echo "Configured Anthropic API key secret in AWS Secrets Manager."
fi
