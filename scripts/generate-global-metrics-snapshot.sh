#!/usr/bin/env bash
# Generate the global metrics snapshot and seed its freshness metric.

set -euo pipefail

STACK_NAME="FlashcardsOpenSourceApp"
SNAPSHOT_FUNCTION_NAME=""
FRESHNESS_FUNCTION_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --function-name) SNAPSHOT_FUNCTION_NAME="$2"; shift 2 ;;
    --freshness-function-name) FRESHNESS_FUNCTION_NAME="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

function resolve_stack_output() {
  local output_key="$1"

  local output_value
  output_value=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text)

  if [[ -z "$output_value" || "$output_value" == "None" ]]; then
    echo "ERROR: ${output_key} is not present on ${STACK_NAME}." >&2
    exit 1
  fi

  printf '%s\n' "$output_value"
}

function invoke_lambda_and_print_payload() {
  local function_name="$1"
  local success_message="$2"

  local response_file
  response_file=$(mktemp)

  local invoke_metadata
  invoke_metadata=$(aws lambda invoke \
    --function-name "$function_name" \
    --cli-read-timeout 900 \
    --cli-binary-format raw-in-base64-out \
    --payload '{}' \
    "$response_file")

  python3 - "$response_file" "$invoke_metadata" "$success_message" "$function_name" <<'PY'
import json
import pathlib
import sys

response_path = pathlib.Path(sys.argv[1])
metadata = json.loads(sys.argv[2])
success_message = sys.argv[3]
function_name = sys.argv[4]
payload = json.loads(response_path.read_text())

function_error = metadata.get("FunctionError")
if function_error:
    raise SystemExit(
        f"ERROR: Lambda {function_name} failed ({function_error}): {json.dumps(payload)}"
    )

if not isinstance(payload, dict):
    raise SystemExit(f"ERROR: Unexpected Lambda payload from {function_name}: {payload!r}")

print(success_message)
print(json.dumps(payload, indent=2, sort_keys=True))
PY

  rm -f "$response_file"
}

if [[ -z "$SNAPSHOT_FUNCTION_NAME" ]]; then
  SNAPSHOT_FUNCTION_NAME=$(resolve_stack_output "GlobalMetricsSnapshotFunctionName")
fi

if [[ -z "$FRESHNESS_FUNCTION_NAME" ]]; then
  FRESHNESS_FUNCTION_NAME=$(resolve_stack_output "GlobalMetricsSnapshotFreshnessCheckerFunctionName")
fi

invoke_lambda_and_print_payload "$SNAPSHOT_FUNCTION_NAME" "Global metrics snapshot generated."
invoke_lambda_and_print_payload "$FRESHNESS_FUNCTION_NAME" "Global metrics snapshot freshness metric seeded."
