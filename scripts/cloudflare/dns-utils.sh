#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-env.sh"

ensure_cloudflare_env() {
  : "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN env var}"
  : "${CLOUDFLARE_ZONE_ID:?Set CLOUDFLARE_ZONE_ID env var}"
}

cloudflare_fetch_name_records() {
  local record_name="$1"

  ensure_cloudflare_env

  curl -sS "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${record_name}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json"
}

cloudflare_count_managed_name_records() {
  local records_json="$1"

  python3 - "$records_json" <<'PY'
import json
import sys

records = json.loads(sys.argv[1]).get("result", [])
count = sum(1 for record in records if record.get("type") in {"A", "AAAA", "CNAME"})
print(count)
PY
}

cloudflare_managed_name_summary() {
  local records_json="$1"

  python3 - "$records_json" <<'PY'
import json
import sys

records = json.loads(sys.argv[1]).get("result", [])
items = [
    f"{record.get('type')}:{record.get('name')}->{record.get('content')}"
    for record in records
    if record.get("type") in {"A", "AAAA", "CNAME"}
]
print(", ".join(items))
PY
}

cloudflare_find_cname_record_id() {
  local records_json="$1"

  python3 - "$records_json" <<'PY'
import json
import sys

records = json.loads(sys.argv[1]).get("result", [])
for record in records:
    if record.get("type") == "CNAME":
        print(record.get("id", ""))
        break
PY
}

cloudflare_find_cname_record_content() {
  local records_json="$1"

  python3 - "$records_json" <<'PY'
import json
import sys

records = json.loads(sys.argv[1]).get("result", [])
for record in records:
    if record.get("type") == "CNAME":
        print((record.get("content") or "").rstrip("."))
        break
PY
}
