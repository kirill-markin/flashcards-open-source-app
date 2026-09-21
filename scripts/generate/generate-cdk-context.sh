#!/usr/bin/env bash
# Generate a transient CDK context file from root .env and AWS discovery.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUTPUT_FILE="${ROOT_DIR}/infra/aws/cdk.context.local.json"
REGION_OVERRIDE=""
DOMAIN_OVERRIDE=""
ALERT_EMAIL_OVERRIDE=""
GITHUB_REPO_OVERRIDE=""
SENTRY_DSN_SECRET_NAME="flashcards-open-source-app/sentry-dsn"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/deploy-config.sh"
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

validate_sentry_traces_sample_rate() {
  local value="$1"

  python3 - "$value" <<'PY'
import math
import sys

value = sys.argv[1]

try:
    traces_sample_rate = float(value)
except ValueError:
    print("ERROR: Set SENTRY_TRACES_SAMPLE_RATE to a number between 0 and 1.", file=sys.stderr)
    sys.exit(1)

if not math.isfinite(traces_sample_rate) or traces_sample_rate < 0 or traces_sample_rate > 1:
    print("ERROR: Set SENTRY_TRACES_SAMPLE_RATE to a number between 0 and 1.", file=sys.stderr)
    sys.exit(1)
PY
}

API_CERTIFICATE_ARN="$(find_certificate_arn "${REGION}" "api.${DOMAIN_NAME}" "api-domain")"
AUTH_CERTIFICATE_ARN="$(find_certificate_arn "${REGION}" "auth.${DOMAIN_NAME}" "auth-domain")"
MCP_CERTIFICATE_ARN="$(find_certificate_arn "${REGION}" "mcp.${DOMAIN_NAME}" "mcp-domain")"
# Optional second public host for the API and the auth API, on a domain that
# cannot be derived from DOMAIN_NAME. Set API_ALTERNATE_DOMAIN_NAME or
# AUTH_ALTERNATE_DOMAIN_NAME in root .env to enable one; each certificate is
# discovered in the stack region unless it is set explicitly.
API_ALTERNATE_DOMAIN_NAME="${API_ALTERNATE_DOMAIN_NAME:-}"
API_ALTERNATE_CERTIFICATE_ARN="${API_ALTERNATE_CERTIFICATE_ARN:-}"
if [[ -n "${API_ALTERNATE_DOMAIN_NAME}" && -z "${API_ALTERNATE_CERTIFICATE_ARN}" ]]; then
  API_ALTERNATE_CERTIFICATE_ARN="$(find_certificate_arn "${REGION}" "${API_ALTERNATE_DOMAIN_NAME}" "api-alternate-domain")"
fi
AUTH_ALTERNATE_DOMAIN_NAME="${AUTH_ALTERNATE_DOMAIN_NAME:-}"
AUTH_ALTERNATE_CERTIFICATE_ARN="${AUTH_ALTERNATE_CERTIFICATE_ARN:-}"
if [[ -n "${AUTH_ALTERNATE_DOMAIN_NAME}" && -z "${AUTH_ALTERNATE_CERTIFICATE_ARN}" ]]; then
  AUTH_ALTERNATE_CERTIFICATE_ARN="$(find_certificate_arn "${REGION}" "${AUTH_ALTERNATE_DOMAIN_NAME}" "auth-alternate-domain")"
fi
# Liveness of each extra host, flipped only once its DNS record exists. Empty
# until then, so the deploy that creates a host never probes it.
API_ALTERNATE_HOST_LIVE="${API_ALTERNATE_HOST_LIVE:-}"
AUTH_ALTERNATE_HOST_LIVE="${AUTH_ALTERNATE_HOST_LIVE:-}"
# The deployed browser cookie domain, unset unless it has to differ from
# DOMAIN_NAME. Deliberately not COOKIE_DOMAIN: that name in root .env belongs to
# the locally running backend.
CDK_COOKIE_DOMAIN="${CDK_COOKIE_DOMAIN:-}"
# Optional second MCP host on an unrelated domain, so it cannot be derived from
# DOMAIN_NAME. Set MCP_ALTERNATE_DOMAIN_NAME in root .env to enable it; the
# certificate is discovered in the stack region unless it is set explicitly.
MCP_ALTERNATE_DOMAIN_NAME="${MCP_ALTERNATE_DOMAIN_NAME:-}"
MCP_ALTERNATE_CERTIFICATE_ARN="${MCP_ALTERNATE_CERTIFICATE_ARN:-}"
# Separate switch, flipped only once the alternate host's DNS record exists, so
# the liveness heartbeat starts policing the host after it can answer.
MCP_ALTERNATE_HOST_LIVE="${MCP_ALTERNATE_HOST_LIVE:-}"
if [[ -n "${MCP_ALTERNATE_DOMAIN_NAME}" && -z "${MCP_ALTERNATE_CERTIFICATE_ARN}" ]]; then
  MCP_ALTERNATE_CERTIFICATE_ARN="$(find_certificate_arn "${REGION}" "${MCP_ALTERNATE_DOMAIN_NAME}" "mcp-alternate-domain")"
