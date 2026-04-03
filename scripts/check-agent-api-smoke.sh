#!/usr/bin/env bash
# Check the external agent API contract against the deployed environment.

set -euo pipefail

AUTH_BASE_URL="${FLASHCARDS_AGENT_SMOKE_AUTH_BASE_URL:-https://auth.flashcards-open-source-app.com}"
API_BASE_URL="${FLASHCARDS_AGENT_SMOKE_API_BASE_URL:-https://api.flashcards-open-source-app.com/v1}"
DEMO_EMAIL="${FLASHCARDS_AGENT_SMOKE_DEMO_EMAIL:-google-review@example.com}"
WORKSPACE_PREFIX="${FLASHCARDS_AGENT_SMOKE_WORKSPACE_PREFIX:-E2E agent api }"
CONNECTION_LABEL_PREFIX="${FLASHCARDS_AGENT_SMOKE_CONNECTION_LABEL_PREFIX:-E2E agent api }"
RUN_ID="${FLASHCARDS_AGENT_SMOKE_RUN_ID:-$(date +%s)-$$}"

TMP_DIR="$(mktemp -d)"
LAST_BODY_FILE=""
LAST_HEADERS_FILE=""
LAST_STATUS=""
HUMAN_ID_TOKEN=""
AGENT_API_KEY=""
AGENT_CONNECTION_ID=""
WORKSPACE_ID=""

WORKSPACE_NAME="${WORKSPACE_PREFIX}${RUN_ID}"
CONNECTION_LABEL="${CONNECTION_LABEL_PREFIX}${RUN_ID}"
CARD_FRONT_TEXT="Agent smoke question ${RUN_ID}"
CARD_BACK_TEXT="Agent smoke answer ${RUN_ID}"
CARD_FRONT_TEXT_LOWER="$(printf '%s' "${CARD_FRONT_TEXT}" | tr '[:upper:]' '[:lower:]')"

request_json() {
  local method="$1"
  local url="$2"
  local body="$3"
  local auth_header="$4"
  local body_file
  local headers_file
  local status

  body_file="$(mktemp "${TMP_DIR}/body.XXXXXX.json")"
  headers_file="$(mktemp "${TMP_DIR}/headers.XXXXXX.txt")"

  if [[ -n "${body}" ]]; then
    if [[ -n "${auth_header}" ]]; then
      status="$(curl -sS -D "${headers_file}" -o "${body_file}" -X "${method}" -H "${auth_header}" -H "content-type: application/json" --data "${body}" "${url}" -w "%{http_code}")"
    else
      status="$(curl -sS -D "${headers_file}" -o "${body_file}" -X "${method}" -H "content-type: application/json" --data "${body}" "${url}" -w "%{http_code}")"
    fi
  else
    if [[ -n "${auth_header}" ]]; then
      status="$(curl -sS -D "${headers_file}" -o "${body_file}" -X "${method}" -H "${auth_header}" "${url}" -w "%{http_code}")"
    else
      status="$(curl -sS -D "${headers_file}" -o "${body_file}" -X "${method}" "${url}" -w "%{http_code}")"
    fi
  fi

  LAST_BODY_FILE="${body_file}"
  LAST_HEADERS_FILE="${headers_file}"
  LAST_STATUS="${status}"
}

assert_status() {
  local expected_status="$1"
  local description="$2"

  if [[ "${LAST_STATUS}" != "${expected_status}" ]]; then
    echo "ERROR: ${description} returned ${LAST_STATUS}, expected ${expected_status}" >&2
    cat "${LAST_HEADERS_FILE}" >&2 || true
    cat "${LAST_BODY_FILE}" >&2 || true
    exit 1
  fi
}

sign_in_demo_human() {
  if [[ -n "${HUMAN_ID_TOKEN}" ]]; then
    return 0
  fi

  request_json "POST" "${AUTH_BASE_URL%/}/api/send-code" "{\"email\":\"${DEMO_EMAIL}\"}" ""
  if [[ "${LAST_STATUS}" != "200" ]]; then
    echo "WARN: cleanup sign-in failed with status ${LAST_STATUS}" >&2
    cat "${LAST_BODY_FILE}" >&2 || true
    return 1
  fi

  HUMAN_ID_TOKEN="$(
    python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
id_token = payload.get("idToken")
if not isinstance(id_token, str) or id_token == "":
    raise SystemExit("cleanup sign-in did not return idToken")
print(id_token)
PY
  )"
}

