#!/usr/bin/env bash
# Create or update the Resend API key in AWS Secrets Manager
# and store its ARN plus sender email in the CDK context file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTEXT_FILE="${ROOT_DIR}/infra/aws/cdk.context.local.json"
ROOT_ENV_FILE="${ROOT_DIR}/.env"
REGION=""

if [[ -f "$ROOT_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_ENV_FILE"
  set +a
fi

RESEND_SECRET_NAME="flashcards-open-source-app/resend-api-key"

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

if [[ -z "${RESEND_API_KEY:-}" ]]; then
  echo "ERROR: RESEND_API_KEY must be set." >&2
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

DOMAIN_NAME=$(python3 - "$CONTEXT_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
value = data.get("domainName", "")
if not isinstance(value, str):
    raise SystemExit("Context key 'domainName' must be a string")
print(value)
PY
)

if [[ -z "$DOMAIN_NAME" ]]; then
  echo "ERROR: domainName must be set in the context file before configuring Resend." >&2
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
context.pop("sesSenderEmail", None)
path.write_text(json.dumps(context, indent=2) + "\n")
PY
}

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

write_context_value "resendApiKeySecretArn" "$SECRET_ARN"
write_context_value "resendSenderEmail" "$SENDER_EMAIL"

echo "Configured Resend API key secret in AWS Secrets Manager."
echo "Configured resendSenderEmail=${SENDER_EMAIL} in ${CONTEXT_FILE}."
