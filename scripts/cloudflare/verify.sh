#!/usr/bin/env bash
# Verify API/auth/web DNS setup in Cloudflare.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-env.sh"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ZONE_ID:-}" ]]; then
  echo "ERROR: Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID" >&2
  exit 1
fi

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <domain>" >&2
  exit 1
fi

check_record() {
  local fqdn="$1"
  local response
  local count

  response=$(curl -sS "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&name=${fqdn}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json")

  count=$(echo "$response" | jq '.result | length')
  if [[ "$count" -eq 0 ]]; then
    echo "FAIL: no CNAME for ${fqdn}" >&2
    exit 1
  fi

  echo "OK: CNAME exists for ${fqdn}"
  echo "$response" | jq '.result[0] | {name, content, proxied, ttl}'
}

check_record "api.${DOMAIN}"
check_record "auth.${DOMAIN}"
check_record "app.${DOMAIN}"
