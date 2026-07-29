#!/usr/bin/env bash
# Run database migrations through the AWS migration Lambda inside the VPC.

set -euo pipefail

STACK_NAME="FlashcardsOpenSourceApp"
FUNCTION_NAME=""
REQUIRED_MIGRATION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --function-name) FUNCTION_NAME="$2"; shift 2 ;;
    --require-migration) REQUIRED_MIGRATION="$2"; shift 2 ;;
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

python3 - "$RESPONSE_FILE" "$INVOKE_METADATA" "$REQUIRED_MIGRATION" <<'PY'
import json
import pathlib
import sys

response_path = pathlib.Path(sys.argv[1])
metadata = json.loads(sys.argv[2])
required_migration = sys.argv[3]
payload = json.loads(response_path.read_text())

function_error = metadata.get("FunctionError")
if function_error:
    raise SystemExit(f"ERROR: Migration lambda failed ({function_error}): {json.dumps(payload)}")

if not isinstance(payload, dict):
    raise SystemExit(f"ERROR: Unexpected migration payload: {payload!r}")

applied_migrations = payload.get("appliedMigrations", [])
installed_migrations = payload.get("installedMigrations")
applied_views = payload.get("appliedViews", [])
configured_runtime_roles = payload.get("configuredRuntimeRoles", [])

if not isinstance(installed_migrations, list) or not all(
    isinstance(item, str) for item in installed_migrations
):
    raise SystemExit(
        f"ERROR: Unexpected installedMigrations payload: {installed_migrations!r}"
    )
if required_migration and required_migration not in installed_migrations:
    raise SystemExit(
        f"ERROR: Required migration is not installed: {required_migration}"
    )

print("Migrations complete.")
print(f"Applied migrations: {', '.join(applied_migrations) if applied_migrations else 'none'}")
if required_migration:
    print(f"Verified required migration: {required_migration}")
print(f"Applied views: {', '.join(applied_views) if applied_views else 'none'}")
if not isinstance(configured_runtime_roles, list):
    raise SystemExit(f"ERROR: Unexpected configuredRuntimeRoles payload: {configured_runtime_roles!r}")

for item in configured_runtime_roles:
    role_name = item.get("roleName")
    configured = item.get("configured")
    print(f"Configured role {role_name}: {configured}")
PY
