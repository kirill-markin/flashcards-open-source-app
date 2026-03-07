#!/usr/bin/env bash
# End-to-end first deploy helper for a new environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTEXT_FILE="${ROOT_DIR}/infra/aws/cdk.context.local.json"
STACK_NAME="FlashcardsOpenSourceApp"
REGION=""
DOMAIN=""
ALERT_EMAIL=""
GITHUB_REPO=""
SETUP_GITHUB="true"
SETUP_DNS="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --alert-email) ALERT_EMAIL="$2"; shift 2 ;;
    --github-repo) GITHUB_REPO="$2"; shift 2 ;;
    --context-file) CONTEXT_FILE="$2"; shift 2 ;;
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --skip-github) SETUP_GITHUB="false"; shift 1 ;;
    --skip-dns) SETUP_DNS="false"; shift 1 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$REGION" || -z "$DOMAIN" || -z "$ALERT_EMAIL" ]]; then
  echo "Usage: $0 --region <aws-region> --domain <domain> --alert-email <email> [--github-repo <owner/repo>]" >&2
  exit 1
fi

if [[ -z "$GITHUB_REPO" ]]; then
  GITHUB_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
fi

python3 - "$CONTEXT_FILE" "$REGION" "$DOMAIN" "$ALERT_EMAIL" "$GITHUB_REPO" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
context = {}
if path.exists():
    context = json.loads(path.read_text())
context["region"] = sys.argv[2]
context["domainName"] = sys.argv[3]
context["alertEmail"] = sys.argv[4]
context["githubRepo"] = sys.argv[5]
path.write_text(json.dumps(context, indent=2) + "\n")
PY

OIDC_PROVIDER_ARN=$(AWS_PROFILE="${AWS_PROFILE:-}" aws iam list-open-id-connect-providers \
  --output text --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]" 2>/dev/null || true)

if [[ -n "$OIDC_PROVIDER_ARN" && "$OIDC_PROVIDER_ARN" != "None" ]]; then
  python3 - "$CONTEXT_FILE" "$OIDC_PROVIDER_ARN" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
context = json.loads(path.read_text())
context["githubOidcProviderArn"] = sys.argv[2]
path.write_text(json.dumps(context, indent=2) + "\n")
PY
fi

if [[ -z "$(python3 - "$CONTEXT_FILE" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    print(json.load(fh).get("apiCertificateArn", ""))
PY
)" ]]; then
  bash "${ROOT_DIR}/scripts/cloudflare/setup-api-domain.sh" \
    --domain "$DOMAIN" \
    --region "$REGION" \
    --context-file "$CONTEXT_FILE"
fi

if [[ -z "$(python3 - "$CONTEXT_FILE" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    print(json.load(fh).get("authCertificateArn", ""))
PY
)" ]]; then
  bash "${ROOT_DIR}/scripts/cloudflare/setup-auth-domain.sh" \
    --domain "$DOMAIN" \
    --region "$REGION" \
    --context-file "$CONTEXT_FILE"
fi

if [[ -z "$(python3 - "$CONTEXT_FILE" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    print(json.load(fh).get("webCertificateArnUsEast1", ""))
PY
)" ]]; then
  bash "${ROOT_DIR}/scripts/cloudflare/setup-web-domain.sh" \
    --domain "$DOMAIN" \
    --context-file "$CONTEXT_FILE"
fi

bash "${ROOT_DIR}/scripts/bootstrap.sh" --region "$REGION" --stack-name "$STACK_NAME"

if [[ "$SETUP_DNS" == "true" ]]; then
  bash "${ROOT_DIR}/scripts/cloudflare/setup-dns.sh" --stack-name "$STACK_NAME" --domain "$DOMAIN"
  bash "${ROOT_DIR}/scripts/check-public-endpoints.sh" --stack-name "$STACK_NAME"
fi

if [[ "$SETUP_GITHUB" == "true" ]]; then
  bash "${ROOT_DIR}/scripts/setup-github.sh" --context-file "$CONTEXT_FILE" --stack-name "$STACK_NAME" --repo "$GITHUB_REPO"
fi

echo "First deploy finished."
