# Agent SQL and MCP Telemetry

Every agent SQL execution emits exactly one structured CloudWatch record, on
success and on failure alike, so the failure rate of foreign models against our
SQL dialect is measurable. Every authenticated `/mcp` request emits one more
record, so the MCP traffic that runs no SQL is measurable too.

The record is emitted by `withAgentSqlTelemetry` in
`apps/backend/src/aiTools/agentSql.ts`, which wraps `executeAgentSql`,
`runSqlQuery`, and `runSqlExecute`. It sits below the MCP tool handlers' own
`catch`, which answers with a `CallToolResult` and therefore never reaches
`app.onError`: without this record an MCP dialect rejection produces no record
that identifies the failure, no Sentry event, and no Langfuse trace. The
`mcp_request` record the same request emits counts the request but reports the
transport's own `statusCode` 200, because a rejected tool call is a successful
JSON-RPC response.

## Where the records are

- `action = "agent_sql"`, `domain = "backend"`
- surface `agent-rest`: backend API Lambda log group
  (`/aws/lambda/<BackendFunctionName>`, `service = "backend-api"`)
- surface `mcp`: MCP Lambda log group (`/aws/lambda/<McpFunctionName>`,
  `service = "backend-api"`)
- surface `chat-tool`: chat worker Lambda log group
  (`/aws/lambda/<ChatWorkerFunctionName>`, `service = "chat-worker"`)

The function names are the `BackendFunctionName`, `McpFunctionName`, and
`ChatWorkerFunctionName` CDK stack outputs. Query the three log groups together
to compare surfaces.

## Record fields

| Field | Meaning |
| --- | --- |
| `surface` | `chat-tool`, `agent-rest`, or `mcp` |
| `caller` | Calling client label; `null` on every surface except MCP |
| `connectionId` | Agent connection the execution ran under |
| `succeeded` | Outcome; the denominator for any failure ratio |
| `statementType` | `select`, `insert`, `batch`, and so on; `null` on failure |
| `resource` | `cards`, `decks`, and so on; `null` for batches and on failure |
| `statementCount` | Statements in the submitted SQL; `null` on failure |
| `rowOrAffectedCount` | Rows read or records affected; `null` on failure |
| `durationMs` | Wall-clock duration of the execution |
| `sqlLength` | Character length of the submitted SQL |
| `sqlFingerprint` | SHA-256 hex digest of the submitted SQL |
| `errorCode` | `HttpError` code on failure, else `null` |
| `dialectReason` | First validation-issue code on failure, else `null` |
| `errorClass` | `error.name` on failure, else `null`; coarse by design, so group failures by `errorCode` and `dialectReason` |

`userId`, `workspaceId`, and the synthetic route `agent-sql/<surface>` come from
the shared observation scope on every record, and so does `requestId`: the MCP
surface publishes one per transport request, so `agent_sql` records emitted
there carry it and the REST and chat surfaces record null.

Raw SQL text is never logged. `sqlFingerprint` plus `errorCode` and
`dialectReason` are what make repeated failures groupable, the same choice the
admin reporting query records already make.

The error message is not recorded either. Dialect and batch errors quote the
offending SQL fragment verbatim, so the message carries flashcard content that
no delimiter heuristic can strip reliably. Unexpected failures still reach
Sentry with their full message and stack, so use Sentry when a specific failure
needs to be read rather than counted.

`dialectReason` is recorded as an opaque value. The SQL dialect owns that
vocabulary and will make it more specific over time; nothing in this record
depends on which values appear.

## The MCP caller label

On the MCP surface `caller` is the request `User-Agent`, trimmed and capped at
120 characters, and `null` when the client sends no `User-Agent`.

The `initialize` clientInfo is not used because it is not reachable: the MCP
Lambda runs the transport statelessly (`sessionIdGenerator: undefined` in
`apps/backend/src/entrypoints/lambda-mcp.ts`), so a `tools/call` arrives as its
own HTTP request on a freshly built server that never saw the client's
`initialize`. Reaching clientInfo would mean restructuring the entrypoint into a
session-bearing transport.

## The MCP request record

