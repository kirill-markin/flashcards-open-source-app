#!/usr/bin/env bash
# Check public custom-domain endpoints for backend, auth, and web hosting.

set -euo pipefail

STACK_NAME="FlashcardsOpenSourceApp"
MAX_ATTEMPTS=30
SLEEP_SECONDS=5

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --max-attempts) MAX_ATTEMPTS="$2"; shift 2 ;;
    --sleep-seconds) SLEEP_SECONDS="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

get_stack_output() {
  local output_key="$1"

  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text
}

get_stack_parameter() {
  local parameter_key="$1"

  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Parameters[?ParameterKey=='${parameter_key}'].ParameterValue" \
    --output text
}

get_url_host() {
  local url="$1"

  python3 - "$url" <<'PY'
import sys
from urllib.parse import urlparse

print(urlparse(sys.argv[1]).hostname or "")
PY
}

resolve_host_ipv4() {
  local host="$1"

  dig +short "$host" | awk '/^[0-9.]+$/ { print; exit }'
}

curl_with_dns_resolution() {
  local url="$1"
  local response_file="$2"
  local host
  local resolved_ip

  host=$(get_url_host "$url")
  if [[ -z "$host" ]]; then
    echo "ERROR: Failed to parse hostname from URL: ${url}" >&2
    return 1
  fi

  resolved_ip=$(resolve_host_ipv4 "$host")
  if [[ -z "$resolved_ip" ]]; then
    echo "DNS not ready for ${host}" >&2
    return 2
  fi

  curl -sS --resolve "${host}:443:${resolved_ip}" -o "$response_file" -w "%{http_code}" "$url"
}

curl_with_dns_resolution_and_headers() {
  local url="$1"
  local response_file="$2"
  local headers_file="$3"
  local host
  local resolved_ip

  host=$(get_url_host "$url")
  if [[ -z "$host" ]]; then
    echo "ERROR: Failed to parse hostname from URL: ${url}" >&2
    return 1
  fi

  resolved_ip=$(resolve_host_ipv4 "$host")
  if [[ -z "$resolved_ip" ]]; then
    echo "DNS not ready for ${host}" >&2
    return 2
  fi

  curl -sS --resolve "${host}:443:${resolved_ip}" -D "$headers_file" -o "$response_file" -w "%{http_code}" "$url"
}

check_url() {
  local url="$1"
  local expected_status="$2"
  local description="$3"
  local response_file
  local http_status
  local attempt

  response_file=$(mktemp)
  trap 'rm -f "$response_file"' RETURN

  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
    http_status=$(curl_with_dns_resolution "$url" "$response_file" || true)
    if [[ "$http_status" == "$expected_status" ]]; then
      echo "Public endpoint check passed: ${description} (${url})"
      cat "$response_file"
      echo ""
      return 0
    fi

    echo "Public endpoint check attempt ${attempt}/${MAX_ATTEMPTS} failed for ${description}: status ${http_status}, url ${url}" >&2
    if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
      sleep "$SLEEP_SECONDS"
    fi
  done

  echo "ERROR: Public endpoint check failed for ${description}: expected ${expected_status}, url ${url}" >&2
  cat "$response_file" >&2 || true
  return 1
}

check_url_not_ok() {
  local url="$1"
  local description="$2"
  local response_file
  local http_status

  response_file=$(mktemp)
  trap 'rm -f "$response_file"' RETURN

  http_status=$(curl_with_dns_resolution "$url" "$response_file" || true)
  if [[ "$http_status" == "200" ]]; then
    echo "ERROR: ${description} unexpectedly returned 200: ${url}" >&2
    cat "$response_file" >&2 || true
    return 1
  fi

  echo "Public endpoint absence check passed: ${description} (${url}) returned ${http_status}"
}

check_redirect_url() {
  local url="$1"
  local expected_status="$2"
  local expected_location="$3"
  local description="$4"
  local response_file
  local headers_file
  local http_status
  local attempt
  local location

  response_file=$(mktemp)
  headers_file=$(mktemp)
  trap 'rm -f "$response_file" "$headers_file"' RETURN

  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
    http_status=$(curl_with_dns_resolution_and_headers "$url" "$response_file" "$headers_file" || true)
    location=$(awk 'BEGIN { IGNORECASE=1 } /^Location:/ { sub(/\r$/, "", $2); print $2; exit }' "$headers_file")

    if [[ "$http_status" == "$expected_status" && "$location" == "$expected_location" ]]; then
      echo "Public redirect check passed: ${description} (${url}) -> ${location}"
      return 0
    fi

    echo "Public redirect check attempt ${attempt}/${MAX_ATTEMPTS} failed for ${description}: status ${http_status}, location ${location}, url ${url}" >&2
    if [[ "$attempt" -lt "$MAX_ATTEMPTS" ]]; then
      sleep "$SLEEP_SECONDS"
    fi
  done

  echo "ERROR: Public redirect check failed for ${description}: expected ${expected_status} + ${expected_location}, url ${url}" >&2
  cat "$headers_file" >&2 || true
  return 1
}

API_PUBLIC_BASE=$(get_stack_output "ApiPublicBase")
AUTH_PUBLIC_BASE=$(get_stack_output "AuthPublicBase")
WEB_PUBLIC_BASE=$(get_stack_output "WebPublicBase")
APEX_REDIRECT_TARGET=$(get_stack_output "ApexRedirectCustomDomainTarget")
BASE_DOMAIN=$(get_stack_parameter "domainName")

if [[ -z "$API_PUBLIC_BASE" || "$API_PUBLIC_BASE" == "None" ]]; then
  echo "ERROR: ApiPublicBase output not found. Deploy the CDK stack first." >&2
  exit 1
fi

if [[ -z "$WEB_PUBLIC_BASE" || "$WEB_PUBLIC_BASE" == "None" ]]; then
  echo "ERROR: WebPublicBase output not found. Deploy the CDK stack first." >&2
  exit 1
fi

if [[ -z "$AUTH_PUBLIC_BASE" || "$AUTH_PUBLIC_BASE" == "None" ]]; then
  echo "ERROR: AuthPublicBase output not found. Deploy the CDK stack first." >&2
  exit 1
fi

check_url "${API_PUBLIC_BASE}/health" "200" "public API health"
check_url "${AUTH_PUBLIC_BASE}/health" "200" "public auth health"
check_url "${WEB_PUBLIC_BASE}" "200" "public web root"
check_url "${API_PUBLIC_BASE}/auth/health" "404" "legacy public auth tombstone"

if [[ -n "$APEX_REDIRECT_TARGET" && "$APEX_REDIRECT_TARGET" != "None" && -n "$BASE_DOMAIN" && "$BASE_DOMAIN" != "None" ]]; then
  check_redirect_url "https://${BASE_DOMAIN}" "308" "https://app.${BASE_DOMAIN}/" "public apex redirect"
fi
