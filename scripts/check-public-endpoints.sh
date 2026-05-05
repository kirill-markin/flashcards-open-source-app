#!/usr/bin/env bash
# Check public custom-domain endpoints for backend, auth, web, and optional admin hosting.

set -euo pipefail

STACK_NAME="FlashcardsOpenSourceApp"
MAX_ATTEMPTS=30
SLEEP_SECONDS=5
SKIP_STATIC_SITES="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack-name) STACK_NAME="$2"; shift 2 ;;
    --max-attempts) MAX_ATTEMPTS="$2"; shift 2 ;;
    --sleep-seconds) SLEEP_SECONDS="$2"; shift 2 ;;
    --skip-static-sites) SKIP_STATIC_SITES="true"; shift 1 ;;
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

get_header_value() {
  local headers_file="$1"
  local header_name="$2"

  python3 - "$headers_file" "$header_name" <<'PY'
import sys

headers_path = sys.argv[1]
header_name = sys.argv[2].lower()

with open(headers_path, "r", encoding="utf-8", errors="replace") as handle:
    for raw_line in handle:
        line = raw_line.rstrip("\r\n")
        if ":" not in line:
            continue
        name, value = line.split(":", 1)
        if name.lower() == header_name:
            print(value.strip())
            break
PY
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

check_api_json_endpoint() {
  local url="$1"
  local origin="$2"
  local description="$3"
  local response_file
  local headers_file
  local http_status
  local content_type
  local allow_origin
  local allow_credentials
  local request_id

  response_file=$(mktemp)
  headers_file=$(mktemp)
  trap 'rm -f "$response_file" "$headers_file"' RETURN

  http_status=$(curl -sS -D "$headers_file" -o "$response_file" \
    -H "Origin: ${origin}" \
    "$url" \
    -w "%{http_code}")

  content_type=$(get_header_value "$headers_file" "content-type")
  allow_origin=$(get_header_value "$headers_file" "access-control-allow-origin")
  allow_credentials=$(get_header_value "$headers_file" "access-control-allow-credentials")
  request_id=$(get_header_value "$headers_file" "x-request-id")

  if [[ "$http_status" != "200" && "$http_status" != "401" ]]; then
    echo "ERROR: ${description} returned unexpected status ${http_status}: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ "$content_type" != application/json* ]]; then
    echo "ERROR: ${description} did not return JSON content: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ "$allow_origin" != "$origin" ]]; then
    echo "ERROR: ${description} did not return the expected CORS origin header: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ -z "$request_id" ]]; then
    echo "ERROR: ${description} did not return X-Request-Id: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if grep -qi 'MissingAuthenticationToken' "$response_file"; then
    echo "ERROR: ${description} still points at an API Gateway tombstone route: ${url}" >&2
    cat "$response_file" >&2 || true
    return 1
  fi

  echo "Public API route check passed: ${description} (${url}) returned ${http_status}"
}

check_api_preflight() {
  local url="$1"
  local origin="$2"
  local method="$3"
  local request_headers="$4"
  local description="$5"
  local response_file
  local headers_file
  local http_status
  local allow_origin

  response_file=$(mktemp)
  headers_file=$(mktemp)
  trap 'rm -f "$response_file" "$headers_file"' RETURN

  http_status=$(curl -sS -D "$headers_file" -o "$response_file" \
    -X OPTIONS \
    -H "Origin: ${origin}" \
    -H "Access-Control-Request-Method: ${method}" \
    -H "Access-Control-Request-Headers: ${request_headers}" \
    "$url" \
    -w "%{http_code}")

  allow_origin=$(get_header_value "$headers_file" "access-control-allow-origin")

  if [[ "$http_status" != "200" && "$http_status" != "204" ]]; then
    echo "ERROR: ${description} preflight returned unexpected status ${http_status}: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ "$allow_origin" != "$origin" ]]; then
    echo "ERROR: ${description} preflight did not return the expected CORS origin header: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if grep -qi 'MissingAuthenticationToken' "$response_file"; then
    echo "ERROR: ${description} preflight still points at an API Gateway tombstone route: ${url}" >&2
    cat "$response_file" >&2 || true
    return 1
  fi

  echo "Public API preflight check passed: ${description} (${url}) returned ${http_status}"
}

check_public_global_metrics_snapshot_preflight() {
  local url="$1"
  local origin="$2"
  local description="$3"
  local response_file
  local headers_file
  local http_status
  local allow_origin
  local allow_credentials
  local allow_methods

  response_file=$(mktemp)
  headers_file=$(mktemp)
  trap 'rm -f "$response_file" "$headers_file"' RETURN

  http_status=$(curl -sS -D "$headers_file" -o "$response_file" \
    -X OPTIONS \
    -H "Origin: ${origin}" \
    -H "Access-Control-Request-Method: GET" \
    "$url" \
    -w "%{http_code}")

  allow_origin=$(get_header_value "$headers_file" "access-control-allow-origin")
  allow_credentials=$(get_header_value "$headers_file" "access-control-allow-credentials")
  allow_methods=$(get_header_value "$headers_file" "access-control-allow-methods")

  if [[ "$http_status" != "200" && "$http_status" != "204" ]]; then
    echo "ERROR: ${description} preflight returned unexpected status ${http_status}: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ "$allow_origin" != "$origin" && "$allow_origin" != "*" ]]; then
    echo "ERROR: ${description} preflight did not return a public-safe CORS origin: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ -n "$allow_credentials" && "$allow_credentials" != "false" ]]; then
    echo "ERROR: ${description} preflight unexpectedly allows credentials: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ "$allow_methods" != *GET* ]]; then
    echo "ERROR: ${description} preflight does not advertise GET: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if grep -qi 'MissingAuthenticationToken' "$response_file"; then
    echo "ERROR: ${description} preflight still points at an API Gateway tombstone route: ${url}" >&2
    cat "$response_file" >&2 || true
    return 1
  fi

  echo "Public global metrics snapshot preflight check passed: ${description} (${url}) returned ${http_status}"
}

validate_global_metrics_snapshot_payload() {
  local response_file="$1"

  python3 - "$response_file" <<'PY'
import datetime
import json
import pathlib
import sys

response_path = pathlib.Path(sys.argv[1])
payload = json.loads(response_path.read_text())

required_top_level_keys = ["schemaVersion", "generatedAtUtc", "asOfUtc", "from", "to", "totals", "days"]
required_total_keys = ["uniqueReviewingUsers", "reviewEvents"]
required_review_event_keys = ["total", "byPlatform"]
expected_platform_keys = ["web", "android", "ios"]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"ERROR: {message}")


def require_non_negative_int(value: object, label: str) -> int:
    require(isinstance(value, int), f"{label} must be an integer, received {value!r}")
    require(value >= 0, f"{label} must be non-negative, received {value!r}")
    return value


def validate_platform_totals(node: object, label: str) -> dict[str, int]:
    require(isinstance(node, dict), f"{label} must be an object")
    require(all(platform in node for platform in expected_platform_keys), f"{label} must include {expected_platform_keys!r}")
    return {
        platform: require_non_negative_int(node[platform], f"{label}.{platform}")
        for platform in expected_platform_keys
    }


def validate_review_events(node: object, label: str) -> None:
    require(isinstance(node, dict), f"{label} must be an object")
    require(all(key in node for key in required_review_event_keys), f"{label} is missing one of {required_review_event_keys!r}")
    total = require_non_negative_int(node["total"], f"{label}.total")
    by_platform = validate_platform_totals(node["byPlatform"], f"{label}.byPlatform")
    require(total == sum(by_platform.values()), f"{label}.total must equal the sum of platform totals")


require(isinstance(payload, dict), "global metrics snapshot response must be a JSON object")
require(all(key in payload for key in required_top_level_keys), f"snapshot payload is missing one of {required_top_level_keys!r}")
require(payload["schemaVersion"] == 2, f"schemaVersion must be 2, received {payload['schemaVersion']!r}")
require(isinstance(payload["generatedAtUtc"], str), "generatedAtUtc must be a string")
generated_at = datetime.datetime.fromisoformat(payload["generatedAtUtc"].replace("Z", "+00:00"))
require(isinstance(payload["asOfUtc"], str), "asOfUtc must be a string")
as_of = datetime.datetime.fromisoformat(payload["asOfUtc"].replace("Z", "+00:00"))
require(as_of.hour == 0 and as_of.minute == 0 and as_of.second == 0 and as_of.microsecond == 0, "asOfUtc must be a UTC midnight boundary")
require(generated_at >= as_of, "generatedAtUtc must be greater than or equal to asOfUtc")
require(isinstance(payload["from"], str), "from must be a string")
from_date = datetime.date.fromisoformat(payload["from"])
require(isinstance(payload["to"], str), "to must be a string")
to_date = datetime.date.fromisoformat(payload["to"])
require(from_date <= to_date, "from must be less than or equal to to")
require(to_date == (as_of.date() - datetime.timedelta(days=1)), "to must be the UTC day immediately before asOfUtc")
expected_day_count = (to_date - from_date).days + 1

totals = payload["totals"]
require(isinstance(totals, dict), "totals must be an object")
require(all(key in totals for key in required_total_keys), f"totals is missing one of {required_total_keys!r}")
require_non_negative_int(totals["uniqueReviewingUsers"], "totals.uniqueReviewingUsers")
validate_review_events(totals["reviewEvents"], "totals.reviewEvents")

days = payload["days"]
require(isinstance(days, list), "days must be an array")
require(len(days) == expected_day_count, f"days must contain exactly {expected_day_count} entries")

seen_dates: set[str] = set()
previous_date: datetime.date | None = None
day_review_total = 0
day_review_web_total = 0
day_review_android_total = 0
day_review_ios_total = 0
required_day_keys = ["date", "uniqueReviewingUsers", "newReviewingUsers", "returningReviewingUsers", "reviewEvents"]
for index, entry in enumerate(days):
    label = f"days[{index}]"
    require(isinstance(entry, dict), f"{label} must be an object")
    require(all(key in entry for key in required_day_keys), f"{label} must contain {required_day_keys!r}")
    require(isinstance(entry["date"], str), f"{label}.date must be a string")
    current_date = datetime.date.fromisoformat(entry["date"])
    require(entry["date"] not in seen_dates, f"{label}.date must be unique")
    if previous_date is not None:
        require(previous_date <= current_date, "days must be ordered by ascending date")
    expected_date = from_date + datetime.timedelta(days=index)
    require(current_date == expected_date, f"{label}.date must equal {expected_date.isoformat()}")
    seen_dates.add(entry["date"])
    previous_date = current_date
    unique_count = require_non_negative_int(entry["uniqueReviewingUsers"], f"{label}.uniqueReviewingUsers")
    new_count = require_non_negative_int(entry["newReviewingUsers"], f"{label}.newReviewingUsers")
    returning_count = require_non_negative_int(entry["returningReviewingUsers"], f"{label}.returningReviewingUsers")
    require(unique_count == new_count + returning_count, f"{label}.uniqueReviewingUsers must equal newReviewingUsers + returningReviewingUsers")
    if index == 0:
        require(returning_count == 0, f"{label}.returningReviewingUsers must be 0 for the first day")
    validate_review_events(entry["reviewEvents"], f"{label}.reviewEvents")
    day_review_total += entry["reviewEvents"]["total"]
    day_review_web_total += entry["reviewEvents"]["byPlatform"]["web"]
    day_review_android_total += entry["reviewEvents"]["byPlatform"]["android"]
    day_review_ios_total += entry["reviewEvents"]["byPlatform"]["ios"]

require(day_review_total == totals["reviewEvents"]["total"], "totals.reviewEvents.total must equal the sum of day review events")
require(day_review_web_total == totals["reviewEvents"]["byPlatform"]["web"], "totals.reviewEvents.byPlatform.web must equal the sum of day web review events")
require(day_review_android_total == totals["reviewEvents"]["byPlatform"]["android"], "totals.reviewEvents.byPlatform.android must equal the sum of day android review events")
require(day_review_ios_total == totals["reviewEvents"]["byPlatform"]["ios"], "totals.reviewEvents.byPlatform.ios must equal the sum of day ios review events")
PY
}

