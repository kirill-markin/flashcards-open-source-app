#!/usr/bin/env bash
# Check the external MCP contract against the deployed environment.

set -euo pipefail

AUTH_BASE_URL="${FLASHCARDS_MCP_SMOKE_AUTH_BASE_URL:-https://auth.flashcards-open-source-app.com}"
API_BASE_URL="${FLASHCARDS_MCP_SMOKE_API_BASE_URL:-https://api.flashcards-open-source-app.com/v1}"
# The API base the deployment advertises in its payloads (data.apiBaseUrl,
# docs.discoveryUrl, surface.accountUrl). It differs from API_BASE_URL, the host
# this smoke calls, once CDK_API_BASE_URL moves the published origin; unset, the
# two are the same value.
EXPECTED_ADVERTISED_API_BASE_URL="${FLASHCARDS_MCP_SMOKE_EXPECTED_ADVERTISED_API_BASE_URL:-${API_BASE_URL}}"
MCP_BASE_URL="${FLASHCARDS_MCP_SMOKE_MCP_BASE_URL:-https://mcp.flashcards-open-source-app.com}"
# The optional second public MCP host, checked only when the release workflow's MCP
# smoke job resolves it: the alternate domain name and certificate ARN are both set
# and CDK_MCP_ALTERNATE_HOST_LIVE reads "true", the same rule that creates and
# polices the host in infra/aws/lib/mcp-alternate-host.ts.
ALTERNATE_MCP_BASE_URL="${FLASHCARDS_MCP_SMOKE_ALTERNATE_MCP_BASE_URL:-}"
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
CARD_ID=""

WORKSPACE_NAME="${WORKSPACE_PREFIX}${RUN_ID}"
CONNECTION_LABEL="${CONNECTION_LABEL_PREFIX}${RUN_ID}"
CARD_FRONT_TEXT="MCP smoke question ${RUN_ID}"
CARD_BACK_TEXT="MCP smoke answer ${RUN_ID}"
CARD_FRONT_TEXT_LOWER="$(printf '%s' "${CARD_FRONT_TEXT}" | tr '[:upper:]' '[:lower:]')"
CARD_TAG="mcp-smoke"
REVIEW_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
REVIEW_TIME_ZONE="Europe/Sofia"
MCP_RESOURCE_URL="${MCP_BASE_URL%/}/mcp"

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

# The deploy normalizes the configured host before it becomes a custom domain
# (infra/aws/lib/mcp-alternate-host.ts: trim, lower-case, drop a trailing root dot),
# while this base URL arrives interpolated from the same repository variable raw.
# Repeating that normalization here keeps a value such as ` mcp.Example.com. ` probing
# the host that was actually deployed, instead of failing the release on formatting
# alone. Scheme plus host only, which is all this base URL ever carries.
normalize_mcp_base_url() {
  local value scheme host

  value="$(printf '%s' "${1}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

  scheme="https://"
  host="${value}"
  if [[ "${value}" == *"://"* ]]; then
    scheme="${value%%://*}://"
    host="${value#*://}"
  fi
  host="${host%/}"
  host="${host%.}"

  # No host left after normalization -- unset, whitespace only, or a bare scheme --
  # means this host is not configured, exactly as an empty value does. Printing a
  # hostless URL instead would send curl at a nonsense address and abort the run.
  if [[ -z "${host}" ]]; then
    return 0
  fi

  printf '%s%s' "${scheme}" "${host}"
}

