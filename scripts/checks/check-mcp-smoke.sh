#!/usr/bin/env bash
# Check the external MCP contract against the deployed environment.

set -euo pipefail

AUTH_BASE_URL="${FLASHCARDS_MCP_SMOKE_AUTH_BASE_URL:-https://auth.flashcards-open-source-app.com}"
API_BASE_URL="${FLASHCARDS_MCP_SMOKE_API_BASE_URL:-https://api.flashcards-open-source-app.com/v1}"
MCP_BASE_URL="${FLASHCARDS_MCP_SMOKE_MCP_BASE_URL:-https://mcp.flashcards-open-source-app.com}"
DEMO_EMAIL="${FLASHCARDS_MCP_SMOKE_DEMO_EMAIL:-google-review@example.com}"
WORKSPACE_PREFIX="${FLASHCARDS_MCP_SMOKE_WORKSPACE_PREFIX:-E2E mcp }"
CONNECTION_LABEL_PREFIX="${FLASHCARDS_MCP_SMOKE_CONNECTION_LABEL_PREFIX:-E2E mcp }"
RUN_ID="${FLASHCARDS_MCP_SMOKE_RUN_ID:-$(date +%s)-$$}"

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
CARD_FRONT_TEXT="MCP smoke question ${RUN_ID}"
CARD_BACK_TEXT="MCP smoke answer ${RUN_ID}"
CARD_FRONT_TEXT_LOWER="$(printf '%s' "${CARD_FRONT_TEXT}" | tr '[:upper:]' '[:lower:]')"
MCP_RESOURCE_URL="${MCP_BASE_URL%/}/mcp"
MCP_RESOURCE_METADATA_URL="${MCP_BASE_URL%/}/.well-known/oauth-protected-resource/mcp"

request_json() {
  local method="$1"
  local url="$2"
  local body="$3"
  local auth_header="$4"
  local body_file
  local headers_file
  local status

  body_file="$(mktemp "${TMP_DIR}/body.XXXXXX")"
  headers_file="$(mktemp "${TMP_DIR}/headers.XXXXXX")"

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

request_mcp_jsonrpc() {
  local body="$1"
  local body_file
  local headers_file
  local status

  body_file="$(mktemp "${TMP_DIR}/body.XXXXXX")"
  headers_file="$(mktemp "${TMP_DIR}/headers.XXXXXX")"

  status="$(
    curl -sS \
      -D "${headers_file}" \
      -o "${body_file}" \
      -X "POST" \
      -H "Authorization: Bearer ${AGENT_API_KEY}" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "Mcp-Protocol-Version: 2025-06-18" \
      --data "${body}" \
      "${MCP_RESOURCE_URL}" \
      -w "%{http_code}"
  )"

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

request_json "GET" "${MCP_BASE_URL%/}/health" "" ""
assert_status "200" "GET /health"
python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload == {"status": "ok"}
PY

request_json "GET" "${MCP_BASE_URL%/}/.well-known/oauth-protected-resource" "" ""
assert_status "200" "GET /.well-known/oauth-protected-resource"
ROOT_METADATA_BODY="${LAST_BODY_FILE}"
python3 - <<'PY' "${ROOT_METADATA_BODY}" "${MCP_RESOURCE_URL}" "${AUTH_BASE_URL%/}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
mcp_resource_url = sys.argv[2]
auth_base_url = sys.argv[3]
assert payload["resource"] == mcp_resource_url
assert payload["authorization_servers"] == [auth_base_url]
PY

request_json "GET" "${MCP_RESOURCE_METADATA_URL}" "" ""
assert_status "200" "GET /.well-known/oauth-protected-resource/mcp"
PATH_METADATA_BODY="${LAST_BODY_FILE}"
python3 - <<'PY' "${ROOT_METADATA_BODY}" "${PATH_METADATA_BODY}" "${MCP_RESOURCE_URL}" "${AUTH_BASE_URL%/}"
import json
import sys

root_payload = json.load(open(sys.argv[1], encoding="utf-8"))
path_payload = json.load(open(sys.argv[2], encoding="utf-8"))
mcp_resource_url = sys.argv[3]
auth_base_url = sys.argv[4]
assert path_payload == root_payload
assert path_payload["resource"] == mcp_resource_url
assert path_payload["authorization_servers"] == [auth_base_url]
PY

request_json "GET" "${MCP_RESOURCE_URL}" "" ""
assert_status "401" "unauthenticated GET /mcp"
python3 - <<'PY' "${LAST_HEADERS_FILE}" "${MCP_RESOURCE_METADATA_URL}"
import sys

headers = open(sys.argv[1], encoding="utf-8").read().splitlines()
metadata_url = sys.argv[2]
www_authenticate_headers = [
    header for header in headers
    if header.lower().startswith("www-authenticate:")
]
expected_fragment = f'resource_metadata="{metadata_url}"'
assert any(expected_fragment in header for header in www_authenticate_headers), www_authenticate_headers
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
assert payload["docs"]["discoveryUrl"] == f"{api_base_url}/"
assert payload["docs"]["source"] == {
    "repositoryUrl": "https://github.com/kirill-markin/flashcards-open-source-app",
    "agentRoutesUrl": "https://github.com/kirill-markin/flashcards-open-source-app/tree/main/apps/backend/src/routes",
    "authRoutesUrl": "https://github.com/kirill-markin/flashcards-open-source-app/tree/main/apps/auth/src/routes/agent",
}
assert "00000000" in payload["instructions"]
print(otp_session_token)
PY
)"

