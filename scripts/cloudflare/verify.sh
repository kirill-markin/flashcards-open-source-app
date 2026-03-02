#!/usr/bin/env bash
# Verify API DNS setup in Cloudflare.

set -euo pipefail

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ZONE_ID:-}" ]]; then
  echo "ERROR: Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID" >&2
  exit 1
fi

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <domain>" >&2
  exit 1
fi

SUBDOMAIN="api.${DOMAIN}"
RESPONSE=$(curl -sS "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&name=${SUBDOMAIN}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json")

COUNT=$(echo "$RESPONSE" | jq '.result | length')
if [[ "$COUNT" -eq 0 ]]; then
  echo "FAIL: no CNAME for ${SUBDOMAIN}" >&2
  exit 1
fi

echo "OK: CNAME exists for ${SUBDOMAIN}"
echo "$RESPONSE" | jq '.result[0] | {name, content, proxied, ttl}'
