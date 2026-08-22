# Agent SQL Telemetry

Every agent SQL execution emits exactly one structured CloudWatch record, on
success and on failure alike, so the failure rate of foreign models against our
SQL dialect is measurable.

The record is emitted by `withAgentSqlTelemetry` in
`apps/backend/src/aiTools/agentSql.ts`, which wraps `executeAgentSql`,
`runSqlQuery`, and `runSqlExecute`. It sits below the MCP tool handlers' own
`catch`, which answers with a `CallToolResult` and therefore never reaches
`app.onError`: without this record an MCP dialect rejection produces no
CloudWatch event, no Sentry event, and no Langfuse trace.

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
| `resultChars` | Characters of the emitted agent envelope, as measured against the result-size budget; `null` on failure and on `chat-tool`, which builds no envelope |
| `rowsOmitted` | `true` when a committed write's rows were dropped to fit that budget; `null` on failure |
| `durationMs` | Wall-clock duration of the execution |
| `sqlLength` | Character length of the submitted SQL |
| `sqlFingerprint` | SHA-256 hex digest of the submitted SQL |
| `errorCode` | `HttpError` code on failure, else `null` |
| `dialectReason` | First validation-issue code on failure, else `null` |
| `errorClass` | `error.name` on failure, else `null`; coarse by design, so group failures by `errorCode` and `dialectReason` |

`userId`, `workspaceId`, and the synthetic route `agent-sql/<surface>` come from
the shared observation scope on every record.

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

A write whose result overflowed the budget still succeeds: `sql_execute` drops
the returned rows of the already committed write instead of failing it, so such
an execution is recorded as `succeeded = 1`, with `rowsOmitted = 1` whenever it
had rows to drop. Reads never omit rows; an oversized read fails with
`errorCode = "QUERY_RESULT_TOO_LARGE"`.
`resultChars` is the same measurement the budget enforces, taken on the payload
that was actually emitted, so it is the post-reduction size on a degraded write.

## The MCP caller label

On the MCP surface `caller` is the request `User-Agent`, trimmed and capped at
120 characters, and `null` when the client sends no `User-Agent`.

The `initialize` clientInfo is not used because it is not reachable: the MCP
Lambda runs the transport statelessly (`sessionIdGenerator: undefined` in
`apps/backend/src/entrypoints/lambda-mcp.ts`), so a `tools/call` arrives as its
own HTTP request on a freshly built server that never saw the client's
`initialize`. Reaching clientInfo would mean restructuring the entrypoint into a
session-bearing transport.

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

## Degraded writes and payload size

```
filter domain = "backend" and action = "agent_sql" and succeeded = 1
| stats count(*) as executions,
        sum(rowsOmitted = 1) as degradedWrites,
        pct(resultChars, 50) as p50ResultChars,
        pct(resultChars, 90) as p90ResultChars,
        max(resultChars) as maxResultChars
  by surface
```

`degradedWrites` counts successful writes that answered without their rows. The
percentiles skip the `chat-tool` surface, whose `resultChars` is always `null`.
A write that returned no rows has nothing to drop and is emitted untouched, so
`resultChars` above the 48,000-character budget with `rowsOmitted = 0` is
expected rather than a broken guard.

If a log group renders `succeeded` and `rowsOmitted` as `true`/`false` instead
of `1`/`0`, compare them against `"true"` and `"false"` in the queries above.