request_json "POST" "${AUTH_BASE_URL%/}/api/agent/verify-code" "{\"code\":\"00000000\",\"otpSessionToken\":\"${OTP_SESSION_TOKEN}\",\"label\":\"${CONNECTION_LABEL}\"}" ""
assert_status "200" "POST /api/agent/verify-code"
VERIFY_CODE_BODY="${LAST_BODY_FILE}"
AGENT_CONNECTION_ID="$(
  python3 - <<'PY' "${VERIFY_CODE_BODY}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
data = payload.get("data")
connection = data.get("connection") if isinstance(data, dict) else None
connection_id = connection.get("connectionId") if isinstance(connection, dict) else None
if not isinstance(connection_id, str) or connection_id == "":
    raise SystemExit("verify-code response did not return connection.connectionId")
print(connection_id)
PY
)"
AGENT_API_KEY="$(
  python3 - <<'PY' "${VERIFY_CODE_BODY}" "${CONNECTION_LABEL}" "${API_BASE_URL%/}" "${AGENT_CONNECTION_ID}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
connection_label = sys.argv[2]
api_base_url = sys.argv[3]
agent_connection_id = sys.argv[4]

assert payload["ok"] is True
api_key = payload["data"]["apiKey"]
assert isinstance(api_key, str) and api_key.startswith("fca_")
assert payload["data"]["authorizationScheme"] == "ApiKey"
assert payload["data"]["apiBaseUrl"] == api_base_url
connection = payload["data"]["connection"]
assert connection["connectionId"] == agent_connection_id
assert connection["label"] == connection_label
assert [action["name"] for action in payload["actions"]] == [
    "load_discovery",
    "load_account",
    "list_workspaces",
    "create_workspace",
    "select_workspace",
]
print(api_key)
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
  python3 - <<'PY' "${CREATE_WORKSPACE_BODY}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
data = payload.get("data")
workspace = data.get("workspace") if isinstance(data, dict) else None
workspace_id = workspace.get("workspaceId") if isinstance(workspace, dict) else None
if not isinstance(workspace_id, str) or workspace_id == "":
    raise SystemExit("create workspace response did not return workspace.workspaceId")
print(workspace_id)
PY
)"
python3 - <<'PY' "${CREATE_WORKSPACE_BODY}" "${WORKSPACE_ID}" "${WORKSPACE_NAME}"
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

request_mcp_jsonrpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"flashcards-open-source-app-mcp-smoke","version":"1.0.0"}}}'
assert_status "200" "MCP initialize"
python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 1
assert "error" not in payload
result = payload["result"]
assert result["serverInfo"]["name"] == "flashcards-open-source-app"
assert isinstance(result["capabilities"]["tools"], dict)
PY

request_mcp_jsonrpc '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
assert_status "200" "MCP tools/list"
python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 2
assert "error" not in payload
tools = payload["result"]["tools"]
tool_names = {tool["name"] for tool in tools}
assert tool_names == {"list_workspaces", "sql_query", "sql_execute"}, sorted(tool_names)
assert "media_assets" not in tool_names
assert all(not tool["name"].startswith("media") for tool in tools)
PY

request_mcp_jsonrpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}'
assert_status "200" "MCP tools/call list_workspaces"
python3 - <<'PY' "${LAST_BODY_FILE}" "${WORKSPACE_ID}" "${WORKSPACE_NAME}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
workspace_id = sys.argv[2]
workspace_name = sys.argv[3]
assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 3
assert "error" not in payload
content = payload["result"]["content"]
assert isinstance(content, list) and len(content) >= 1
assert content[0]["type"] == "text"
agent_payload = json.loads(content[0]["text"])
assert agent_payload["ok"] is True
workspaces = agent_payload["data"]["workspaces"]
matches = [
    workspace for workspace in workspaces
    if workspace["workspaceId"] == workspace_id
]
assert len(matches) == 1
assert matches[0]["name"] == workspace_name
assert matches[0]["isSelected"] is True
PY