validate_hidden_global_metrics_snapshot_payload() {
  local response_file="$1"

  python3 - "$response_file" <<'PY'
import json
import pathlib
import sys

response_path = pathlib.Path(sys.argv[1])
payload = json.loads(response_path.read_text())

if (
    not isinstance(payload, dict)
    or payload.get("error") != "Global metrics snapshot is not visible."
    or payload.get("code") != "GLOBAL_METRICS_NOT_VISIBLE"
    or not isinstance(payload.get("requestId"), str)
    or payload["requestId"] == ""
):
    raise SystemExit(f"ERROR: Unexpected hidden global metrics payload: {payload!r}")
PY
}

check_public_global_metrics_snapshot() {
  local url="$1"
  local origin="$2"
  local description="$3"
  local response_file
  local headers_file
  local http_status
  local content_type
  local allow_origin
  local allow_credentials
  local request_id

  response_file=$(mktemp)
  headers_file=$(mktemp)
  trap 'rm -f "$response_file" "$headers_file"' RETURN

  http_status=$(curl -sS -D "$headers_file" -o "$response_file" \
    -H "Origin: ${origin}" \
    "$url" \
    -w "%{http_code}")

  content_type=$(get_header_value "$headers_file" "content-type")
  allow_origin=$(get_header_value "$headers_file" "access-control-allow-origin")
  allow_credentials=$(get_header_value "$headers_file" "access-control-allow-credentials")
  request_id=$(get_header_value "$headers_file" "x-request-id")

  if [[ "$http_status" != "200" ]]; then
    echo "ERROR: ${description} returned unexpected status ${http_status}: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ "$content_type" != application/json* ]]; then
    echo "ERROR: ${description} did not return JSON content: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ "$allow_origin" != "$origin" && "$allow_origin" != "*" ]]; then
    echo "ERROR: ${description} did not return the expected CORS origin header: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ -n "$allow_credentials" && "$allow_credentials" != "false" ]]; then
    echo "ERROR: ${description} unexpectedly allows credentials: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ -z "$request_id" ]]; then
    echo "ERROR: ${description} did not return X-Request-Id: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if grep -qi 'MissingAuthenticationToken' "$response_file"; then
    echo "ERROR: ${description} still points at an API Gateway tombstone route: ${url}" >&2
    cat "$response_file" >&2 || true
    return 1
  fi

  validate_global_metrics_snapshot_payload "$response_file"
  echo "Public global metrics snapshot check passed: ${description} (${url})"
}

