#!/usr/bin/env bash
# Verify that the deployed multipart completion reconciliation schedule is enabled.

set -euo pipefail

STACK_NAME="FlashcardsOpenSourceApp"
REGION="${AWS_REGION:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REGION" ]]; then
  echo "Usage: $0 --region <aws-region> [--stack-name <stack-name>]" >&2
  exit 1
fi

SCHEDULE_NAME="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='MultipartCompletionReconciliationScheduleName'].OutputValue" \
  --output text)"

if [[ -z "$SCHEDULE_NAME" || "$SCHEDULE_NAME" == "None" ]]; then
  echo "ERROR: MultipartCompletionReconciliationScheduleName output not found." >&2
  exit 1
fi

SCHEDULE_STATE="$(aws scheduler get-schedule \
  --name "$SCHEDULE_NAME" \
  --region "$REGION" \
  --query State \
  --output text)"

if [[ "$SCHEDULE_STATE" != "ENABLED" ]]; then
  echo "ERROR: Schedule ${SCHEDULE_NAME} is ${SCHEDULE_STATE}; expected ENABLED." >&2
  exit 1
fi

echo "Multipart completion reconciliation schedule is enabled: ${SCHEDULE_NAME}"