fi
WEB_CERTIFICATE_ARN="$(find_certificate_arn "us-east-1" "app.${DOMAIN_NAME}" "web-domain")"
ADMIN_CERTIFICATE_ARN="$(find_certificate_arn "us-east-1" "admin.${DOMAIN_NAME}" "admin-domain")"
# Optional second host for the web and admin CloudFront distributions, on a
# domain unrelated to DOMAIN_NAME. Neither value is discoverable: the host cannot
# be derived from DOMAIN_NAME, and the certificate is a multi-SAN one that covers
# the primary host as well, so it is not found by searching for the extra host.
# Set both values of a pair in root .env to enable one.
WEB_ADDITIONAL_DOMAIN_NAME="${WEB_ADDITIONAL_DOMAIN_NAME:-}"
WEB_ADDITIONAL_CERTIFICATE_ARN="${WEB_ADDITIONAL_CERTIFICATE_ARN:-}"
WEB_PRIMARY_HOST_RETIRED="${WEB_PRIMARY_HOST_RETIRED:-}"
ADMIN_ADDITIONAL_DOMAIN_NAME="${ADMIN_ADDITIONAL_DOMAIN_NAME:-}"
ADMIN_ADDITIONAL_CERTIFICATE_ARN="${ADMIN_ADDITIONAL_CERTIFICATE_ARN:-}"
APEX_REDIRECT_CERTIFICATE_ARN="$(find_certificate_arn "us-east-1" "${DOMAIN_NAME}" "apex-redirect-domain")"

OPENAI_SECRET_ARN="$(find_secret_arn "${REGION}" "flashcards-open-source-app/openai-api-key")"
LANGFUSE_PUBLIC_KEY_SECRET_ARN="$(find_secret_arn "${REGION}" "flashcards-open-source-app/langfuse-public-key")"
LANGFUSE_SECRET_KEY_SECRET_ARN="$(find_secret_arn "${REGION}" "flashcards-open-source-app/langfuse-secret-key")"
RESEND_SECRET_ARN="$(find_secret_arn "${REGION}" "flashcards-open-source-app/resend-api-key")"
DEMO_PASSWORD_SECRET_ARN="$(find_secret_arn "${REGION}" "flashcards-open-source-app/demo-password-dostip")"
SENTRY_DSN_SECRET_ARN="${SENTRY_DSN_SECRET_ARN:-$(find_secret_arn "${REGION}" "${SENTRY_DSN_SECRET_NAME}")}"
SENTRY_ENVIRONMENT="$(require_non_empty_value "${SENTRY_ENVIRONMENT:-}" "Set SENTRY_ENVIRONMENT in root .env before generating a deploy CDK context.")"
SENTRY_RELEASE="$(require_non_empty_value "${SENTRY_RELEASE:-}" "Set SENTRY_RELEASE in root .env before generating a deploy CDK context.")"
SENTRY_TRACES_SAMPLE_RATE="$(require_non_empty_value "${SENTRY_TRACES_SAMPLE_RATE:-}" "Set SENTRY_TRACES_SAMPLE_RATE in root .env before generating a deploy CDK context.")"
require_non_empty_value "${SENTRY_DSN_SECRET_ARN}" "Set SENTRY_DSN_SECRET_ARN in root .env or create the AWS secret ${SENTRY_DSN_SECRET_NAME} before generating a deploy CDK context." >/dev/null
validate_sentry_traces_sample_rate "${SENTRY_TRACES_SAMPLE_RATE}"
ANALYTICS_ACCESS_ENABLED="${ANALYTICS_ACCESS_ENABLED:-}"
ADMIN_EMAILS="${ADMIN_EMAILS:-}"
GLOBAL_METRICS_VISIBLE="${GLOBAL_METRICS_VISIBLE:-}"
if [[ -n "${ANALYTICS_ACCESS_ENABLED}" && "${ANALYTICS_ACCESS_ENABLED}" != "true" && "${ANALYTICS_ACCESS_ENABLED}" != "false" ]]; then
  echo "ERROR: Set ANALYTICS_ACCESS_ENABLED in root .env to true or false, or leave it unset to keep the analytical bastion." >&2
  exit 1