# The public, unauthenticated contract of one MCP host: health, both
# protected-resource metadata locations, and the Bearer challenge. Every
# identifier in the answers names the host the request was sent to, so this runs
# once per MCP host this environment serves.
check_mcp_host_contract() {
  local mcp_base_url="${1%/}"
  local resource_url="${mcp_base_url}/mcp"
  local resource_metadata_url="${mcp_base_url}/.well-known/oauth-protected-resource/mcp"
  local root_metadata_body
  local path_metadata_body

  request_json "GET" "${mcp_base_url}/health" "" ""
  assert_status "200" "GET ${mcp_base_url}/health"
  python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload == {"status": "ok"}
PY

  request_json "GET" "${mcp_base_url}/.well-known/oauth-protected-resource" "" ""
  assert_status "200" "GET ${mcp_base_url}/.well-known/oauth-protected-resource"
  root_metadata_body="${LAST_BODY_FILE}"
  python3 - <<'PY' "${root_metadata_body}" "${resource_url}" "${AUTH_BASE_URL%/}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
mcp_resource_url = sys.argv[2]
auth_base_url = sys.argv[3]
assert payload["resource"] == mcp_resource_url
assert payload["authorization_servers"] == [auth_base_url]
PY

  request_json "GET" "${resource_metadata_url}" "" ""
  assert_status "200" "GET ${resource_metadata_url}"
  path_metadata_body="${LAST_BODY_FILE}"
  python3 - <<'PY' "${root_metadata_body}" "${path_metadata_body}" "${resource_url}" "${AUTH_BASE_URL%/}"
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

  request_json "GET" "${resource_url}" "" ""
  assert_status "401" "unauthenticated GET ${resource_url}"
  python3 - <<'PY' "${LAST_HEADERS_FILE}" "${resource_metadata_url}"
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

check_mcp_host_contract "${MCP_BASE_URL}"

request_json "POST" "${AUTH_BASE_URL%/}/api/agent/send-code" "{\"email\":\"${DEMO_EMAIL}\"}" ""
assert_status "200" "POST /api/agent/send-code"
SEND_CODE_BODY="${LAST_BODY_FILE}"
OTP_SESSION_TOKEN="$(
  python3 - <<'PY' "${SEND_CODE_BODY}" "${DEMO_EMAIL}" "${AUTH_BASE_URL%/}" "${EXPECTED_ADVERTISED_API_BASE_URL%/}"
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
  python3 - <<'PY' "${VERIFY_CODE_BODY}" "${CONNECTION_LABEL}" "${EXPECTED_ADVERTISED_API_BASE_URL%/}" "${AGENT_CONNECTION_ID}"
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
assert tool_names == {"list_workspaces", "sql_query", "sql_execute", "get_guide", "next_review_card", "reveal_answer", "submit_review"}, sorted(tool_names)
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

request_mcp_jsonrpc "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"sql_query\",\"arguments\":{\"sql\":\"SELECT * FROM cards WHERE metadata IS NULL LIMIT 20 OFFSET 0\",\"workspaceId\":\"${WORKSPACE_ID}\"}}}"
assert_status "200" "MCP tools/call sql_query invalid filter"
python3 - <<'PY' "${LAST_BODY_FILE}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
expected_message = "Column is not filterable: metadata"

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

request_mcp_jsonrpc "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"sql_execute\",\"arguments\":{\"sql\":\"INSERT INTO cards (front_text, back_text, tags, effort_level) VALUES ('${CARD_FRONT_TEXT}', '${CARD_BACK_TEXT}', ('${CARD_TAG}'), 'medium')\",\"workspaceId\":\"${WORKSPACE_ID}\"}}}"
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
SELECT_CARD_BODY="${LAST_BODY_FILE}"
python3 - <<'PY' "${SELECT_CARD_BODY}" "${CARD_FRONT_TEXT}" "${CARD_BACK_TEXT}"
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
CARD_ID="$(
  python3 - <<'PY' "${SELECT_CARD_BODY}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
agent_payload = json.loads(payload["result"]["content"][0]["text"])
rows = agent_payload["data"]["rows"]
card_id = rows[0].get("card_id") if rows else None
if not isinstance(card_id, str) or card_id == "":
    raise SystemExit("card select did not return card_id")
print(card_id)
PY
)"

request_mcp_jsonrpc "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"next_review_card\",\"arguments\":{\"workspaceId\":\"${WORKSPACE_ID}\",\"tags\":[\"${CARD_TAG}\"]}}}"
assert_status "200" "MCP tools/call next_review_card"
python3 - <<'PY' "${LAST_BODY_FILE}" "${CARD_ID}" "${CARD_FRONT_TEXT}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
card_id = sys.argv[2]
front_text = sys.argv[3]
assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 8
assert "error" not in payload
result = payload["result"]
assert result.get("isError", False) is False, result
content = result["content"]
assert isinstance(content, list) and len(content) >= 1
assert content[0]["type"] == "text"
agent_payload = json.loads(content[0]["text"])
assert agent_payload["ok"] is True, agent_payload
card = agent_payload["data"]["card"]
assert card["cardId"] == card_id, card
assert card["frontText"] == front_text, card
assert "backText" not in card, card
instructions = agent_payload["instructions"]
for tool_name in ("next_review_card", "reveal_answer", "submit_review"):
    assert tool_name in instructions, instructions
PY

