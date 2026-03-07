#!/usr/bin/env bash
# Upload apps/web/dist to the provisioned S3 bucket and invalidate CloudFront.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
STACK_NAME="FlashcardsOpenSourceApp"
DIST_DIR="apps/web/dist"

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
  echo "ERROR: Build output not found at $RESOLVED_DIST_DIR. Run npm run build --prefix apps/web first." >&2
  exit 1
fi

WEB_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue" \
  --output text)

WEB_DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='WebDistributionId'].OutputValue" \
  --output text)

WEB_PUBLIC_BASE=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='WebPublicBase'].OutputValue" \
  --output text)

if [[ -z "$WEB_BUCKET" || "$WEB_BUCKET" == "None" ]]; then
  echo "ERROR: WebBucketName output not found. Deploy the CDK stack first." >&2
  exit 1
fi

if [[ -z "$WEB_DISTRIBUTION_ID" || "$WEB_DISTRIBUTION_ID" == "None" ]]; then
  echo "ERROR: WebDistributionId output not found. Deploy the CDK stack first." >&2
  exit 1
fi

aws s3 sync "$RESOLVED_DIST_DIR" "s3://${WEB_BUCKET}" --delete
aws cloudfront create-invalidation --distribution-id "$WEB_DISTRIBUTION_ID" --paths "/*" >/dev/null

echo "Web app deployed: ${WEB_PUBLIC_BASE}"
