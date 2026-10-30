# Agent SQL and MCP Telemetry

Every agent SQL execution emits one `agent_sql` CloudWatch record, on success and on failure alike, so the failure rate of foreign models against our SQL dialect is measurable; every authenticated `/mcp` request emits one `mcp_request` record, so MCP traffic that runs no SQL is measurable too. What each field means is owned by `AgentSqlDetails` and `McpRequestDetails` in [`operations.ts`](../apps/backend/src/observability/sentry/events/operations.ts); the emitters are `withAgentSqlTelemetry` in [`agentSql.ts`](../apps/backend/src/aiTools/agentSql.ts) and the `/mcp` route in [`lambda-mcp.ts`](../apps/backend/src/entrypoints/lambda-mcp.ts).

## Reading the records

- Every backend Lambda uses the Lambda JSON log format ([`backend-lambda-logging.ts`](../infra/aws/lib/backend-lambda-logging.ts)), so the record sits under `message`: address a field as `message.<field>` in Logs Insights and as `$.message.<field>` in a metric filter.
- The envelope's own `requestId` is the Lambda invocation id. `message.requestId` is the `X-Request-Id` response header on the MCP worker, and joins `mcp_request`, the `agent_sql` records under it and the request's Sentry captures; REST and chat `agent_sql` records carry null. Dispatcher records carry the API Gateway request id there instead ([joining them to the worker](#dispatcher-admission-outcomes-and-timings)).
- The `agent_sql` record carries no raw SQL or error message, so group failures by `sqlFingerprint`, `errorCode` and `dialectReason`, and read a specific failure in [the failure log](#reading-one-failure).
- `workspaceId` is the workspace the call targeted, so chat SQL grouped by workspace can show workspaces the chat session did not have open.
- If a log group renders `message.succeeded`, `message.rowsOmitted`, `message.rowsTruncated`, `message.toolExecuted` or `message.toolIsError` as `true`/`false` instead of `1`/`0`, compare against `"true"` and `"false"` in the queries below.

## Where the records are

- Backend API Lambda log group (`service = "backend-api"`): `agent_sql` on surfaces `agent-rest` and `chat-sandbox`, because the chat sandbox's SQL bridge runs there.
- MCP Lambda log group (`service = "backend-api"`): `agent_sql` on surface `mcp`, and `mcp_request`.
- Chat worker Lambda log group (`service = "chat-worker"`): `agent_sql` on surface `chat-tool`.

The function names are the `BackendFunctionName`, `McpFunctionName`, and `ChatWorkerFunctionName` stack outputs; query the three log groups together to compare surfaces. The stack declares the backend API group's retention through a CloudFormation custom resource that is re-applied only when its own properties change, so a retention set by hand silently diverges until it is reverted; change retention in the stack.

## Reading one failure

Every failed execution on every surface also writes one record with its full SQL and exact error message to the `/flashcards-open-source-app/agent-sql-failures` log group, which keeps it 30 days; a record too large for one CloudWatch event keeps the head of both and sets `truncated` ([writer](../apps/backend/src/aiTools/agentSql/failureLog.ts)). The backend writes it directly, so fields sit at the top level rather than under `message`. Filter on the `sqlFingerprint` or the non-null `requestId` of the `agent_sql` record:

```
filter sqlFingerprint = "<sqlFingerprint>"
| fields @timestamp, requestId, surface, caller, errorCode, dialectReason, errorMessage, sql
| sort @timestamp desc
| limit 20
```

A record that could not be written leaves an `agent_sql_failure_log_write_failed` exception, without the SQL or message, in the surface's own Lambda log group and in Sentry.

## The chat sandbox SQL record

Every SQL bridge call from a chat `bash` command also emits one `chat_sandbox_sql` record into the backend API log group, carrying the statement text but never the rows ([route](../apps/backend/src/chatSandbox/sqlBridge/route.ts)). The bridge refuses a read whose answer is too large after `agent_sql` already recorded it as succeeded ([limit](../apps/backend/src/chat/openai/tools/tools.ts)), so trust `chat_sandbox_sql` for the call's outcome. The command itself is the `chat_sandbox_command` record in the chat worker log group.

```
filter message.action = "chat_sandbox_sql"
| fields @timestamp, message.runId, message.kind, message.succeeded,
         message.errorCode, message.rowOrAffectedCount, message.sql
| sort @timestamp asc
```

## The MCP caller label

On the MCP surface `caller` is the normalized request `User-Agent` ([why not clientInfo](../apps/backend/src/mcp/server.ts)). The post-deploy smoke ([`check-mcp-smoke.sh`](../scripts/checks/check-mcp-smoke.sh)) sends `User-Agent: nibomo-mcp-smoke/1`, and the failure queries below exclude its deliberate failures.

## The MCP request record

Requests that never authenticate emit none, so the record count is the authenticated request count, not the total. A `message.method = "GET"` row is a client trying to open the standalone SSE stream that MCP revisions 2025-03-26 through 2025-11-25 allow; this stateless surface answers 405, which those clients accept, so a run of such rows is a client-compatibility signal rather than an incident.

## Dispatcher admission outcomes and timings

Select the `/aws/lambda/<dispatcher function name>` log group for the
`McpDispatcher` Lambda in the deployed stack, then run this Logs Insights query:

```
filter message.action in ["mcp_unauthenticated_challenge", "mcp_worker_completed", "mcp_worker_capacity_rejected", "mcp_client_capacity_rejected", "mcp_dispatch_failed"]
| stats count(*) as requests,
        avg(message.durationMs) as avgDurationMs,
        pct(message.durationMs, 50) as p50DurationMs,
        pct(message.durationMs, 95) as p95DurationMs,
        max(message.durationMs) as maxDurationMs
  by bin(5m), message.action, message.method, message.statusCode
```

The [dispatcher](../apps/backend/src/entrypoints/lambda-mcp-dispatcher.ts) owns these records:

- `mcp_unauthenticated_challenge`: the dispatcher answered a `/mcp` request without a bearer token with the OAuth 401 challenge itself, without invoking the worker.
- `mcp_worker_completed`: the worker returned a valid proxy response, including 401, 405 and 5xx. `attempts` above 1 means admission throttles were absorbed.
- `mcp_worker_capacity_rejected`: the admission retries were exhausted and the client received 429 for shared worker capacity; the MCP capacity alarm in [`monitoring.ts`](../infra/aws/lib/monitoring.ts) counts only these. The worker's `Throttles` metric also counts absorbed attempts.
- `mcp_client_capacity_rejected`: a 429 before any Invoke, because that bearer token already holds its share of in-flight requests; one client is busy, not the pool.
- `mcp_dispatch_failed`: the dispatcher returned 502, with `phase` naming where.

`durationMs` runs from dispatcher handler entry, admission waits included, so it is an occupancy estimate rather than the worker's post-authentication `mcp_request.durationMs`. Exclude rejected records when estimating worker occupancy, and expect completions with `attempts` above 1 to overstate it. To follow one completion into the worker, join `message.workerRequestId` to the worker's `message.requestId` in `mcp_request` or `agent_sql`. `tokenHashPrefix` identifies an unverified bearer token, not a user.

To tell one busy client from many, group per-token rejections:

```
filter message.action = "mcp_client_capacity_rejected"
| stats count(*) as rejections by message.tokenHashPrefix, message.userAgent
| sort rejections desc
```

## Request mix on the MCP surface

```
filter message.domain = "backend" and message.action = "mcp_request"
| stats count(*) as requests,
        avg(message.responseChars) as avgResponseChars,
        avg(message.durationMs) as avgDurationMs
  by message.method, message.jsonRpcMethod, message.toolName,
     message.protocolVersion, message.caller
| sort requests desc
| limit 20
```

`jsonRpcMethod` is `null` for every client older than MCP revision 2026-07-28, so the split is carried by the other fields: a tool call by `toolName` and `toolExecuted`, an `initialize` or a client sending no `MCP-Protocol-Version` by a missing `protocolVersion`, and a non-POST `method` by the rejected stream attempt above; the remaining protocol traffic shares one unnamed bucket.

## Tool calls refused before the handler

```
filter message.domain = "backend" and message.action = "mcp_request"
       and message.toolExecuted = 0
| stats count(*) as refused by message.toolName, message.caller
| sort refused desc
| limit 20
```

A row here named a tool and never ran one: almost always the SDK answering `-32602` for an unknown tool or arguments its input schema rejects, which is a client or model getting the contract wrong. `statusCode` separates the rarer request that faulted before the handler. Compare against the same tool's executed calls to see whether one client fails systematically.

## Tool calls that returned an error

```
filter message.domain = "backend" and message.action = "mcp_request"
       and message.toolIsError = 1
| stats count(*) as errors
  by message.toolName, message.toolErrorCode, message.caller
| sort errors desc
| limit 20
```

Divide by the same tool's `toolExecuted = 1` count for its failure share. For `sql_query` and `sql_execute`, the `agent_sql` record with the same `requestId` carries the dialect detail.

## Failure share by surface

```
filter message.domain = "backend" and message.action = "agent_sql"
       and message.caller != "nibomo-mcp-smoke/1"
| stats count(*) as executions,
        sum(message.succeeded = 0) as failures,
        sum(message.succeeded = 0) * 100 / count(*) as failureSharePct
  by message.surface
| sort failureSharePct desc
```

Add `, message.caller` to the `by` clause to split the MCP surface per
client.

## Top failure causes

```
filter message.domain = "backend" and message.action = "agent_sql"
       and message.succeeded = 0
       and message.caller != "nibomo-mcp-smoke/1"
| stats count(*) as failures
  by message.surface, message.errorCode, message.dialectReason, message.caller
| sort failures desc
| limit 20
```

## Degraded writes and payload size

```
filter message.domain = "backend" and message.action = "agent_sql"
       and message.succeeded = 1
| stats count(*) as executions,
        sum(message.rowsOmitted = 1) as degradedWrites,
        sum(message.rowsTruncated = 1) as truncatedReads,
        pct(message.resultChars, 50) as p50ResultChars,
        pct(message.resultChars, 90) as p90ResultChars,
        max(message.resultChars) as maxResultChars
  by message.surface
```

A degraded write or a truncated read still succeeded; how the result-size budget shrinks each is in [`resultBudget.ts`](../apps/backend/src/aiTools/agentSql/resultBudget.ts). The `chat-tool` and `chat-sandbox` surfaces apply no envelope budget, so their `resultChars` is `null` and `truncatedReads` is always `0`.