request_mcp_jsonrpc "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"reveal_answer\",\"arguments\":{\"workspaceId\":\"${WORKSPACE_ID}\",\"cardId\":\"${CARD_ID}\"}}}"
assert_status "200" "MCP tools/call reveal_answer"
python3 - <<'PY' "${LAST_BODY_FILE}" "${CARD_ID}" "${CARD_BACK_TEXT}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
card_id = sys.argv[2]
back_text = sys.argv[3]
assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 9
assert "error" not in payload
result = payload["result"]
assert result.get("isError", False) is False, result
agent_payload = json.loads(result["content"][0]["text"])
assert agent_payload["ok"] is True, agent_payload
assert agent_payload["data"]["cardId"] == card_id, agent_payload["data"]
assert agent_payload["data"]["backText"] == back_text, agent_payload["data"]
PY

request_mcp_jsonrpc "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"submit_review\",\"arguments\":{\"workspaceId\":\"${WORKSPACE_ID}\",\"cardId\":\"${CARD_ID}\",\"reviewId\":\"${REVIEW_ID}\",\"rating\":\"Good\",\"reviewedTimeZone\":\"${REVIEW_TIME_ZONE}\"}}}"
assert_status "200" "MCP tools/call submit_review"
SUBMIT_REVIEW_BODY="${LAST_BODY_FILE}"
python3 - <<'PY' "${SUBMIT_REVIEW_BODY}" "${CARD_ID}" "${REVIEW_ID}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
card_id = sys.argv[2]
review_id = sys.argv[3]
assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 10
assert "error" not in payload
result = payload["result"]
assert result.get("isError", False) is False, result
agent_payload = json.loads(result["content"][0]["text"])
assert agent_payload["ok"] is True, agent_payload
data = agent_payload["data"]
assert data["cardId"] == card_id, data
assert data["reviewId"] == review_id, data
assert data["rating"] == "Good", data
assert data["reps"] == 1, data
assert data["lapses"] == 0, data
assert isinstance(data["dueAt"], str) and data["dueAt"] != "", data
assert "backText" not in data, data
PY

request_mcp_jsonrpc "{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tools/call\",\"params\":{\"name\":\"submit_review\",\"arguments\":{\"workspaceId\":\"${WORKSPACE_ID}\",\"cardId\":\"${CARD_ID}\",\"reviewId\":\"${REVIEW_ID}\",\"rating\":\"Good\",\"reviewedTimeZone\":\"${REVIEW_TIME_ZONE}\"}}}"
assert_status "200" "MCP tools/call submit_review retry"
python3 - <<'PY' "${LAST_BODY_FILE}" "${SUBMIT_REVIEW_BODY}" "${CARD_ID}"
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
submitted = json.load(open(sys.argv[2], encoding="utf-8"))
original = json.loads(submitted["result"]["content"][0]["text"])["data"]
card_id = sys.argv[3]
assert payload["jsonrpc"] == "2.0"
assert payload["id"] == 11
assert "error" not in payload
result = payload["result"]
assert result["isError"] is True, result
agent_payload = json.loads(result["content"][0]["text"])
assert agent_payload["ok"] is False, agent_payload
assert agent_payload["error"]["code"] == "REVIEW_EVENT_CONFLICT", agent_payload["error"]
schedule = agent_payload["error"]["details"]["reviewSchedule"]
assert schedule["cardId"] == card_id, schedule
assert schedule["reps"] == original["reps"], schedule
assert schedule["lapses"] == original["lapses"], schedule
assert schedule["dueAt"] == original["dueAt"], schedule
assert schedule["state"] == original["state"], schedule
assert "already recorded" in agent_payload["instructions"], agent_payload["instructions"]
PY

# The same public contract on the second MCP host, when this environment serves
# one. It is a separate DNS record, a separate certificate and a separate API
# Gateway custom domain, so it can stop serving on its own, and every identifier
# it returns must name itself: an MCP client handed a resource on another origin
# refuses to authorize.
#
# Deliberately last. The first failing assertion aborts the whole script, so a
# second host that is merely misconfigured must not be able to hide the primary
# host's authenticated sign-in and JSON-RPC coverage above.
ALTERNATE_MCP_BASE_URL="$(normalize_mcp_base_url "${ALTERNATE_MCP_BASE_URL}")"
if [[ -n "${ALTERNATE_MCP_BASE_URL}" ]]; then
  check_mcp_host_contract "${ALTERNATE_MCP_BASE_URL}"
fi

echo "MCP smoke passed for ${DEMO_EMAIL} run=${RUN_ID}"
