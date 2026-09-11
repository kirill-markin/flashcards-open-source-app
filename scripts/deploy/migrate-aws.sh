#!/usr/bin/env bash
# Run database migrations through the AWS migration Lambda inside the VPC.
#
# --require-migration <file>   fail unless that db/migrations file is installed.
# --require-latest-migration   fail unless the newest db/migrations file in this
#                              checkout is installed; the name is resolved here,
#                              so the release never pins a stale file.
# Without either flag the script only reports what the Lambda did.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/db/migrations"

STACK_NAME="FlashcardsOpenSourceApp"
FUNCTION_NAME=""
REQUIRED_MIGRATION=""
REQUIRE_LATEST_MIGRATION="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --function-name) FUNCTION_NAME="$2"; shift 2 ;;
    --require-migration)
      if [[ -z "${2:-}" ]]; then
        echo "ERROR: --require-migration needs a migration file name; an empty value would skip the check." >&2
        exit 1
      fi
      REQUIRED_MIGRATION="$2"; shift 2 ;;
    --require-latest-migration) REQUIRE_LATEST_MIGRATION="true"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# The newest migration is the last NNNN_*.sql file. Every new migration must
# carry a prefix above the highest one already on main -
# scripts/checks/pr/check-migration-hygiene.mjs enforces that on every pull
# request - so the newest file always has the single highest prefix and every
# collation agrees on it; the two legacy duplicate prefixes (0028, 0069) are
# older and can never be newest. LC_ALL=C only keeps the answer independent of
# the runner's locale. README.md and any other non-numbered file never match
# the glob.
resolve_latest_migration() {
  local -a migration_names=()
  local migration_path

  for migration_path in "${MIGRATIONS_DIR}"/[0-9][0-9][0-9][0-9]_*.sql; do
    if [[ -f "$migration_path" ]]; then
      migration_names+=("$(basename "$migration_path")")
    fi
  done

  if [[ ${#migration_names[@]} -eq 0 ]]; then
    echo "ERROR: No NNNN_*.sql migration found in ${MIGRATIONS_DIR}; cannot resolve the latest migration to require." >&2
    exit 1
  fi

  printf '%s\n' "${migration_names[@]}" | LC_ALL=C sort | tail -n 1
}

if [[ "$REQUIRE_LATEST_MIGRATION" == "true" ]]; then
  if [[ -n "$REQUIRED_MIGRATION" ]]; then
    echo "ERROR: --require-latest-migration cannot be combined with --require-migration." >&2
    exit 1
  fi
  REQUIRED_MIGRATION="$(resolve_latest_migration)"
  echo "Resolved latest migration: ${REQUIRED_MIGRATION}"
fi

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