fi
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
export MCP_CERTIFICATE_ARN
export MCP_ALTERNATE_DOMAIN_NAME
export MCP_ALTERNATE_CERTIFICATE_ARN
export MCP_ALTERNATE_HOST_LIVE
export API_ALTERNATE_DOMAIN_NAME
export API_ALTERNATE_CERTIFICATE_ARN
export AUTH_ALTERNATE_DOMAIN_NAME
export AUTH_ALTERNATE_CERTIFICATE_ARN
export API_ALTERNATE_HOST_LIVE
export AUTH_ALTERNATE_HOST_LIVE
export CDK_COOKIE_DOMAIN
export WEB_CERTIFICATE_ARN
export WEB_ADDITIONAL_DOMAIN_NAME
export WEB_ADDITIONAL_CERTIFICATE_ARN
export WEB_PRIMARY_HOST_RETIRED
export ADMIN_CERTIFICATE_ARN
export ADMIN_ADDITIONAL_DOMAIN_NAME
export ADMIN_ADDITIONAL_CERTIFICATE_ARN
export APEX_REDIRECT_CERTIFICATE_ARN
export GITHUB_OIDC_PROVIDER_ARN
export OPENAI_SECRET_ARN
export LANGFUSE_PUBLIC_KEY_SECRET_ARN
export LANGFUSE_SECRET_KEY_SECRET_ARN
export RESEND_SECRET_ARN
export RESEND_SENDER_EMAIL
export DEMO_PASSWORD_SECRET_ARN
export SENTRY_DSN_SECRET_ARN
export SENTRY_ENVIRONMENT
export SENTRY_RELEASE
export SENTRY_TRACES_SAMPLE_RATE
export ANALYTICS_ACCESS_ENABLED
export ADMIN_EMAILS
export GLOBAL_METRICS_VISIBLE

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
    "mcpCertificateArn": os.environ.get("MCP_CERTIFICATE_ARN", ""),
    "mcpAlternateDomainName": os.environ.get("MCP_ALTERNATE_DOMAIN_NAME", ""),
    "mcpAlternateCertificateArn": os.environ.get("MCP_ALTERNATE_CERTIFICATE_ARN", ""),
    "mcpAlternateHostLive": os.environ.get("MCP_ALTERNATE_HOST_LIVE", ""),
    "apiAlternateDomainName": os.environ.get("API_ALTERNATE_DOMAIN_NAME", ""),
    "apiAlternateCertificateArn": os.environ.get("API_ALTERNATE_CERTIFICATE_ARN", ""),
    "authAlternateDomainName": os.environ.get("AUTH_ALTERNATE_DOMAIN_NAME", ""),
    "authAlternateCertificateArn": os.environ.get("AUTH_ALTERNATE_CERTIFICATE_ARN", ""),
    "apiAlternateHostLive": os.environ.get("API_ALTERNATE_HOST_LIVE", ""),
    "authAlternateHostLive": os.environ.get("AUTH_ALTERNATE_HOST_LIVE", ""),
    "cookieDomain": os.environ.get("CDK_COOKIE_DOMAIN", ""),
    "webCertificateArnUsEast1": os.environ.get("WEB_CERTIFICATE_ARN", ""),
    "webAdditionalDomainName": os.environ.get("WEB_ADDITIONAL_DOMAIN_NAME", ""),
    "webAdditionalCertificateArnUsEast1": os.environ.get("WEB_ADDITIONAL_CERTIFICATE_ARN", ""),
    "webPrimaryHostRetired": os.environ.get("WEB_PRIMARY_HOST_RETIRED", ""),
    "adminCertificateArnUsEast1": os.environ.get("ADMIN_CERTIFICATE_ARN", ""),
    "adminAdditionalDomainName": os.environ.get("ADMIN_ADDITIONAL_DOMAIN_NAME", ""),
    "adminAdditionalCertificateArnUsEast1": os.environ.get("ADMIN_ADDITIONAL_CERTIFICATE_ARN", ""),
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
    "sentryDsnSecretArn": os.environ.get("SENTRY_DSN_SECRET_ARN", ""),
    "sentryEnvironment": os.environ.get("SENTRY_ENVIRONMENT", ""),
    "sentryRelease": os.environ.get("SENTRY_RELEASE", ""),
    "sentryTracesSampleRate": os.environ.get("SENTRY_TRACES_SAMPLE_RATE", ""),
    "guestAiWeightedMonthlyTokenCap": os.environ.get("GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP", ""),
    "adminEmails": os.environ.get("ADMIN_EMAILS", ""),
    "analyticsAccessEnabled": os.environ.get("ANALYTICS_ACCESS_ENABLED", ""),
    "globalMetricsVisible": os.environ.get("GLOBAL_METRICS_VISIBLE", ""),
}
data = {key: value for key, value in values.items() if value}
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY

echo "Generated ${OUTPUT_FILE}."
