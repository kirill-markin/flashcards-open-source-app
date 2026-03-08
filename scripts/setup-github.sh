#!/usr/bin/env bash
# Configure GitHub Actions vars and secrets for this repository.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTEXT_FILE="${ROOT_DIR}/infra/aws/cdk.context.local.json"
STACK_NAME="FlashcardsOpenSourceApp"
REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --context-file) CONTEXT_FILE="$2"; shift 2 ;;
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$CONTEXT_FILE" ]]; then
  echo "ERROR: Context file not found: $CONTEXT_FILE" >&2
  exit 1
fi

if [[ -z "$REPO" ]]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
fi

read_context() {
  python3 - "$CONTEXT_FILE" "$1" <<'PY'
import json
import sys

path = sys.argv[1]
key = sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)
value = data.get(key, "")
print("" if value is None else value)
PY
}

has_variable() {
  local variable_name="$1"

  gh variable list --repo "$REPO" --json name --jq ".[] | select(.name == \"${variable_name}\") | .name" | grep -qx "$variable_name"
}

set_or_delete_variable() {
  local variable_name="$1"
  local variable_value="$2"

  if [[ -n "$variable_value" ]]; then
    gh variable set "$variable_name" --body "$variable_value" --repo "$REPO"
    return
  fi

  if has_variable "$variable_name"; then
    gh variable delete "$variable_name" --repo "$REPO"
  fi
}

get_output() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text
}

REGION=$(read_context region)
DOMAIN_NAME=$(read_context domainName)
ALERT_EMAIL=$(read_context alertEmail)
GITHUB_REPO=$(read_context githubRepo)
API_CERT_ARN=$(read_context apiCertificateArn)
AUTH_CERT_ARN=$(read_context authCertificateArn)
WEB_CERT_ARN=$(read_context webCertificateArnUsEast1)
OPENAI_SECRET_ARN=$(read_context openAiApiKeySecretArn)
ANTHROPIC_SECRET_ARN=$(read_context anthropicApiKeySecretArn)
DEPLOY_ROLE_ARN=$(get_output GithubDeployRoleArn)

if [[ -z "$REGION" || -z "$DOMAIN_NAME" || -z "$ALERT_EMAIL" || -z "$GITHUB_REPO" ]]; then
  echo "ERROR: Context file must contain region, domainName, alertEmail, and githubRepo." >&2
  exit 1
fi

if [[ -z "$DEPLOY_ROLE_ARN" || "$DEPLOY_ROLE_ARN" == "None" ]]; then
  echo "ERROR: GithubDeployRoleArn output not found. Deploy the stack first." >&2
  exit 1
fi

gh variable set AWS_REGION --body "$REGION" --repo "$REPO"
gh variable set CDK_DOMAIN_NAME --body "$DOMAIN_NAME" --repo "$REPO"
gh variable set CDK_ALERT_EMAIL --body "$ALERT_EMAIL" --repo "$REPO"
gh variable set CDK_GITHUB_REPO --body "$GITHUB_REPO" --repo "$REPO"
set_or_delete_variable CDK_OPENAI_API_KEY_SECRET_ARN "$OPENAI_SECRET_ARN"
set_or_delete_variable CDK_ANTHROPIC_API_KEY_SECRET_ARN "$ANTHROPIC_SECRET_ARN"

gh secret set AWS_DEPLOY_ROLE_ARN --body "$DEPLOY_ROLE_ARN" --repo "$REPO"

if [[ -n "$API_CERT_ARN" ]]; then
  gh secret set CDK_API_CERTIFICATE_ARN --body "$API_CERT_ARN" --repo "$REPO"
fi

if [[ -n "$AUTH_CERT_ARN" ]]; then
  gh secret set CDK_AUTH_CERTIFICATE_ARN --body "$AUTH_CERT_ARN" --repo "$REPO"
fi

if [[ -n "$WEB_CERT_ARN" ]]; then
  gh secret set CDK_WEB_CERTIFICATE_ARN_US_EAST_1 --body "$WEB_CERT_ARN" --repo "$REPO"
fi

echo "GitHub Actions variables and secrets configured for ${REPO}."
