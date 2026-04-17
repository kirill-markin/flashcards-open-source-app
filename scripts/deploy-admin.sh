#!/usr/bin/env bash
# Upload apps/admin/dist to the provisioned S3 bucket and invalidate CloudFront.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
STACK_NAME="FlashcardsOpenSourceApp"
DIST_DIR="apps/admin/dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --dist-dir) DIST_DIR="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ "$DIST_DIR" = /* ]]; then
  RESOLVED_DIST_DIR="$DIST_DIR"
else
  RESOLVED_DIST_DIR="${ROOT_DIR}/${DIST_DIR}"
fi

if [[ ! -d "$RESOLVED_DIST_DIR" ]]; then
  echo "ERROR: Build output not found at $RESOLVED_DIST_DIR. Run npm run build --prefix apps/admin first." >&2
  exit 1
fi

ADMIN_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='AdminBucketName'].OutputValue" \
  --output text)

ADMIN_DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='AdminDistributionId'].OutputValue" \
  --output text)

BASE_DOMAIN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Parameters[?ParameterKey=='domainName'].ParameterValue" \
  --output text)

if [[ -z "$ADMIN_BUCKET" || "$ADMIN_BUCKET" == "None" ]]; then
  echo "ERROR: AdminBucketName output not found. Deploy the CDK stack first." >&2
  exit 1
fi

if [[ -z "$ADMIN_DISTRIBUTION_ID" || "$ADMIN_DISTRIBUTION_ID" == "None" ]]; then
  echo "ERROR: AdminDistributionId output not found. Deploy the CDK stack first." >&2
  exit 1
fi

aws s3 sync "$RESOLVED_DIST_DIR" "s3://${ADMIN_BUCKET}" --delete
aws cloudfront create-invalidation --distribution-id "$ADMIN_DISTRIBUTION_ID" --paths "/*" >/dev/null

if [[ -n "$BASE_DOMAIN" && "$BASE_DOMAIN" != "None" ]]; then
  echo "Admin assets deployed. Supported browser entrypoint: https://admin.${BASE_DOMAIN}"
else
  echo "Admin assets deployed."
fi
