#!/usr/bin/env bash
# Configure Cloudflare DNS for API custom domain from stack outputs.

set -euo pipefail

STACK_NAME="FlashcardsOpenSourceApp"
DOMAIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ZONE_ID:-}" ]]; then
  echo "ERROR: Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID" >&2
  exit 1
fi

if [[ -z "$DOMAIN" ]]; then
  DOMAIN=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Parameters[?ParameterKey=='domainName'].ParameterValue" \
    --output text 2>/dev/null || true)
fi

if [[ -z "$DOMAIN" || "$DOMAIN" == "None" ]]; then
  echo "ERROR: Pass --domain explicitly (stack parameter lookup unavailable)." >&2
  exit 1
fi

API_TARGET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiCustomDomainTarget'].OutputValue" \
  --output text)

if [[ -z "$API_TARGET" || "$API_TARGET" == "None" ]]; then
  echo "ERROR: ApiCustomDomainTarget output not found. Ensure apiCertificateArn is configured and stack deployed." >&2
  exit 1
fi

SUBDOMAIN="api.${DOMAIN}"

EXISTING=$(curl -sS "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&name=${SUBDOMAIN}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json")

RECORD_ID=$(echo "$EXISTING" | jq -r '.result[0].id // empty')

if [[ -n "$RECORD_ID" ]]; then
  echo "Updating DNS record: ${SUBDOMAIN} -> ${API_TARGET}"
  curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${RECORD_ID}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"api\",\"content\":\"${API_TARGET}\",\"ttl\":1,\"proxied\":false}" \
    | jq .success
else
  echo "Creating DNS record: ${SUBDOMAIN} -> ${API_TARGET}"
  curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"api\",\"content\":\"${API_TARGET}\",\"ttl\":1,\"proxied\":false}" \
    | jq .success
fi

echo "Done: https://api.${DOMAIN}/v1"