check_hidden_global_metrics_snapshot() {
  local url="$1"
  local origin="$2"
  local description="$3"
  local response_file
  local headers_file
  local http_status
  local content_type
  local allow_origin
  local allow_credentials
  local request_id

  response_file=$(mktemp)
  headers_file=$(mktemp)
  trap 'rm -f "$response_file" "$headers_file"' RETURN

  http_status=$(curl -sS -D "$headers_file" -o "$response_file" \
    -H "Origin: ${origin}" \
    "$url" \
    -w "%{http_code}")

  content_type=$(get_header_value "$headers_file" "content-type")
  allow_origin=$(get_header_value "$headers_file" "access-control-allow-origin")
  allow_credentials=$(get_header_value "$headers_file" "access-control-allow-credentials")
  request_id=$(get_header_value "$headers_file" "x-request-id")

  if [[ "$http_status" != "404" ]]; then
    echo "ERROR: ${description} returned unexpected status ${http_status}: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ "$content_type" != application/json* ]]; then
    echo "ERROR: ${description} did not return JSON content: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ "$allow_origin" != "$origin" && "$allow_origin" != "*" ]]; then
    echo "ERROR: ${description} did not return the expected CORS origin header: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ -n "$allow_credentials" && "$allow_credentials" != "false" ]]; then
    echo "ERROR: ${description} unexpectedly allows credentials: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ -z "$request_id" ]]; then
    echo "ERROR: ${description} did not return X-Request-Id: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if grep -qi 'MissingAuthenticationToken' "$response_file"; then
    echo "ERROR: ${description} unexpectedly behaves like a missing API Gateway route: ${url}" >&2
    cat "$response_file" >&2 || true
    return 1
  fi

  validate_hidden_global_metrics_snapshot_payload "$response_file"
  echo "Hidden global metrics snapshot check passed: ${description} (${url})"
}

