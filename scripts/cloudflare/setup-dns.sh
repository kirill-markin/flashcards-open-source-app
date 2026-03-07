#!/usr/bin/env bash
# Configure Cloudflare DNS for API, auth, and web custom domains from stack outputs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/dns-utils.sh"

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

upsert_cname() {
  local record_name="$1"
  local record_label="$2"
  local target="$3"

  if [[ -z "$target" || "$target" == "None" ]]; then
    return
  fi

  local existing
  existing=$(curl -sS "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&name=${record_name}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json")

  local record_id
  record_id=$(echo "$existing" | jq -r '.result[0].id // empty')

  if [[ -n "$record_id" ]]; then
    echo "Updating DNS record: ${record_name} -> ${target}"
    curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record_id}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"CNAME\",\"name\":\"${record_label}\",\"content\":\"${target}\",\"ttl\":1,\"proxied\":false}" \
      | jq .success
    return
  fi

  echo "Creating DNS record: ${record_name} -> ${target}"
  curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"${record_label}\",\"content\":\"${target}\",\"ttl\":1,\"proxied\":false}" \
    | jq .success
}

upsert_apex_redirect_record() {
  local record_name="$1"
  local target="$2"

  if [[ -z "$target" || "$target" == "None" ]]; then
    return
  fi

  local existing
  local managed_count
  local record_id
  local record_content
  local summary

  existing=$(cloudflare_fetch_name_records "$record_name")
  managed_count=$(cloudflare_count_managed_name_records "$existing")
  record_id=$(cloudflare_find_cname_record_id "$existing")
  record_content=$(cloudflare_find_cname_record_content "$existing")
  summary=$(cloudflare_managed_name_summary "$existing")

  if [[ "$managed_count" == "0" ]]; then
    echo "Creating DNS record: ${record_name} -> ${target}"
    curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"CNAME\",\"name\":\"${record_name}\",\"content\":\"${target}\",\"ttl\":1,\"proxied\":false}" \
      | jq .success
    return
  fi

  if [[ -n "$record_id" && "$managed_count" == "1" && "$record_content" == "${target%.}" ]]; then
    echo "Updating DNS record: ${record_name} -> ${target}"
    curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record_id}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"CNAME\",\"name\":\"${record_name}\",\"content\":\"${target}\",\"ttl\":1,\"proxied\":false}" \
      | jq .success
    return
  fi

  echo "Skipping apex redirect DNS for ${record_name}: apex is already in use (${summary})."
}

API_TARGET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiCustomDomainTarget'].OutputValue" \
  --output text)

WEB_TARGET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='WebCustomDomainTarget'].OutputValue" \
  --output text)

AUTH_TARGET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='AuthCustomDomainTarget'].OutputValue" \
  --output text)

APEX_REDIRECT_TARGET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ApexRedirectCustomDomainTarget'].OutputValue" \
  --output text)

if [[ -z "$API_TARGET" || "$API_TARGET" == "None" ]]; then
  echo "WARNING: ApiCustomDomainTarget output not found. Skipping api.${DOMAIN}."
fi

if [[ -z "$WEB_TARGET" || "$WEB_TARGET" == "None" ]]; then
  echo "WARNING: WebCustomDomainTarget output not found. Skipping app.${DOMAIN}."
fi

if [[ -z "$AUTH_TARGET" || "$AUTH_TARGET" == "None" ]]; then
  echo "WARNING: AuthCustomDomainTarget output not found. Skipping auth.${DOMAIN}."
fi

if [[ -z "$APEX_REDIRECT_TARGET" || "$APEX_REDIRECT_TARGET" == "None" ]]; then
  echo "INFO: ApexRedirectCustomDomainTarget output not found. Skipping apex redirect DNS."
fi

upsert_cname "api.${DOMAIN}" "api" "$API_TARGET"
upsert_cname "auth.${DOMAIN}" "auth" "$AUTH_TARGET"
upsert_cname "app.${DOMAIN}" "app" "$WEB_TARGET"
upsert_apex_redirect_record "${DOMAIN}" "$APEX_REDIRECT_TARGET"

echo "Done: https://api.${DOMAIN}/v1"
