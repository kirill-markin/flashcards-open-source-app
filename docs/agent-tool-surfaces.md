# Agent tool surfaces

One tool inventory reaches agents three ways: the MCP server, the in-app chat,
and the Agent REST API. This document says how they combine; every fact it
names lives in the linked source.

## The registry is the inventory

[`AGENT_TOOL_SPECS`](../apps/backend/src/aiTools/toolRegistry/specs.ts) is the
inventory MCP and the chat both register from, each spec listing the surfaces it
belongs to ([`types.ts`](../apps/backend/src/aiTools/toolRegistry/types.ts)).
What a tool is lives in its spec; presentation, result envelope and output
budget stay in each adapter: [`mcp/server.ts`](../apps/backend/src/mcp/server.ts)
on MCP, [`tools.ts`](../apps/backend/src/chat/openai/tools/tools.ts) and
[`toolResults.ts`](../apps/backend/src/chat/openai/tools/toolResults.ts) on the
chat. MCP and REST share the agent envelope
([`envelope.ts`](../apps/backend/src/agent/envelope.ts)).

The chat also sends three tools that are not registry specs, so no other
surface has them:

- `bash` and `view_file`: [`bashToolContract.ts`](../apps/backend/src/chat/openai/tools/bashToolContract.ts)
  and [`viewFileToolContract.ts`](../apps/backend/src/chat/openai/tools/viewFileToolContract.ts)
  say why they stay chat-only. Code a `bash` command runs reaches the SQL tools
  through the sandbox's [SQL bridge](../apps/backend/src/chatSandbox/sqlBridge/)
  (`executeChatSandboxSqlCall` in `tools.ts`).
- `add_generated_image_to_card`: appended by `buildOpenAIChatTools` in `tools.ts`
  for the runs `isGeneratedImageEligibleForWorker`
  ([`chat/worker/index.ts`](../apps/backend/src/chat/worker/index.ts)) admits.
  Funded browser guests additionally require the persisted trial marker and exact authenticated session
  at the provider boundary; see the [browser trial policy](premium-offer.md#browser-guest-ai-trial).
  Image generation is chat-only by decision; extending it to MCP and REST is the
  planned TODO at `generateRunlessCardImage` in
  [`cardImages/operation.ts`](../apps/backend/src/chat/cardImages/operation.ts).

Two things a spec cannot pin differ by surface: the workspace an omitted
`workspaceId` falls back to, and the sync replica a review dedupes within. On
the chat both come from the session, its open workspace and that workspace's
shared AI-chat replica (`buildChatAgentToolContext` in `tools.ts`); on MCP and
REST both come from the agent connection (`AgentReviewReplicaResolver` in
[`agent/reviews.ts`](../apps/backend/src/agent/reviews.ts)).

## REST is not a registry surface

The Agent REST API in [`routes/agent.ts`](../apps/backend/src/routes/agent.ts)
re-implements the same capabilities as HTTP routes over the same contract
modules (guide bodies, review schemas, workspace resolver, remediation text) but
reads nothing from the registry: adding a tool adds no route, and adding a route
adds no tool. The route list is
[the Agent API section of the architecture document](architecture.md#agent-api-architecture).

## Shared contracts

- Remediation text for every failing call, keyed by error code:
  [`remediationInstructions.ts`](../apps/backend/src/aiTools/toolContract/remediationInstructions.ts),
  whose header states the meaning/wording split and the `/v1/agent-api-keys`
  branch order that must not change.
- Guide topics and bodies: `GUIDE_TOPIC_DESCRIPTIONS` and `GUIDE_BODIES` in
  [`sqlToolContract.ts`](../apps/backend/src/aiTools/toolContract/sqlToolContract.ts),
  served by `get_guide` and `GET /v1/agent/guide/{topic}`.
- Reviews: [conversational reviews](conversational-reviews.md).
- Usage limits: `GET_USAGE_LIMITS_TOOL_SPEC` in `specs.ts` and
  [premium entitlements](premium-entitlements.md).

## Error codes a caller can receive

The per-code map is the remediation module above. The chat's generated-image
tool answers with codes and remediation messages of its own:
`executeGeneratedImageToolCall` in `tools.ts` returns expected outcomes to the
model and rethrows what must end the run; its limits are the
[generation ceilings](managed-media-cross-client-smoke.md#generation-ceilings).
The deployed MCP dispatcher's pre-execution throttle is checked by the
[MCP capacity smoke](mcp-capacity-smoke.md).