check_api_route_absent() {
  local url="$1"
  local origin="$2"
  local description="$3"
  local response_file
  local headers_file
  local http_status
  local request_id

  response_file=$(mktemp)
  headers_file=$(mktemp)
  trap 'rm -f "$response_file" "$headers_file"' RETURN

  http_status=$(curl -sS -D "$headers_file" -o "$response_file" \
    -H "Origin: ${origin}" \
    "$url" \
    -w "%{http_code}")

  request_id=$(get_header_value "$headers_file" "x-request-id")

  if [[ "$http_status" == "200" ]]; then
    echo "ERROR: ${description} unexpectedly returned 200: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if [[ -n "$request_id" ]]; then
    echo "ERROR: ${description} unexpectedly reached the backend route handler: ${url}" >&2
    cat "$headers_file" >&2 || true
    cat "$response_file" >&2 || true
    return 1
  fi

  if grep -q 'GLOBAL_METRICS_NOT_VISIBLE' "$response_file"; then
    echo "ERROR: ${description} unexpectedly behaved like the live hidden endpoint: ${url}" >&2
    cat "$response_file" >&2 || true
    return 1
  fi

  echo "Public API route absence check passed: ${description} (${url}) returned ${http_status}"
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
GLOBAL_METRICS_VISIBLE=$(get_stack_output "GlobalMetricsVisible")
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

WORKSPACES_URL="${API_PUBLIC_BASE%/}/workspaces"
ME_URL="${API_PUBLIC_BASE%/}/me"
GLOBAL_SNAPSHOT_URL="${API_PUBLIC_BASE%/}/global/snapshot"
LEGACY_GLOBAL_SNAPSHOT_URL="${API_PUBLIC_BASE%/}/public/global/snapshot"

check_url "${API_PUBLIC_BASE}/health" "200" "public API health"
check_url "${AUTH_PUBLIC_BASE}/health" "200" "public auth health"
check_url "${API_PUBLIC_BASE}/auth/health" "404" "legacy public auth tombstone"
check_api_json_endpoint "$ME_URL" "$WEB_PUBLIC_BASE" "public API session endpoint"
check_api_json_endpoint "$WORKSPACES_URL" "$WEB_PUBLIC_BASE" "public API workspaces endpoint"
check_api_preflight "$WORKSPACES_URL" "$WEB_PUBLIC_BASE" "GET" "content-type" "public API workspaces endpoint"
check_public_global_metrics_snapshot_preflight "$GLOBAL_SNAPSHOT_URL" "$WEB_PUBLIC_BASE" "public global metrics snapshot endpoint"

if [[ "$GLOBAL_METRICS_VISIBLE" == "true" ]]; then
  check_public_global_metrics_snapshot \
    "$GLOBAL_SNAPSHOT_URL" \
    "$WEB_PUBLIC_BASE" \
    "public global metrics snapshot endpoint"
else
  check_hidden_global_metrics_snapshot \
    "$GLOBAL_SNAPSHOT_URL" \
    "$WEB_PUBLIC_BASE" \
    "hidden global metrics snapshot endpoint"
fi

check_api_route_absent "$LEGACY_GLOBAL_SNAPSHOT_URL" "$WEB_PUBLIC_BASE" "legacy public global metrics snapshot endpoint"

if [[ "$SKIP_STATIC_SITES" != "true" ]]; then
  check_url "${WEB_PUBLIC_BASE}" "200" "public web root"
  ADMIN_PUBLIC_BASE=$(get_stack_output "AdminPublicBase")

  if [[ -z "$ADMIN_PUBLIC_BASE" || "$ADMIN_PUBLIC_BASE" == "None" ]]; then
    echo "ERROR: AdminPublicBase output not found. The supported admin public URL must be configured before release." >&2
    exit 1
  else
    check_api_json_endpoint "$ME_URL" "$ADMIN_PUBLIC_BASE" "public API session endpoint from admin origin"
    check_api_preflight "$WORKSPACES_URL" "$ADMIN_PUBLIC_BASE" "GET" "content-type" "public API workspaces endpoint from admin origin"
    check_public_global_metrics_snapshot_preflight "$GLOBAL_SNAPSHOT_URL" "$ADMIN_PUBLIC_BASE" "public global metrics snapshot endpoint from admin origin"
    check_url "${ADMIN_PUBLIC_BASE}" "200" "public admin root"
  fi
fi

if [[ -n "$APEX_REDIRECT_TARGET" && "$APEX_REDIRECT_TARGET" != "None" && -n "$BASE_DOMAIN" && "$BASE_DOMAIN" != "None" ]]; then
  check_redirect_url "https://${BASE_DOMAIN}" "308" "https://app.${BASE_DOMAIN}/" "public apex redirect"
fi
