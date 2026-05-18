#!/usr/bin/env bash
# First-time AWS deployment: bootstrap CDK and deploy all infrastructure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CDK_DIR="${ROOT_DIR}/infra/aws"
TEMP_DIR="$(mktemp -d)"
SENTRY_DSN_SECRET_NAME="flashcards-open-source-app/sentry-dsn"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/deploy-config.sh"
load_root_env

REGION="${AWS_REGION:-}"
STACK_NAME="FlashcardsOpenSourceApp"

cleanup() {
  rm -rf "$TEMP_DIR"
}

trap cleanup EXIT

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

create_sentry_dsn_secret() {
  local secret_file=""

  require_non_empty_value "${SENTRY_DSN:-}" "Set SENTRY_DSN in root .env before bootstrap, or set SENTRY_DSN_SECRET_ARN to an existing Secrets Manager secret ARN." >/dev/null

  secret_file="$(mktemp "${TEMP_DIR}/sentry-dsn.XXXXXX")"
  chmod 600 "$secret_file"
  printf '%s' "${SENTRY_DSN}" > "$secret_file"

  aws secretsmanager create-secret \
    --name "$SENTRY_DSN_SECRET_NAME" \
    --description "Sentry DSN for flashcards-open-source-app backend AWS Lambda runtimes" \
    --secret-string "file://${secret_file}" \
    --region "$REGION" \
    --tags \
      "Key=${DEPLOY_CONFIG_PROJECT_TAG_KEY},Value=${DEPLOY_CONFIG_PROJECT_TAG_VALUE}" \
      "Key=${DEPLOY_CONFIG_PURPOSE_TAG_KEY},Value=sentry-dsn" \
    --query ARN \
    --output text
}

ensure_sentry_dsn_secret() {
  local existing_secret_arn=""

  if [[ -n "${SENTRY_DSN_SECRET_ARN:-}" ]]; then
    export SENTRY_DSN_SECRET_ARN
    echo "Using configured Sentry DSN secret ARN from SENTRY_DSN_SECRET_ARN."
    return
  fi

  existing_secret_arn="$(find_secret_arn "$REGION" "$SENTRY_DSN_SECRET_NAME")"
  if [[ -n "$existing_secret_arn" ]]; then
    export SENTRY_DSN_SECRET_ARN="$existing_secret_arn"
    echo "Using existing Sentry DSN secret in AWS Secrets Manager: ${SENTRY_DSN_SECRET_ARN}"
    return
  fi

  SENTRY_DSN_SECRET_ARN="$(create_sentry_dsn_secret)"
  export SENTRY_DSN_SECRET_ARN
  echo "Created Sentry DSN secret in AWS Secrets Manager: ${SENTRY_DSN_SECRET_ARN}"
}

get_bootstrap_sentry_release() {
  local git_sha=""

  git_sha="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null || true)"
  if [[ -n "$git_sha" ]]; then
    printf '%s\n' "$git_sha"
    return
  fi

  printf 'local/bootstrap\n'
}

ensure_bootstrap_sentry_context_defaults() {
  if [[ -z "${SENTRY_ENVIRONMENT:-}" ]]; then
    export SENTRY_ENVIRONMENT="production"
    echo "Using default SENTRY_ENVIRONMENT=production for bootstrap CDK context."
  fi

  if [[ -z "${SENTRY_RELEASE:-}" ]]; then
    SENTRY_RELEASE="$(get_bootstrap_sentry_release)"
    export SENTRY_RELEASE
    echo "Using default SENTRY_RELEASE=${SENTRY_RELEASE} for bootstrap CDK context."
  fi

  if [[ -z "${SENTRY_TRACES_SAMPLE_RATE:-}" ]]; then
    export SENTRY_TRACES_SAMPLE_RATE="0"
    echo "Using default SENTRY_TRACES_SAMPLE_RATE=0 for bootstrap CDK context."
  fi
}

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

echo "=== Configure required Sentry DSN secret ==="
ensure_sentry_dsn_secret
ensure_bootstrap_sentry_context_defaults

if [[ -n "${DEMO_PASSWORD_DOSTIP:-}" ]]; then
  echo "=== Configure optional review account auth secret ==="
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
