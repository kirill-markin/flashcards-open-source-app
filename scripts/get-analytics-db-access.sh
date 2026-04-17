#!/usr/bin/env bash
# Print the current analytical DB access bundle as JSON.

set -euo pipefail

STACK_NAME="FlashcardsOpenSourceApp"
REGION="${AWS_REGION:-}"
DB_NAME="flashcards"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

AWS_REGION_ARGS=()
if [[ -n "$REGION" ]]; then
  AWS_REGION_ARGS=(--region "$REGION")
fi

get_stack_output() {
  local output_key="$1"

  aws "${AWS_REGION_ARGS[@]}" cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text
}

SSH_HOST="$(get_stack_output "AnalyticsSshHost")"
SSH_PORT="$(get_stack_output "AnalyticsSshPort")"
SSH_USERNAME="$(get_stack_output "AnalyticsSshUsername")"
DB_ENDPOINT="$(get_stack_output "DbEndpoint")"
SECRET_ARN="$(get_stack_output "ReportingDbSecretArn")"

if [[ -z "$SSH_HOST" || "$SSH_HOST" == "None" ]]; then
  echo "ERROR: AnalyticsSshHost output not found. Analytical DB access is not enabled on ${STACK_NAME}." >&2
  exit 1
fi

if [[ -z "$SSH_PORT" || "$SSH_PORT" == "None" ]]; then
  echo "ERROR: AnalyticsSshPort output not found. Analytical DB access is not enabled on ${STACK_NAME}." >&2
  exit 1
fi

if [[ -z "$SSH_USERNAME" || "$SSH_USERNAME" == "None" ]]; then
  echo "ERROR: AnalyticsSshUsername output not found. Analytical DB access is not enabled on ${STACK_NAME}." >&2
  exit 1
fi

if [[ -z "$DB_ENDPOINT" || "$DB_ENDPOINT" == "None" ]]; then
  echo "ERROR: DbEndpoint output not found. Deploy the stack first." >&2
  exit 1
fi

if [[ -z "$SECRET_ARN" || "$SECRET_ARN" == "None" ]]; then
  echo "ERROR: ReportingDbSecretArn output not found. Analytical DB access is not enabled on ${STACK_NAME}." >&2
  exit 1
fi

SECRET_JSON="$(aws "${AWS_REGION_ARGS[@]}" secretsmanager get-secret-value \
  --secret-id "$SECRET_ARN" \
  --query 'SecretString' \
  --output text)"

python3 - "$SSH_HOST" "$SSH_PORT" "$SSH_USERNAME" "$DB_ENDPOINT" "$DB_NAME" "$SECRET_ARN" "$SECRET_JSON" <<'PY'
import json
import sys

ssh_host = sys.argv[1]
ssh_port = sys.argv[2]
ssh_username = sys.argv[3]
db_endpoint = sys.argv[4]
db_name = sys.argv[5]
secret_arn = sys.argv[6]
secret_json = sys.argv[7]

secret_value = json.loads(secret_json)
username = secret_value.get("username")
password = secret_value.get("password")

if not isinstance(username, str) or username.strip() == "":
    raise SystemExit(f"ERROR: Secret {secret_arn} does not contain a valid username")

if not isinstance(password, str) or password.strip() == "":
    raise SystemExit(f"ERROR: Secret {secret_arn} does not contain a valid password")

print(json.dumps({
    "sshHost": ssh_host,
    "sshPort": ssh_port,
    "sshUsername": ssh_username,
    "dbEndpoint": db_endpoint,
    "dbName": db_name,
    "dbUsername": username,
    "secretArn": secret_arn,
    "password": password,
}, indent=2))
PY