cleanup() {
  set +e

  if ! sign_in_demo_human; then
    rm -rf "${TMP_DIR}"
    return
  fi

  if [[ -n "${AGENT_CONNECTION_ID}" ]]; then
    request_json "POST" "${API_BASE_URL%/}/agent-api-keys/${AGENT_CONNECTION_ID}/revoke" "" "authorization: Bearer ${HUMAN_ID_TOKEN}"
    if [[ "${LAST_STATUS}" != "200" ]]; then
      echo "WARN: failed to revoke agent connection ${AGENT_CONNECTION_ID}" >&2
      cat "${LAST_BODY_FILE}" >&2 || true
    fi
  fi

  if [[ -n "${WORKSPACE_ID}" ]]; then
    request_json "GET" "${API_BASE_URL%/}/workspaces/${WORKSPACE_ID}/delete-preview" "" "authorization: Bearer ${HUMAN_ID_TOKEN}"
    if [[ "${LAST_STATUS}" == "200" ]]; then
      local confirmation_text
      confirmation_text="$(
        python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
confirmation_text = payload.get("confirmationText")
if not isinstance(confirmation_text, str) or confirmation_text == "":
    raise SystemExit("delete preview did not return confirmationText")
print(confirmation_text)
PY
      )"
      request_json "POST" "${API_BASE_URL%/}/workspaces/${WORKSPACE_ID}/delete" "{\"confirmationText\":\"${confirmation_text}\"}" "authorization: Bearer ${HUMAN_ID_TOKEN}"
      if [[ "${LAST_STATUS}" != "200" ]]; then
        echo "WARN: failed to delete workspace ${WORKSPACE_ID}" >&2
        cat "${LAST_BODY_FILE}" >&2 || true
      fi
    else
      echo "WARN: failed to load delete preview for workspace ${WORKSPACE_ID}" >&2
      cat "${LAST_BODY_FILE}" >&2 || true
    fi
  fi

  rm -rf "${TMP_DIR}"
}

trap cleanup EXIT

request_json "GET" "${API_BASE_URL%/}/" "" ""
assert_status "200" "GET /v1/"
ROOT_DISCOVERY_BODY="${LAST_BODY_FILE}"
python3 - <<'PY' "${ROOT_DISCOVERY_BODY}" "${DEMO_EMAIL}" "${API_BASE_URL%/}" "${AUTH_BASE_URL%/}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
demo_email = sys.argv[2]
api_base_url = sys.argv[3]
auth_base_url = sys.argv[4]

assert payload["ok"] is True
assert payload["data"]["apiBaseUrl"] == api_base_url
assert payload["data"]["authBaseUrl"] == auth_base_url
assert payload["data"]["authentication"]["sendCodeUrl"] == f"{auth_base_url}/api/agent/send-code"
assert payload["data"]["authentication"]["verifyCodeUrl"] == f"{auth_base_url}/api/agent/verify-code"
assert payload["data"]["surface"]["accountUrl"] == f"{api_base_url}/agent/me"
assert payload["docs"]["openapiUrl"] == f"{api_base_url}/agent/openapi.json"
assert isinstance(payload["instructions"], str) and payload["instructions"] != ""
assert demo_email.endswith("@example.com")
PY

request_json "GET" "${API_BASE_URL%/}/agent" "" ""
assert_status "200" "GET /v1/agent"
AGENT_DISCOVERY_BODY="${LAST_BODY_FILE}"
python3 - <<'PY' "${ROOT_DISCOVERY_BODY}" "${AGENT_DISCOVERY_BODY}"
import json
import sys

root_payload = json.load(open(sys.argv[1], encoding="utf-8"))
agent_payload = json.load(open(sys.argv[2], encoding="utf-8"))
assert root_payload == agent_payload
PY

request_json "GET" "${API_BASE_URL%/}/agent/openapi.json" "" ""
assert_status "200" "GET /v1/agent/openapi.json"
CANONICAL_OPENAPI_BODY="${LAST_BODY_FILE}"
python3 - <<'PY' "${CANONICAL_OPENAPI_BODY}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
required_paths = {
    "/",
    "/agent",
    "/openapi.json",
    "/swagger.json",
    "/agent/openapi.json",
    "/agent/swagger.json",
    "/api/agent/send-code",
    "/api/agent/verify-code",
    "/agent/me",
    "/agent/workspaces",
    "/agent/workspaces/{workspaceId}/select",
    "/agent/sql",
}
assert payload["openapi"] == "3.1.0"
missing_paths = sorted(required_paths.difference(payload["paths"].keys()))
assert missing_paths == [], missing_paths
PY

