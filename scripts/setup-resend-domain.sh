#!/usr/bin/env bash
# Create or reuse a Resend sending domain, sync its DNS records to Cloudflare,
# and verify the domain through the Resend API.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_ENV_FILE="${ROOT_DIR}/.env"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/cloudflare/dns-utils.sh"

if [[ -f "$ROOT_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_ENV_FILE"
  set +a
fi

DOMAIN=""
SUBDOMAIN="mail"
RESEND_REGION="eu-west-1"
DRY_RUN="false"
RESEND_API_BASE="https://api.resend.com"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --subdomain) SUBDOMAIN="$2"; shift 2 ;;
    --region) RESEND_REGION="$2"; shift 2 ;;
    --dry-run) DRY_RUN="true"; shift 1 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$DOMAIN" ]]; then
  echo "ERROR: --domain is required." >&2
  exit 1
fi

if [[ -z "${RESEND_ADMIN_API_KEY:-}" ]]; then
  echo "ERROR: RESEND_ADMIN_API_KEY must be set." >&2
  exit 1
fi

ensure_cloudflare_env

FULL_DOMAIN="${SUBDOMAIN}.${DOMAIN}"

resend_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  if [[ "$DRY_RUN" == "true" && "$method" != "GET" ]]; then
    echo "{\"dryRun\":true,\"method\":\"${method}\",\"path\":\"${path}\"}"
    return
  fi

  local curl_args=(
    -sS
    -X "$method"
    "${RESEND_API_BASE}${path}"
    -H "Authorization: Bearer ${RESEND_ADMIN_API_KEY}"
    -H "Content-Type: application/json"
  )

  if [[ -n "$body" ]]; then
    curl_args+=(--data "$body")
  fi

  curl "${curl_args[@]}"
}

resolve_full_record_name() {
  local record_name="$1"
  python3 - "$record_name" "$FULL_DOMAIN" <<'PY'
import sys

record_name = sys.argv[1].rstrip(".")
full_domain = sys.argv[2].rstrip(".")

record_labels = [label for label in record_name.split(".") if label]
domain_labels = [label for label in full_domain.split(".") if label]

max_overlap = min(len(record_labels), len(domain_labels))
overlap = 0
for candidate in range(max_overlap, 0, -1):
    if record_labels[-candidate:] == domain_labels[:candidate]:
        overlap = candidate
        break

merged = record_labels + domain_labels[overlap:]
print(".".join(merged))
PY
}

get_domain_id() {
  local list_response

  list_response=$(resend_request "GET" "/domains")
  python3 - "$list_response" "$FULL_DOMAIN" <<'PY'
import json
import sys

response = json.loads(sys.argv[1])
target_name = sys.argv[2]
for item in response.get("data", []):
    if item.get("name") == target_name:
        print(item.get("id", ""))
        break
PY
}

create_domain() {
  local payload

  payload=$(python3 - "$FULL_DOMAIN" "$RESEND_REGION" <<'PY'
import json
import sys

print(json.dumps({
    "name": sys.argv[1],
    "region": sys.argv[2],
    "capabilities": {
        "sending": "enabled",
        "receiving": "disabled",
    },
}))
PY
)

  resend_request "POST" "/domains" "$payload"
}

get_domain() {
  local domain_id="$1"
  resend_request "GET" "/domains/${domain_id}"
}

verify_domain() {
  local domain_id="$1"
  resend_request "POST" "/domains/${domain_id}/verify"
}

upsert_record() {
  local type="$1"
  local fqdn="$2"
  local content="$3"
  local priority="${4:-}"
  local response
  local record_id

  response=$(curl -sS "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=${type}&name=${fqdn}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json")
  record_id=$(python3 - "$response" <<'PY'
import json
import sys

data = json.loads(sys.argv[1]).get("result", [])
print(data[0]["id"] if data else "")
PY
)

  local payload
  payload=$(python3 - "$type" "$fqdn" "$content" "$priority" <<'PY'
import json
import sys

record_type, name, content, priority = sys.argv[1:5]
payload = {
    "type": record_type,
    "name": name,
    "content": content.rstrip("."),
    "ttl": 1,
}
if record_type == "MX":
    payload["priority"] = int(priority)
print(json.dumps(payload))
PY
)

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "DRY RUN upsert ${type} ${fqdn} -> ${content}"
    return
  fi

  if [[ -n "$record_id" ]]; then
    curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${record_id}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$payload" >/dev/null
    echo "Updated DNS record: ${fqdn} (${type})"
    return
  fi

  curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$payload" >/dev/null
  echo "Created DNS record: ${fqdn} (${type})"
}

apply_domain_records() {
  local domain_json="$1"

  python3 - "$domain_json" <<'PY' | while IFS=$'\t' read -r type name content priority; do
import json
import sys

domain = json.loads(sys.argv[1])
for record in domain.get("records", []):
    priority = record.get("priority")
    print(
        f"{record.get('type', '')}\t{record.get('name', '')}\t{record.get('value', '')}\t"
        f"{'' if priority is None else priority}"
    )
PY
    if [[ -z "$type" || -z "$name" || -z "$content" ]]; then
      continue
    fi

    local fqdn
    fqdn=$(resolve_full_record_name "$name")
    upsert_record "$type" "$fqdn" "$content" "$priority"
  done
}

DOMAIN_ID=$(get_domain_id)

if [[ -z "$DOMAIN_ID" ]]; then
  CREATE_RESPONSE=$(create_domain)
  DOMAIN_ID=$(python3 - "$CREATE_RESPONSE" <<'PY'
import json
import sys

response = json.loads(sys.argv[1])
print(response.get("id", ""))
PY
)

  if [[ -z "$DOMAIN_ID" ]]; then
    echo "ERROR: Failed to create Resend domain for ${FULL_DOMAIN}." >&2
    echo "$CREATE_RESPONSE" >&2
    exit 1
  fi
fi

DOMAIN_RESPONSE=$(get_domain "$DOMAIN_ID")
apply_domain_records "$DOMAIN_RESPONSE"

VERIFY_RESPONSE=$(verify_domain "$DOMAIN_ID")
if [[ "$DRY_RUN" == "true" ]]; then
  echo "$VERIFY_RESPONSE"
  exit 0
fi

DOMAIN_STATUS="unknown"
for _ in 1 2 3 4 5; do
  sleep 5
  DOMAIN_RESPONSE=$(get_domain "$DOMAIN_ID")
  DOMAIN_STATUS=$(python3 - "$DOMAIN_RESPONSE" <<'PY'
import json
import sys

response = json.loads(sys.argv[1])
print(response.get("status", "unknown"))
PY
)

  if [[ "$DOMAIN_STATUS" == "verified" ]]; then
    echo "Verified Resend domain: ${FULL_DOMAIN}"
    exit 0
  fi
done

echo "Resend domain status for ${FULL_DOMAIN}: ${DOMAIN_STATUS}"
echo "DNS records are configured. Verification may complete after propagation."