request_mcp_jsonrpc "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"sql_query\",\"arguments\":{\"sql\":\"SHOW TABLES\",\"workspaceId\":\"${WORKSPACE_ID}\"}}}"
assert_status "200" "MCP tools/call sql_query SHOW TABLES"
python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 4
assert "error" not in payload
content = payload["result"]["content"]
assert isinstance(content, list) and len(content) >= 1
assert content[0]["type"] == "text"
agent_payload = json.loads(content[0]["text"])
assert agent_payload["ok"] is True
assert agent_payload["data"]["statementType"] == "show_tables"
assert agent_payload["data"]["resource"] is None
table_names = {row["table_name"] for row in agent_payload["data"]["rows"]}
assert {"workspace", "cards", "decks", "review_events"}.issubset(table_names), sorted(table_names)
assert "media_assets" not in table_names
PY

request_mcp_jsonrpc "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"sql_query\",\"arguments\":{\"sql\":\"SELECT * FROM cards WHERE deleted_at IS NULL LIMIT 20 OFFSET 0\",\"workspaceId\":\"${WORKSPACE_ID}\"}}}"
assert_status "200" "MCP tools/call sql_query invalid filter"
python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
expected_message = "Column is not filterable: deleted_at"

assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 5
assert "error" not in payload
result = payload["result"]
assert result["isError"] is True
content = result["content"]
assert isinstance(content, list) and len(content) >= 1
assert content[0]["type"] == "text"
agent_payload = json.loads(content[0]["text"])
assert agent_payload["ok"] is False
assert agent_payload["data"] == {}
assert agent_payload["error"]["code"] == "QUERY_INVALID_SQL"
assert agent_payload["error"]["message"] == expected_message
assert agent_payload["error"]["details"]["validationIssues"] == [{
    "path": "sql",
    "code": "invalid_sql",
    "message": expected_message,
}]
assert "Fix the sql string" in agent_payload["instructions"]
assert "server-side error" not in agent_payload["instructions"]
PY

request_mcp_jsonrpc "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"sql_execute\",\"arguments\":{\"sql\":\"INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ('${CARD_FRONT_TEXT}', '${CARD_BACK_TEXT}', ('mcp-smoke'), 'medium')\",\"workspaceId\":\"${WORKSPACE_ID}\"}}}"
assert_status "200" "MCP tools/call sql_execute INSERT"
python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 6
assert "error" not in payload
content = payload["result"]["content"]
assert isinstance(content, list) and len(content) >= 1
assert content[0]["type"] == "text"
agent_payload = json.loads(content[0]["text"])
assert agent_payload["ok"] is True
assert agent_payload["data"]["statementType"] == "insert"
assert agent_payload["data"]["resource"] == "cards"
assert agent_payload["data"]["affectedCount"] == 1
PY

request_mcp_jsonrpc "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"sql_query\",\"arguments\":{\"sql\":\"SELECT card_id, front_text, back_text FROM cards WHERE LOWER(front_text) = '${CARD_FRONT_TEXT_LOWER}' ORDER BY created_at DESC, card_id ASC LIMIT 20 OFFSET 0\",\"workspaceId\":\"${WORKSPACE_ID}\"}}}"
assert_status "200" "MCP tools/call sql_query SELECT"
python3 - <<'PY' "${LAST_BODY_FILE}" "${CARD_FRONT_TEXT}" "${CARD_BACK_TEXT}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
front_text = sys.argv[2]
back_text = sys.argv[3]
assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 7
assert "error" not in payload
content = payload["result"]["content"]
assert isinstance(content, list) and len(content) >= 1
assert content[0]["type"] == "text"
agent_payload = json.loads(content[0]["text"])
rows = agent_payload["data"]["rows"]
assert agent_payload["ok"] is True
assert agent_payload["data"]["statementType"] == "select"
assert agent_payload["data"]["resource"] == "cards"
assert len(rows) >= 1
first_row = rows[0]
assert first_row["front_text"] == front_text
assert first_row["back_text"] == back_text
assert isinstance(first_row["card_id"], str) and first_row["card_id"] != ""
PY

echo "MCP smoke passed for ${DEMO_EMAIL} run=${RUN_ID}"
