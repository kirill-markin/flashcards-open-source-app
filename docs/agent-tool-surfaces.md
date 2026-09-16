# Agent tool surfaces

One tool inventory reaches agents three ways: the MCP server, the in-app chat,
and the Agent REST API. This document records which surface serves what, what
each surface does differently, and where every shared fact actually lives. It
links to source rather than restating it, because the source is what ships.

## The registry is the inventory

`AGENT_TOOL_SPECS` in `apps/backend/src/aiTools/toolRegistry/specs.ts` is the
source of truth: one array, one spec per tool, each carrying the name,
description, input schema, and handler that both tool surfaces use. A spec's
`surfaces` field is membership only — no spec branches on it, and each adapter
registers the specs that list its own surface
(`apps/backend/src/aiTools/toolRegistry/types.ts`).

| Tool | Surfaces |
| --- | --- |
| `sql_query` | MCP, chat |
| `sql_execute` | MCP, chat |
| `list_workspaces` | MCP, chat |
| `get_guide` | MCP, chat |
| `next_review_card` | MCP |
| `reveal_answer` | MCP |
| `submit_review` | MCP |
| `add_generated_image_to_card` | chat only, not a registry spec |

Every workspace-scoped registry spec takes the same optional `workspaceId`
argument; omit it to stay on the surface's selected workspace, which on the chat
is the workspace the session is bound to and on MCP and REST is the connection's
own selection, which can be unset. The REST SQL and review routes take the same
optional `workspaceId` in the JSON body. Every tool on every surface rejects an
unknown argument rather than dropping it.

`add_generated_image_to_card` is not a registry spec. It is declared in
`apps/backend/src/chat/openai/tools/generatedImageToolContract.ts` and appended
to the chat's tool list only for a run whose user is signed in
(`buildOpenAIChatTools` in `apps/backend/src/chat/openai/tools/tools.ts`). Image
generation is chat-only by decision, and extending it to MCP or the Agent REST
API is a planned TODO rather than a dropped idea. The open choice is a
synchronous call that accepts a timeout tail versus an asynchronous worker,
driven by end-to-end provider generation latency for chat card images, measured
on 2026-09-15 over 39 generations in the chat worker Lambda's production logs —
9.4s minimum, 14.3s median, 23.9s at the 95th percentile, 28.4s maximum — against
the MCP gateway's 29-second integration timeout
(`infra/aws/lib/gateways/mcp-gateway.ts`). That is one dated sample rather than a
standing contract; re-measure before deciding.

The chat deliberately has no review tools. A review needs one durable `reviewId`
per learner review, scoped to the authenticated connection, and the chat's
connection id is the constant `"chat-v2"`
(`apps/backend/src/chat/openai/tools/tools.ts`), which cannot scope one the way
an API key connection does. Until that identity is decided, the chat calls the
SQL, workspace, and guide tools only. The review contract itself is
[conversational reviews](conversational-reviews.md).

## REST is not a registry surface

