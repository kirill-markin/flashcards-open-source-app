#!/usr/bin/env bash
# Check internal execute-api health endpoints for backend and auth gateways.

set -euo pipefail

STACK_NAME="FlashcardsOpenSourceApp"
MAX_ATTEMPTS=20
SLEEP_SECONDS=3

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --max-attempts) MAX_ATTEMPTS="$2"; shift 2 ;;
    --sleep-seconds) SLEEP_SECONDS="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

API_BASE_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" \
  --output text)

AUTH_BASE_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='AuthGatewayUrl'].OutputValue" \
  --output text)

if [[ -z "$API_BASE_URL" || "$API_BASE_URL" == "None" ]]; then
  echo "ERROR: ApiGatewayUrl output not found. Deploy the CDK stack first." >&2
  exit 1
fi

if [[ -z "$AUTH_BASE_URL" || "$AUTH_BASE_URL" == "None" ]]; then
  echo "ERROR: AuthGatewayUrl output not found. Deploy the CDK stack first." >&2
  exit 1
fi

check_health_url() {
  local health_url="$1"
  local label="$2"
  local attempt
  local http_status
  local response_file

  response_file=$(mktemp)
  trap 'rm -f "$response_file"' RETURN

  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
    http_status=$(curl -sS -o "$response_file" -w "%{http_code}" "$health_url" || true)
    if [[ "$http_status" == "200" ]]; then
      echo "${label} health check passed: ${health_url}"
      cat "$response_file"
      echo ""
      return 0
    fi

    echo "${label} health check attempt ${attempt}/${MAX_ATTEMPTS} failed with status ${http_status}: ${health_url}" >&2
    if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
      sleep "$SLEEP_SECONDS"
    fi
  done

  echo "ERROR: ${label} health check failed after ${MAX_ATTEMPTS} attempts: ${health_url}" >&2
  cat "$response_file" >&2 || true
  exit 1
}

check_health_url "${API_BASE_URL%/}/health" "Backend execute-api"
check_health_url "${AUTH_BASE_URL%/}/health" "Auth execute-api"
