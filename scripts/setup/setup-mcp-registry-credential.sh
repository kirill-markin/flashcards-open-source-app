#!/usr/bin/env bash
# Provision the MCP Registry DNS namespace credential and GitHub Actions secret.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../cloudflare/dns-utils.sh"

DOMAIN=""
REPO=""
SECRET_NAME="MCP_PRIVATE_KEY"

usage() {
  echo "Usage: bash scripts/setup/setup-mcp-registry-credential.sh --domain <domain> --repo <owner/name>" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$DOMAIN" ]]; then
  DOMAIN="${DOMAIN_NAME:-}"
fi

if [[ -z "$REPO" ]]; then
  REPO="${GITHUB_REPO:-}"
fi

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "ERROR: ${command_name} is required." >&2
    exit 1
  fi
}

require_command curl
require_command gh
require_command openssl
require_command python3
require_command base64

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

if [[ -z "$DOMAIN" || -z "$REPO" ]]; then
  usage
  exit 1
fi

ensure_cloudflare_env

fetch_github_secrets() {
  gh secret list --repo "$REPO" --json name
}

github_secret_exists() {
  local secrets_json="$1"

  python3 - "$secrets_json" "$SECRET_NAME" <<'PY'
import json
import sys

secrets = json.loads(sys.argv[1])
secret_name = sys.argv[2]
for secret in secrets:
    if secret.get("name") == secret_name:
        sys.exit(0)
sys.exit(1)
PY
}

fetch_domain_txt_records() {
  curl -fsS -G \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data-urlencode "type=TXT" \
    --data-urlencode "name=${DOMAIN}" \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records"
}

count_mcp_registry_txt_records() {
  local records_json="$1"

  python3 - "$records_json" <<'PY'
import json
import sys

records = json.loads(sys.argv[1]).get("result", [])
count = sum(
    1
    for record in records
    if str(record.get("content", "")).startswith("v=MCPv1; k=ed25519; p=")
)
print(count)
PY
}

assert_cloudflare_success() {
  local response_json="$1"
  local action_name="$2"

  python3 - "$response_json" "$action_name" <<'PY'
import json
import sys

response = json.loads(sys.argv[1])
action_name = sys.argv[2]
if response.get("success") is True:
    sys.exit(0)

errors = response.get("errors", [])
print(f"ERROR: Cloudflare {action_name} failed: {json.dumps(errors)}", file=sys.stderr)
sys.exit(1)
PY
}

create_mcp_registry_txt_record() {
  local public_key="$1"
  local content="v=MCPv1; k=ed25519; p=${public_key}"
  local payload
  local response

  payload=$(python3 - "$DOMAIN" "$content" <<'PY'
import json
import sys

print(json.dumps({
    "type": "TXT",
    "name": sys.argv[1],
    "content": sys.argv[2],
    "ttl": 120,
}))
PY
)

  response=$(curl -fsS -X POST \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$payload" \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records")
  assert_cloudflare_success "$response" "TXT record creation"
}

GITHUB_SECRETS_JSON="$(fetch_github_secrets)"
TXT_RECORDS_JSON="$(fetch_domain_txt_records)"
MCP_TXT_COUNT="$(count_mcp_registry_txt_records "$TXT_RECORDS_JSON")"

if [[ "$MCP_TXT_COUNT" -gt 1 ]]; then
  echo "ERROR: Found ${MCP_TXT_COUNT} MCP Registry TXT records for ${DOMAIN}." >&2
  echo "Keep exactly one matching TXT record before rerunning this script." >&2
  exit 1
fi

if github_secret_exists "$GITHUB_SECRETS_JSON"; then
  GITHUB_SECRET_EXISTS="true"
else
  GITHUB_SECRET_EXISTS="false"
fi

if [[ "$MCP_TXT_COUNT" != "0" && "$GITHUB_SECRET_EXISTS" == "true" ]]; then
  echo "MCP Registry credential is already configured for ${DOMAIN} and ${REPO}."
  echo "To publish now, run:"
  echo "  gh workflow run mcp-registry-publish.yml --repo ${REPO} --ref main"
  exit 0
fi

if [[ "$MCP_TXT_COUNT" != "0" && "$GITHUB_SECRET_EXISTS" == "false" ]]; then
  echo "ERROR: Found MCP Registry TXT record for ${DOMAIN}, but ${SECRET_NAME} is missing in ${REPO}." >&2
  echo "Recover the original private key and set ${SECRET_NAME}, or remove the stale TXT record before rerunning this script." >&2
  exit 1
fi

if [[ "$MCP_TXT_COUNT" == "0" && "$GITHUB_SECRET_EXISTS" == "true" ]]; then
  echo "ERROR: Found ${SECRET_NAME} in ${REPO}, but no MCP Registry TXT record for ${DOMAIN}." >&2
  echo "Recover the matching public key and create the TXT record, or remove the stale GitHub secret before rerunning this script." >&2
  exit 1
fi

KEY_DIR="$(mktemp -d)"
KEY_FILE="${KEY_DIR}/mcp-registry-ed25519.pem"

cleanup() {
  rm -rf "$KEY_DIR"
}
trap cleanup EXIT

umask 077
openssl genpkey -algorithm Ed25519 -out "$KEY_FILE" >/dev/null 2>&1

PUBLIC_KEY="$(openssl pkey -in "$KEY_FILE" -pubout -outform DER 2>/dev/null | tail -c 32 | base64)"
PRIVATE_KEY="$(openssl pkey -in "$KEY_FILE" -noout -text 2>/dev/null | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"

if [[ "${#PRIVATE_KEY}" -ne 64 ]]; then
  echo "ERROR: Failed to derive a 64-character Ed25519 private key for ${SECRET_NAME}." >&2
  exit 1
fi

create_mcp_registry_txt_record "$PUBLIC_KEY"
printf '%s' "$PRIVATE_KEY" | gh secret set "$SECRET_NAME" --repo "$REPO" >/dev/null

echo "Created MCP Registry TXT record for ${DOMAIN}."
echo "Stored ${SECRET_NAME} GitHub Actions secret in ${REPO}."
echo "The private key was not printed and was removed from local temporary storage."
echo "To publish now, run:"
echo "  gh workflow run mcp-registry-publish.yml --repo ${REPO} --ref main"
