#!/usr/bin/env bash
# Upload apps/web/dist to the provisioned S3 bucket and invalidate CloudFront.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
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

# Hashed assets are immutable, so browsers may cache them long-term. Old
# files are intentionally kept (no --delete): tabs and cached index.html from
# a previous deploy must keep resolving their chunks until they reload.
# Bucket growth is unbounded by design (a few MB per deploy); an age-based
# lifecycle rule would delete the live assets of a dormant deployment, so
# prune manually if size ever matters. The same applies to removed non-hashed
# files (favicons and similar): they stay served at their old paths until
# pruned manually.
aws s3 sync "${RESOLVED_DIST_DIR}/assets" "s3://${WEB_BUCKET}/assets" \
  --cache-control "public, max-age=31536000, immutable"

# Non-hashed files must always revalidate; cp (not sync) re-applies the
# cache-control metadata even when the file content did not change.
aws s3 cp --recursive "$RESOLVED_DIST_DIR" "s3://${WEB_BUCKET}" \
  --exclude "assets/*" \
  --exclude "index.html" \
  --cache-control "no-cache"

# index.html goes last so it never references assets that are not uploaded yet.
aws s3 cp "${RESOLVED_DIST_DIR}/index.html" "s3://${WEB_BUCKET}/index.html" \
  --cache-control "no-cache"

aws cloudfront create-invalidation --distribution-id "$WEB_DISTRIBUTION_ID" --paths "/*" >/dev/null

echo "Web app deployed: ${WEB_PUBLIC_BASE}"
