#!/usr/bin/env bash
# First-time AWS deployment: bootstrap CDK and deploy all infrastructure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CDK_DIR="${ROOT_DIR}/infra/aws"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/root-env.sh"
load_root_env

REGION="${AWS_REGION:-}"
STACK_NAME="FlashcardsOpenSourceApp"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REGION" ]]; then
  echo "Usage: $0 --region <aws-region>" >&2
  exit 1
fi

echo "=== Install dependencies ==="
npm ci --silent --prefix "${ROOT_DIR}/api"
npm ci --silent --prefix "${ROOT_DIR}/apps/backend"
npm ci --silent --prefix "${ROOT_DIR}/apps/admin"
npm ci --silent --prefix "${ROOT_DIR}/apps/web"
npm ci --silent --prefix "$CDK_DIR"

echo "=== Bundle OpenAPI spec ==="
npm run bundle --silent --prefix "${ROOT_DIR}/api"

echo "=== Configure required Resend secret ==="
bash "${ROOT_DIR}/scripts/setup-resend-secret.sh" --region "$REGION"

echo "=== Configure optional AI secrets ==="
bash "${ROOT_DIR}/scripts/setup-ai-secrets.sh" --region "$REGION"

if [[ -n "${DEMO_PASSWORD_DOSTIP:-}" ]]; then
  echo "=== Configure optional demo auth secret ==="
  bash "${ROOT_DIR}/scripts/setup-auth-secrets.sh" --region "$REGION"
fi

echo "=== Generate CDK context ==="
bash "${ROOT_DIR}/scripts/generate-cdk-context.sh" \
  --output "${CDK_DIR}/cdk.context.local.json" \
  --region "$REGION"

echo "=== CDK bootstrap ==="
cd "$CDK_DIR"
npx cdk bootstrap --region "$REGION"

echo "=== CDK deploy ==="
npx cdk deploy --all --require-approval never

echo "=== Run database migrations ==="
bash "${ROOT_DIR}/scripts/migrate-aws.sh" --stack-name "$STACK_NAME"

echo "=== Seed global metrics snapshot ==="
bash "${ROOT_DIR}/scripts/generate-global-metrics-snapshot.sh" --stack-name "$STACK_NAME"

echo "=== Check API health ==="
bash "${ROOT_DIR}/scripts/check-api-health.sh" --stack-name "$STACK_NAME"

echo "=== Build and deploy web ==="
npm run build --silent --prefix "${ROOT_DIR}/apps/web"
bash "${ROOT_DIR}/scripts/deploy-web.sh" --stack-name "$STACK_NAME"

echo "=== Build and deploy admin ==="
npm run build --silent --prefix "${ROOT_DIR}/apps/admin"
bash "${ROOT_DIR}/scripts/deploy-admin.sh" --stack-name "$STACK_NAME"

echo ""
echo "=== Bootstrap complete ==="
echo "Next steps:"
echo "  1. Configure DNS: bash scripts/cloudflare/setup-dns.sh --stack-name ${STACK_NAME}"
echo "  2. Configure GitHub Actions secrets/vars: bash scripts/setup-github.sh --stack-name ${STACK_NAME}"