request_json "GET" "${API_BASE_URL%/}/openapi.json" "" ""
assert_status "200" "GET /v1/openapi.json"
ROOT_OPENAPI_BODY="${LAST_BODY_FILE}"
request_json "GET" "${API_BASE_URL%/}/swagger.json" "" ""
assert_status "200" "GET /v1/swagger.json"
ROOT_SWAGGER_BODY="${LAST_BODY_FILE}"
request_json "GET" "${API_BASE_URL%/}/agent/swagger.json" "" ""
assert_status "200" "GET /v1/agent/swagger.json"
AGENT_SWAGGER_BODY="${LAST_BODY_FILE}"
python3 - <<'PY' "${CANONICAL_OPENAPI_BODY}" "${ROOT_OPENAPI_BODY}" "${ROOT_SWAGGER_BODY}" "${AGENT_SWAGGER_BODY}"
import json
import sys

canonical = json.load(open(sys.argv[1], encoding="utf-8"))
root_openapi = json.load(open(sys.argv[2], encoding="utf-8"))
root_swagger = json.load(open(sys.argv[3], encoding="utf-8"))
agent_swagger = json.load(open(sys.argv[4], encoding="utf-8"))
assert canonical == root_openapi
assert canonical == root_swagger
assert canonical == agent_swagger
PY

request_json "POST" "${AUTH_BASE_URL%/}/api/agent/send-code" "{\"email\":\"${DEMO_EMAIL}\"}" ""
assert_status "200" "POST /api/agent/send-code"
SEND_CODE_BODY="${LAST_BODY_FILE}"
OTP_SESSION_TOKEN="$(
  python3 - <<'PY' "${SEND_CODE_BODY}" "${DEMO_EMAIL}" "${AUTH_BASE_URL%/}" "${API_BASE_URL%/}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
demo_email = sys.argv[2]
auth_base_url = sys.argv[3]
api_base_url = sys.argv[4]

assert payload["ok"] is True
assert payload["data"]["email"] == demo_email
otp_session_token = payload["data"]["otpSessionToken"]
assert isinstance(otp_session_token, str) and otp_session_token != ""
assert payload["data"]["authBaseUrl"] == auth_base_url
assert payload["data"]["apiBaseUrl"] == api_base_url
assert payload["actions"][0]["name"] == "verify_code"
assert payload["actions"][0]["url"] == f"{auth_base_url}/api/agent/verify-code"
assert payload["docs"]["openapiUrl"] == f"{api_base_url}/agent/openapi.json"
print(otp_session_token)
PY
)"

request_json "POST" "${AUTH_BASE_URL%/}/api/agent/verify-code" "{\"code\":\"12345678\",\"otpSessionToken\":\"${OTP_SESSION_TOKEN}\",\"label\":\"${CONNECTION_LABEL}\"}" ""
assert_status "200" "POST /api/agent/verify-code"
VERIFY_CODE_BODY="${LAST_BODY_FILE}"
AGENT_API_KEY="$(
  python3 - <<'PY' "${VERIFY_CODE_BODY}" "${CONNECTION_LABEL}" "${API_BASE_URL%/}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
connection_label = sys.argv[2]
api_base_url = sys.argv[3]

assert payload["ok"] is True
api_key = payload["data"]["apiKey"]
assert isinstance(api_key, str) and api_key != ""
assert payload["data"]["authorizationScheme"] == "ApiKey"
assert payload["data"]["apiBaseUrl"] == api_base_url
connection = payload["data"]["connection"]
assert isinstance(connection["connectionId"], str) and connection["connectionId"] != ""
assert connection["label"] == connection_label
assert payload["actions"][0]["name"] == "load_account"
print(api_key)
PY
)"
AGENT_CONNECTION_ID="$(
  python3 - <<'PY' "${VERIFY_CODE_BODY}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
print(payload["data"]["connection"]["connectionId"])
PY
)"

request_json "GET" "${API_BASE_URL%/}/agent/me" "" "authorization: ApiKey ${AGENT_API_KEY}"
assert_status "200" "GET /v1/agent/me"
python3 - <<'PY' "${LAST_BODY_FILE}" "${DEMO_EMAIL}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
demo_email = sys.argv[2]

