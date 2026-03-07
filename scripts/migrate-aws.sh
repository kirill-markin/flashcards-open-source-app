#!/usr/bin/env bash
# Run database migrations through the AWS migration Lambda inside the VPC.

set -euo pipefail

STACK_NAME="FlashcardsOpenSourceApp"
FUNCTION_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --function-name) FUNCTION_NAME="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$FUNCTION_NAME" ]]; then
  FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='DbMigrationFunctionName'].OutputValue" \
    --output text)
fi

if [[ -z "$FUNCTION_NAME" || "$FUNCTION_NAME" == "None" ]]; then
  echo "ERROR: DbMigrationFunctionName output not found. Deploy the CDK stack first." >&2
  exit 1
fi

RESPONSE_FILE=$(mktemp)
trap 'rm -f "$RESPONSE_FILE"' EXIT

INVOKE_METADATA=$(aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  "$RESPONSE_FILE")

python3 - "$RESPONSE_FILE" "$INVOKE_METADATA" <<'PY'
import json
import pathlib
import sys

response_path = pathlib.Path(sys.argv[1])
metadata = json.loads(sys.argv[2])
payload = json.loads(response_path.read_text())

function_error = metadata.get("FunctionError")
if function_error:
    raise SystemExit(f"ERROR: Migration lambda failed ({function_error}): {json.dumps(payload)}")

if not isinstance(payload, dict):
    raise SystemExit(f"ERROR: Unexpected migration payload: {payload!r}")

applied_migrations = payload.get("appliedMigrations", [])
applied_views = payload.get("appliedViews", [])
app_role_configured = payload.get("appRoleConfigured")

print("Migrations complete.")
print(f"Applied migrations: {', '.join(applied_migrations) if applied_migrations else 'none'}")
print(f"Applied views: {', '.join(applied_views) if applied_views else 'none'}")
print(f"App role configured: {app_role_configured}")
PY