`agent_sql` only sees SQL, so MCP requests that run none were invisible:
`initialize`, `tools/list`, and the `list_workspaces` tool produced no record at
all. Each authenticated `/mcp` request therefore emits exactly one
`action = "mcp_request"` record into the MCP Lambda log group
(`service = "backend-api"`), from the `/mcp` route in
`apps/backend/src/entrypoints/lambda-mcp.ts`. Every branch that answers an
authenticated client emits it once: the transport response, a transport fault,
and the 405 that rejects a non-POST request alike.

Requests that never authenticate emit none, because the Bearer 401 challenge and
an auth-layer failure have no connection to record. So the record count is the
authenticated request count on this surface, not the total request count.
Observing a request can only degrade a field of its record, never remove the
record: a response body that could not be measured is recorded as a `null`
`responseChars`.

| Field | Meaning |
| --- | --- |
| `protocolVersion` | `MCP-Protocol-Version` request header; `null` when the client sends none, which includes the `initialize` request that negotiates it |
| `jsonRpcMethod` | `Mcp-Method` request header, so `initialize`, `tools/list`, `tools/call`; `null` on clients older than MCP revision 2026-07-28, which is where the header became REQUIRED |
| `toolName` | Tool the request ran, observed in process from the tool handler, so it is present for a tool call whatever the client's protocol revision is; when no handler ran it falls back to the client's own unvalidated `Mcp-Name` header, so a `tools/call` the SDK rejected before any handler is still named on a client new enough to send that header; `null` when no handler ran and no `Mcp-Name` was sent, and always `null` on a non-POST request |
| `caller` | Calling client label, normalized like the `agent_sql` one |
| `connectionId` | Agent connection the request ran under |
| `statusCode` | HTTP status the client received, including the 405 a non-POST request gets |
| `durationMs` | Wall-clock duration of serving the request after authentication |
| `responseChars` | Character length of the response body; `null` when the body was not a buffered JSON document, when reading it failed, and on the transport-fault branch, where the record is emitted before `app.onError` builds the body the client receives |

`requestId`, `userId`, `workspaceId`, the route `mcp`, and `method` (the
request's own HTTP method, so non-POST traffic is groupable) come from the
shared observation scope. Every `/mcp` response returns that id as the
`X-Request-Id` response header, error responses included, because the entrypoint
sets it before the handler runs. The same id is carried by every `agent_sql`
record and every Sentry capture the request produced, which is what joins them
to this record.

Header values are client-controlled, so they are trimmed, capped at 120
characters, and recorded as `null` when absent or empty. They are never
validated: a missing or unexpected header changes nothing about how the request
is served.

No body content is recorded. The JSON-RPC body belongs to the transport and is
never parsed for telemetry, and tool arguments and results carry flashcard
content; `responseChars` is a length measured off the response and never any of
what it contains.

A `method = "GET"` row is a client trying to open the standalone SSE stream that
MCP revisions 2025-03-26 through 2025-11-25 allow and revision 2026-07-28
removed. This surface runs the transport statelessly and answers 405, which
those clients accept, so a run of such rows is a client-compatibility signal
rather than an incident.

## Request mix on the MCP surface

```
filter domain = "backend" and action = "mcp_request"
| stats count(*) as requests,
        avg(responseChars) as avgResponseChars,
        avg(durationMs) as avgDurationMs
  by method, jsonRpcMethod, toolName, protocolVersion, caller
| sort requests desc
| limit 20
```

`jsonRpcMethod` is `null` for every client older than MCP revision 2026-07-28,
so today the split is carried by the other fields: a tool call is named by
`toolName`, an `initialize`, or any request from a client that sends no
`MCP-Protocol-Version`, is a row with no `protocolVersion`, a non-POST `method`
is the rejected stream attempt above, and the remaining protocol traffic
(`tools/list`, `ping`, `notifications/initialized`) shares one unnamed bucket
until callers start sending `Mcp-Method`.

## Failure share by surface

```
filter domain = "backend" and action = "agent_sql"
| stats count(*) as executions,
        sum(succeeded = 0) as failures,
        sum(succeeded = 0) * 100 / count(*) as failureSharePct
  by surface
| sort failureSharePct desc
```

Add `, caller` to the `by` clause to split the MCP surface per client.

## Top failure causes

```
filter domain = "backend" and action = "agent_sql" and succeeded = 0
| stats count(*) as failures by surface, errorCode, dialectReason, caller
| sort failures desc
| limit 20
```

If a log group renders `succeeded` as `true`/`false` instead of `1`/`0`, use
`succeeded = "false"` in both queries.
