#!/usr/bin/env bash
# Verify that both cleanup-capable reconciliation schedules are enabled.

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

check_schedule() {
  local output_key="$1"
  local schedule_name
  local schedule_state

  schedule_name="$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text)"

  if [[ -z "$schedule_name" || "$schedule_name" == "None" ]]; then
    echo "ERROR: ${output_key} output not found." >&2
    exit 1
  fi

  schedule_state="$(aws scheduler get-schedule \
    --name "$schedule_name" \
    --region "$REGION" \
    --query State \
    --output text)"

  if [[ "$schedule_state" != "ENABLED" ]]; then
    echo "ERROR: Schedule ${schedule_name} is ${schedule_state}; expected ENABLED." >&2
    exit 1
  fi

  echo "Reconciliation schedule is enabled: ${schedule_name}"
}

check_schedule "GeneratedMediaPromotionScheduleName"
check_schedule "MultipartCompletionReconciliationScheduleName"
