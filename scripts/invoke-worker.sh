#!/usr/bin/env bash
# Invoke review worker Lambda once.

set -euo pipefail

if [[ -z "${WORKER_FUNCTION:-}" ]]; then
  echo "ERROR: WORKER_FUNCTION is required" >&2
  exit 1
fi

AWS_REGION_VALUE="${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-central-1}}"

aws lambda invoke \
  --function-name "$WORKER_FUNCTION" \
  --region "$AWS_REGION_VALUE" \
  /tmp/flashcards-worker-invoke.json >/dev/null

echo "Worker invoked: $WORKER_FUNCTION"
