#!/usr/bin/env bash
# First-time AWS deployment: bootstrap CDK and deploy all infrastructure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CDK_DIR="${ROOT_DIR}/infra/aws"

REGION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REGION" ]]; then
  echo "Usage: $0 --region <aws-region>" >&2
  exit 1
fi

if [[ ! -f "${CDK_DIR}/cdk.context.local.json" ]]; then
  echo "ERROR: ${CDK_DIR}/cdk.context.local.json not found." >&2
  echo "Copy cdk.context.local.example.json and fill values first." >&2
  exit 1
fi

echo "=== Install dependencies ==="
npm ci --silent --prefix "${ROOT_DIR}/apps/backend"
npm ci --silent --prefix "$CDK_DIR"

echo "=== CDK bootstrap ==="
cd "$CDK_DIR"
npx cdk bootstrap --region "$REGION"

echo "=== CDK deploy ==="
npx cdk deploy --all --require-approval never

echo ""
echo "=== Bootstrap complete ==="
echo "Next steps:"
echo "  1. Configure DNS: bash scripts/cloudflare/setup-dns.sh --stack-name FlashcardsOpenSourceApp"
echo "  2. Configure GitHub Actions secrets/vars"
echo "  3. Run DB migrations against target database"