assert payload["ok"] is True
assert payload["data"]["authTransport"] == "api_key"
assert payload["data"]["profile"]["email"] == demo_email
assert "selectedWorkspaceId" in payload["data"]
PY

request_json "GET" "${API_BASE_URL%/}/agent/workspaces?limit=100" "" "authorization: ApiKey ${AGENT_API_KEY}"
assert_status "200" "GET /v1/agent/workspaces"
python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))

assert payload["ok"] is True
assert isinstance(payload["data"]["workspaces"], list)
next_cursor = payload["data"]["nextCursor"]
assert next_cursor is None or isinstance(next_cursor, str)
PY

request_json "POST" "${API_BASE_URL%/}/agent/workspaces" "{\"name\":\"${WORKSPACE_NAME}\"}" "authorization: ApiKey ${AGENT_API_KEY}"
assert_status "201" "POST /v1/agent/workspaces"
CREATE_WORKSPACE_BODY="${LAST_BODY_FILE}"
WORKSPACE_ID="$(
  python3 - <<'PY' "${CREATE_WORKSPACE_BODY}" "${WORKSPACE_NAME}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
workspace_name = sys.argv[2]

assert payload["ok"] is True
workspace = payload["data"]["workspace"]
workspace_id = workspace["workspaceId"]
assert isinstance(workspace_id, str) and workspace_id != ""
assert workspace["name"] == workspace_name
assert workspace["isSelected"] is True
print(workspace_id)
PY
)"

request_json "POST" "${API_BASE_URL%/}/agent/workspaces/${WORKSPACE_ID}/select" "" "authorization: ApiKey ${AGENT_API_KEY}"
assert_status "200" "POST /v1/agent/workspaces/{workspaceId}/select"
python3 - <<'PY' "${LAST_BODY_FILE}" "${WORKSPACE_ID}" "${WORKSPACE_NAME}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
workspace_id = sys.argv[2]
workspace_name = sys.argv[3]

assert payload["ok"] is True
workspace = payload["data"]["workspace"]
assert workspace["workspaceId"] == workspace_id
assert workspace["name"] == workspace_name
assert workspace["isSelected"] is True
PY

request_json "POST" "${API_BASE_URL%/}/agent/sql" "{\"sql\":\"SHOW TABLES\"}" "authorization: ApiKey ${AGENT_API_KEY}"
assert_status "200" "POST /v1/agent/sql SHOW TABLES"
python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
rows = payload["data"]["rows"]
table_names = {row["table_name"] for row in rows}
assert payload["ok"] is True
assert payload["data"]["statementType"] == "show_tables"
assert payload["data"]["resource"] is None
assert {"workspace", "cards", "decks", "review_events"}.issubset(table_names)
PY

request_json "POST" "${API_BASE_URL%/}/agent/sql" "{\"sql\":\"INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ('${CARD_FRONT_TEXT}', '${CARD_BACK_TEXT}', ('agent-smoke'), 'medium')\"}" "authorization: ApiKey ${AGENT_API_KEY}"
assert_status "200" "POST /v1/agent/sql INSERT"
python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["ok"] is True
assert payload["data"]["statementType"] == "insert"
assert payload["data"]["resource"] == "cards"
assert payload["data"]["affectedCount"] == 1
PY

request_json "POST" "${API_BASE_URL%/}/agent/sql" "{\"sql\":\"SELECT card_id, front_text, back_text FROM cards WHERE LOWER(front_text) = '${CARD_FRONT_TEXT_LOWER}' ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\"}" "authorization: ApiKey ${AGENT_API_KEY}"
assert_status "200" "POST /v1/agent/sql SELECT"
python3 - <<'PY' "${LAST_BODY_FILE}" "${CARD_FRONT_TEXT}" "${CARD_BACK_TEXT}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
front_text = sys.argv[2]
back_text = sys.argv[3]
rows = payload["data"]["rows"]
assert payload["ok"] is True
assert payload["data"]["statementType"] == "select"
assert payload["data"]["resource"] == "cards"
assert len(rows) >= 1
first_row = rows[0]
assert first_row["front_text"] == front_text
assert first_row["back_text"] == back_text
assert isinstance(first_row["card_id"], str) and first_row["card_id"] != ""
PY

echo "Agent API smoke passed for ${DEMO_EMAIL} run=${RUN_ID}"
