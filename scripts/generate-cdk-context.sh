#!/usr/bin/env bash
# Generate a transient CDK context file from root .env and AWS discovery.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_FILE="${ROOT_DIR}/infra/aws/cdk.context.local.json"
REGION_OVERRIDE=""
DOMAIN_OVERRIDE=""
ALERT_EMAIL_OVERRIDE=""
GITHUB_REPO_OVERRIDE=""

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/deploy-config.sh"
load_root_env

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT_FILE="$2"; shift 2 ;;
    --region) REGION_OVERRIDE="$2"; shift 2 ;;
    --domain) DOMAIN_OVERRIDE="$2"; shift 2 ;;
    --alert-email) ALERT_EMAIL_OVERRIDE="$2"; shift 2 ;;
    --github-repo) GITHUB_REPO_OVERRIDE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

REGION="$(require_non_empty_value "${REGION_OVERRIDE:-${AWS_REGION:-}}" "Set AWS_REGION in root .env or pass --region.")"
DOMAIN_NAME="$(require_non_empty_value "${DOMAIN_OVERRIDE:-${DOMAIN_NAME:-}}" "Set DOMAIN_NAME in root .env or pass --domain.")"
ALERT_EMAIL="$(require_non_empty_value "${ALERT_EMAIL_OVERRIDE:-${ALERT_EMAIL:-}}" "Set ALERT_EMAIL in root .env or pass --alert-email.")"
GITHUB_REPO="$(require_non_empty_value "${GITHUB_REPO_OVERRIDE:-${GITHUB_REPO:-}}" "Set GITHUB_REPO in root .env or pass --github-repo.")"

API_CERTIFICATE_ARN="$(find_certificate_arn "${REGION}" "api.${DOMAIN_NAME}" "api-domain")"
AUTH_CERTIFICATE_ARN="$(find_certificate_arn "${REGION}" "auth.${DOMAIN_NAME}" "auth-domain")"
WEB_CERTIFICATE_ARN="$(find_certificate_arn "us-east-1" "app.${DOMAIN_NAME}" "web-domain")"
APEX_REDIRECT_CERTIFICATE_ARN="$(find_certificate_arn "us-east-1" "${DOMAIN_NAME}" "apex-redirect-domain")"

OPENAI_SECRET_ARN="$(find_secret_arn "${REGION}" "flashcards-open-source-app/openai-api-key")"
LANGFUSE_PUBLIC_KEY_SECRET_ARN="$(find_secret_arn "${REGION}" "flashcards-open-source-app/langfuse-public-key")"
LANGFUSE_SECRET_KEY_SECRET_ARN="$(find_secret_arn "${REGION}" "flashcards-open-source-app/langfuse-secret-key")"
RESEND_SECRET_ARN="$(find_secret_arn "${REGION}" "flashcards-open-source-app/resend-api-key")"
DEMO_PASSWORD_SECRET_ARN="$(find_secret_arn "${REGION}" "flashcards-open-source-app/demo-password-dostip")"
RESEND_SENDER_EMAIL=""
if [[ -n "${RESEND_SECRET_ARN}" ]]; then
  RESEND_SENDER_EMAIL="$(build_resend_sender_email "${DOMAIN_NAME}")"
fi

GITHUB_OIDC_PROVIDER_ARN="$(discover_github_oidc_provider_arn)"

export REGION
export DOMAIN_NAME
export ALERT_EMAIL
export GITHUB_REPO
export API_CERTIFICATE_ARN
export AUTH_CERTIFICATE_ARN
export WEB_CERTIFICATE_ARN
export APEX_REDIRECT_CERTIFICATE_ARN
export GITHUB_OIDC_PROVIDER_ARN
export OPENAI_SECRET_ARN
export LANGFUSE_PUBLIC_KEY_SECRET_ARN
export LANGFUSE_SECRET_KEY_SECRET_ARN
export RESEND_SECRET_ARN
export RESEND_SENDER_EMAIL
export DEMO_PASSWORD_SECRET_ARN

python3 - "${OUTPUT_FILE}" <<'PY'
import json
import pathlib
import os
import sys

path = pathlib.Path(sys.argv[1])
values = {
    "region": os.environ["REGION"],
    "domainName": os.environ["DOMAIN_NAME"],
    "alertEmail": os.environ["ALERT_EMAIL"],
    "githubRepo": os.environ["GITHUB_REPO"],
    "apiCertificateArn": os.environ.get("API_CERTIFICATE_ARN", ""),
    "authCertificateArn": os.environ.get("AUTH_CERTIFICATE_ARN", ""),
    "webCertificateArnUsEast1": os.environ.get("WEB_CERTIFICATE_ARN", ""),
    "apexRedirectCertificateArnUsEast1": os.environ.get("APEX_REDIRECT_CERTIFICATE_ARN", ""),
    "githubOidcProviderArn": os.environ.get("GITHUB_OIDC_PROVIDER_ARN", ""),
    "openAiApiKeySecretArn": os.environ.get("OPENAI_SECRET_ARN", ""),
    "langfusePublicKeySecretArn": os.environ.get("LANGFUSE_PUBLIC_KEY_SECRET_ARN", ""),
    "langfuseSecretKeySecretArn": os.environ.get("LANGFUSE_SECRET_KEY_SECRET_ARN", ""),
    "langfuseBaseUrl": os.environ.get("LANGFUSE_BASE_URL", ""),
    "resendApiKeySecretArn": os.environ.get("RESEND_SECRET_ARN", ""),
    "resendSenderEmail": os.environ.get("RESEND_SENDER_EMAIL", ""),
    "demoEmailDostip": os.environ.get("DEMO_EMAIL_DOSTIP", ""),
    "demoPasswordSecretArn": os.environ.get("DEMO_PASSWORD_SECRET_ARN", ""),
    "guestAiWeightedMonthlyTokenCap": os.environ.get("GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP", ""),
}
data = {key: value for key, value in values.items() if value}
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY

echo "Generated ${OUTPUT_FILE}."