`AgentToolSurface` is `"mcp" | "chat"`. The Agent REST API in
`apps/backend/src/routes/agent.ts` re-implements the same capabilities as HTTP
routes and shares the contract modules — the same guide bodies, the same review
schemas, the same workspace resolver, the same remediation text — but it reads
nothing from the registry. Adding a tool to the registry does not add a REST
route, and adding a REST route does not add a tool. The route list is in
[the Agent API section of the architecture document](architecture.md#agent-api-architecture).

## What differs per surface

Everything a tool *is* lives in the registry. What differs is presentation,
result envelope, and output budget, and each of those stays in its own adapter:

- MCP: display titles, `ToolAnnotations`, and the `anthropic/maxResultSizeChars`
  hint in `MCP_TOOL_PRESENTATION` (`apps/backend/src/mcp/server.ts`). A result is
  the shared `{ ok, data, instructions, docs }` agent envelope
  (`apps/backend/src/agent/envelope.ts`), serialized compactly into one text
  content block.
- Chat: hand-written OpenAI function-tool JSON, compared against each spec's zod
  schema at module load by `requireChatFunctionTool`
  (`apps/backend/src/chat/openai/tools/tools.ts`) — a key-set check over argument
  names and which arguments are required, leaving property types unguarded — and
  a `MAX_TOOL_OUTPUT_CHARS` budget that shrinks an oversized result instead of
  failing it (`apps/backend/src/chat/openai/tools/toolResults.ts`). Its envelope is
  `{ ok, tool, data, instructions }` with no `docs` block, and a failure comes
  back as `{ ok: false }` rather than as a throw, because a thrown tool call
  ends the run.
- REST: the same agent envelope as MCP, built per route against the request URL
  (`apps/backend/src/routes/agent.ts`).

Two invariants are load-bearing and invisible unless you look for them:

- Every spec's input schema must be a strict object, checked at module load by
  `defineAgentTool`, so a misspelled `workspaceId` is rejected on every surface
  instead of being silently dropped and the statement run against the selected
  workspace.
- Every action a surface's tools do not reach is bound to
  `unboundAgentToolAction` (`apps/backend/src/aiTools/toolRegistry/actions.ts`).
  Each adapter names all of them, so omitting one is a type error and a tool
  added to a surface later cannot quietly reach production code around that
  surface's dependencies and its tests' fakes.

## Remediation instructions

Every failing agent call carries "what to do about it" text from one module,
`apps/backend/src/aiTools/toolContract/remediationInstructions.ts`, keyed by
error code. The code decides the *meaning* of a failure and the surface decides
its *wording*; a meaning a surface leaves unworded falls through to that
surface's generic wording, as does a code the module does not know at all.

One trap is worth naming here because it is not visible from that module's
tables: the `/v1/agent-api-keys` connection-management routes split by caller
rather than by route, because the global handler tests the `ApiKey`
Authorization header before the connection-management path. Reordering those two
branches would swap the envelope shape those routes already return to released
`ApiKey` clients. The module's header comment carries the detail.

## Guide topics

Four topics — `sql_dialect`, `card_authoring`, `bulk_authoring`, `review_flow` —
with one body each in `GUIDE_BODIES`
(`apps/backend/src/aiTools/toolContract/sqlToolContract.ts`), served identically
by the `get_guide` tool on MCP and the chat and by `GET /v1/agent/guide/{topic}`.
Each body is composed from the constants the tool descriptions and system
prompts already use rather than restating them.

This document does not list what each topic covers. `GUIDE_TOPIC_DESCRIPTIONS`
is the single source for that, typed as `Record<GuideTopic, string>` so adding,
removing, or renaming a topic is a type error there instead of stale prose here
— which is also how discovery renders its own topic list
(`apps/backend/src/agent/discovery.ts`).

## Error codes a caller can receive

The per-code map and the full remediation text live in the remediation module,
which is keyed by HTTP error code. Four facts are surface-specific enough to
record here:

- `WORKSPACE_NOT_FOUND` (404) is reachable from the chat's SQL tools when the
  model passes a `workspaceId` the account cannot access: the chat's workspace
  resolution reaches `assertUserHasWorkspaceAccess`
  (`apps/backend/src/workspaces/selection.ts`) before any SQL runs. It is the
  only meaning the chat alone words.
- `WORKSPACE_SELECTION_REQUIRED` (409) is reachable on REST and MCP but never on
  the chat, whose tool context always passes the session workspace as the
  selected default, so its resolver never sees none (`buildChatAgentToolContext`
  in `apps/backend/src/chat/openai/tools/tools.ts`, and the same reasoning where
  the remediation module leaves this meaning unworded for the chat).
- `daily_generation_limit_reached` and `monthly_generation_limit_reached`, each
  carrying `limit` and `resetsAt`, are what a caller receives when a generation
  window is exhausted. `GENERATED_CARD_IMAGE_GENERATION_LIMIT_REACHED`
  (`apps/backend/src/chat/cardImages/providerTypes.ts`), raised by the budget
  check in `apps/backend/src/chat/cardImages/generationBudget.ts`, is internal
  and is translated into one of those two before the model sees it; the ceilings
  themselves are in
  [generation ceilings](managed-media-cross-client-smoke.md#generation-ceilings).
- `GENERATED_CARD_IMAGE_CARD_NOT_FOUND` is internal and deliberately not
  caller-facing. It exists only so the chat tool can tell a 404 raised before
  generation from the identical 404 raised after the provider was paid, which
  must keep failing the run (`apps/backend/src/chat/cardImages/operation.ts` and
  `apps/backend/src/chat/openai/tools/tools.ts`). Do not publish it.

The chat's generated-image tool answers the model with `{ ok: false, code, ... }`
instead of throwing, so an expected product outcome leaves the turn alive and the
model able to recover. `sign_in_required`, `limit_reached`, `invalid_arguments`,
`card_not_found`, and the two window-limit codes are returned with a null
`stopReason`: the model sees the result and the turn continues. `run_inactive`
(the reservation status `reserveGeneratedCardImageAttempt` reports) and
`deadline_reached` (the catch branch matching the deadline signal
`createOperationSignals` built) are not. Each carries a non-null `stopReason`
(`ExecutedChatToolCall["stopReason"]`), and on a non-null stop reason
`executeToolCalls` returns without pushing the output into the replay items or
emitting the tool event (`apps/backend/src/chat/openai/loop/modelCall.ts`); the
loop then ends the turn, running its accumulated replay items through
`pruneUnpairedToolReplayItems`, defined in that same module and called from
`apps/backend/src/chat/openai/loop/loop.ts`, so the orphaned call is dropped.
The model never sees those two.

The complete set of these expected-outcome codes, including the day and month
limits and the provider failures, is `executeGeneratedImageToolCall` in
`apps/backend/src/chat/openai/tools/tools.ts` as a whole: some are returned
before its `try`, some from inside it, and the rest from its catch block. An
image result renders no remediation text and carries no `instructions` field the
way a SQL tool result does (`createGeneratedImageErrorResult`, same file). One
code is minted outside that function: `getGeneratedImageToolSafeErrorCode`, also
in that file, turns a transient storage failure into
`MEDIA_ASSET_STORAGE_UNAVAILABLE`, which the catch block returns. That exact
string is already a key of `REST_CODE_INSTRUCTIONS`, the REST-only table in the
remediation module
(`apps/backend/src/aiTools/toolContract/remediationInstructions.ts`), so wording
it for a tool surface later means *moving* it into the shared meaning tables,
never adding an entry beside the REST one: `requireDisjointRemediationTables`
runs at import and throws on a code held by both tables, and every surface then
fails to start.

What that function rethrows instead ends the run rather than reaching the model:
an unknown commit outcome, a lost run claim, an unknown provider or staging
outcome, then a re-check of the run signal (`context.signal?.throwIfAborted()`,
the same call the function already makes before the `try`, placed in the catch
block after those four rethrows and before the `deadline_reached` branch) that
throws the run's abort reason, then a transient database error, and any error it
does not recognize. That position is deliberate in both directions: the re-check
stays below the outcome-unknown rethrows, whose classes exist to carry an
outcome the run must not lose even when it was aborted, and above the deadline
branch, so that when both signals have aborted and the error in hand is the
deadline signal's reason, the run ends as an abort and the runtime executor
finalizes it by its own abort reason — a user cancellation stays cancelled
instead of becoming a deadline interruption
(`apps/backend/src/chat/runtime/executor.ts`).
