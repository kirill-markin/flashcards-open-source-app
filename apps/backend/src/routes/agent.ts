import {
  nextReviewCard,
  resolveAgentConnectionReviewReplica,
  revealAnswer,
  submitAgentReview,
} from "../agent/reviews";
import {
  makeAgentReviewCardFilter,
  nextReviewCardSchema,
  parseReviewRequest,
  revealAnswerSchema,
  submitReviewSchema,
  REVIEW_FLOW_INSTRUCTIONS,
} from "../agent/reviewContract";
import { Hono } from "hono";
import { createAgentEnvelope } from "../agent/envelope";
import {
  createAgentAccountEnvelope,
  createAgentWorkspaceReadyEnvelope,
  createAgentWorkspacesEnvelope,
  loadAgentWorkspaceReplicaIdForSetup,
} from "../agent/setup";
import { runSqlExecute, runSqlQuery } from "../aiTools/agentSql";
import {
  GET_GUIDE_RESULT_INSTRUCTIONS,
  GUIDE_BODIES,
  GUIDE_TOPICS,
  type GuideTopic,
} from "../aiTools/toolContract/sqlToolContract";
import { USAGE_LIMITS_RESULT_INSTRUCTIONS } from "../aiTools/toolContract/usageToolContract";
import { loadAiUsageStatus } from "../aiUsage";
import { resolveAccountKindForTransport } from "../billing/snapshot";
import { createSourceDiscoveryResponse } from "../shared/sourceDiscovery";
import { parseOptionalCursorQuery, parseRequiredPageLimit } from "../shared/pagination";
import {
  createWorkspaceForApiKeyConnection,
  listUserWorkspacesPageForSelectedWorkspace,
  selectWorkspaceForApiKeyConnection,
} from "../workspaces";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
  requireAgentConnectionId,
  resolveAccessibleAgentWorkspaceId,
} from "../server/requestContext";
import {
  expectNonEmptyString,
  expectRecord,
  expectWorkspaceIdString,
  parseJsonBody,
} from "../server/requestParsing";
import { HttpError } from "../shared/errors";
import type { AppEnv } from "../server/app";

type AgentRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

function parsePageQueryInput(request: Request): Readonly<{
  cursor: string | null;
  limit: number;
}> {
  const url = new URL(request.url);
  return {
    cursor: parseOptionalCursorQuery(url.searchParams.get("cursor") ?? undefined, "cursor"),
    limit: parseRequiredPageLimit(url.searchParams.get("limit") ?? undefined, "limit", 100),
  };
}

/** The review actions document that every argument may be omitted, so a body-less POST is a
 * valid call and must not fail the way an empty body fails request.json(). */
async function parseOptionalJsonBody(request: Request): Promise<unknown> {
  const bodyText = await request.text();
  if (bodyText.trim() === "") {
    return {};
  }

  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

const SQL_BODY_FIELD_NAMES: ReadonlyArray<string> = ["sql", "workspaceId"];

/** `workspaceId` mirrors the sql_query and sql_execute MCP tool argument. Released API clients omit
 * it and stay on the workspace they selected with POST /agent/workspaces/{workspaceId}/select.
 * Unknown fields are rejected like the review routes' strict schema, so a misnamed workspace field
 * fails instead of silently running the statement against the selected workspace. */
function parseSqlBody(value: unknown): Readonly<{
  sql: string;
  workspaceId: string | undefined;
}> {
  const body = expectRecord(value);
  for (const key of Object.keys(body)) {
    if (!SQL_BODY_FIELD_NAMES.includes(key)) {
      throw new HttpError(
        400,
        `Request body contains unsupported field: ${key}. Supported fields: ${SQL_BODY_FIELD_NAMES.join(", ")}`,
      );
    }
  }

  return {
    sql: expectNonEmptyString(body.sql, "sql"),
    workspaceId: body.workspaceId === undefined
      ? undefined
      : expectWorkspaceIdString(body.workspaceId, "workspaceId"),
  };
}

/** The supported topics are static, so an unknown one is a correctable request rather than a
 * missing resource: answer 400 and name the whole list so the caller can retry immediately. */
function parseGuideTopicParam(value: string | undefined): GuideTopic {
  const topic = GUIDE_TOPICS.find((guideTopic) => guideTopic === value);
  if (topic === undefined) {
    throw new HttpError(
      400,
      `Unsupported guide topic: ${value ?? "(missing)"}. Supported topics: ${GUIDE_TOPICS.join(", ")}`,
    );
  }

  return topic;
}

async function loadAgentRequest(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
): Promise<Readonly<{
  requestContext: Awaited<ReturnType<typeof loadRequestContextFromRequest>>["requestContext"];
  connectionId: string;
}>> {
  const { requestContext } = await loadRequestContextFromRequest(request, allowedOrigins);
  const connectionId = requireAgentConnectionId(requestContext);

  return {
    requestContext,
    connectionId,
  };
}

/**
 * External-agent HTTP adapter.
 *
 * This file owns request auth, workspace bootstrap, request-body validation,
 * response envelopes, and the `/agent/sql/query` and `/agent/sql/execute`
 * transport contracts. SQL parsing and execution planning live in
 * `apps/backend/src/aiTools/agentSql.ts`.
 */
export function createAgentRoutes(options: AgentRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/agent/openapi.json", async (context) => context.json(createSourceDiscoveryResponse(context.req.url)));
  app.get("/agent/swagger.json", async (context) => context.json(createSourceDiscoveryResponse(context.req.url)));

  app.get("/agent/me", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const agentWorkspaceReplicaId = await loadAgentWorkspaceReplicaIdForSetup(requestContext);
    return context.json(createAgentAccountEnvelope(context.req.url, requestContext, agentWorkspaceReplicaId));
  });

  /**
   * The REST half of the `get_usage_limits` tool: the same payload, built from the same modules, with
   * the same result instructions. It is account-scoped, so unlike the SQL and review routes it takes
   * no `workspaceId` and resolves no workspace.
   *
   * The account kind comes from the request's own transport rather than from a stored column, the
   * reading `resolveAccountKindForTransport` owns. Every caller that gets past `loadAgentRequest`
   * holds an agent connection and is therefore an account today, but asking the transport keeps that
   * a consequence of who authenticated instead of an assumption this route makes.
   */
  app.get("/agent/usage-limits", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const status = await loadAiUsageStatus(
      requestContext.userId,
      resolveAccountKindForTransport(requestContext.transport),
      new Date(),
    );

    return context.json(createAgentEnvelope(
      context.req.url,
      status,
      USAGE_LIMITS_RESULT_INSTRUCTIONS,
    ));
  });

  app.get("/agent/workspaces", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const pageInput = parsePageQueryInput(context.req.raw);
    const workspacesPage = await listUserWorkspacesPageForSelectedWorkspace(
      requestContext.userId,
      requestContext.selectedWorkspaceId,
      pageInput,
    );

    return context.json(createAgentWorkspacesEnvelope(
      context.req.url,
      workspacesPage.workspaces,
      workspacesPage.nextCursor,
    ));
  });

  app.post("/agent/workspaces", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const workspace = await createWorkspaceForApiKeyConnection(
      requestContext.userId,
      connectionId,
      expectNonEmptyString(body.name, "name"),
    );

    return context.json(createAgentWorkspaceReadyEnvelope(context.req.url, workspace), 201);
  });

  app.post("/agent/workspaces/:workspaceId/select", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const workspace = await selectWorkspaceForApiKeyConnection(requestContext.userId, connectionId, workspaceId);
    return context.json(createAgentWorkspaceReadyEnvelope(context.req.url, workspace));
  });

  app.get("/agent/guide/:topic", async (context) => {
    await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const topic = parseGuideTopicParam(context.req.param("topic"));
    return context.json(createAgentEnvelope(
      context.req.url,
      { topic, guide: GUIDE_BODIES[topic] },
      GET_GUIDE_RESULT_INSTRUCTIONS,
    ));
  });

  app.post("/agent/sql/query", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const body = parseSqlBody(await parseJsonBody(context.req.raw));
    const workspaceId = await resolveAccessibleAgentWorkspaceId(requestContext, body.workspaceId);
    const result = await runSqlQuery({
      userId: requestContext.userId,
      workspaceId,
      selectedWorkspaceId: requestContext.selectedWorkspaceId,
      connectionId,
      surface: "agent-rest",
    }, body.sql, context.req.url);

    return context.json(createAgentEnvelope(context.req.url, result.data, result.instructions));
  });

  app.post("/agent/sql/execute", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const body = parseSqlBody(await parseJsonBody(context.req.raw));
    const workspaceId = await resolveAccessibleAgentWorkspaceId(requestContext, body.workspaceId);
    const result = await runSqlExecute({
      userId: requestContext.userId,
      workspaceId,
      selectedWorkspaceId: requestContext.selectedWorkspaceId,
      connectionId,
      surface: "agent-rest",
    }, body.sql, context.req.url);

    return context.json(createAgentEnvelope(context.req.url, result.data, result.instructions));
  });

  app.post("/agent/reviews/next", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const input = parseReviewRequest(nextReviewCardSchema, await parseOptionalJsonBody(context.req.raw));
    const workspaceId = await resolveAccessibleAgentWorkspaceId(requestContext, input.workspaceId);
    const actor = { userId: requestContext.userId, workspaceId, connectionId };
    const result = await nextReviewCard(actor, makeAgentReviewCardFilter(input));
    return context.json(createAgentEnvelope(context.req.url, result, REVIEW_FLOW_INSTRUCTIONS));
  });

  app.post("/agent/reviews/reveal", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const input = parseReviewRequest(revealAnswerSchema, await parseOptionalJsonBody(context.req.raw));
    const workspaceId = await resolveAccessibleAgentWorkspaceId(requestContext, input.workspaceId);
    const actor = { userId: requestContext.userId, workspaceId, connectionId };
    const result = await revealAnswer(actor, input.cardId);
    return context.json(createAgentEnvelope(context.req.url, result, REVIEW_FLOW_INSTRUCTIONS));
  });

  app.post("/agent/reviews/submit", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const input = parseReviewRequest(submitReviewSchema, await parseOptionalJsonBody(context.req.raw));
    const workspaceId = await resolveAccessibleAgentWorkspaceId(requestContext, input.workspaceId);
    const actor = { userId: requestContext.userId, workspaceId, connectionId };
    const result = await submitAgentReview(actor, input, resolveAgentConnectionReviewReplica, null);
    return context.json(createAgentEnvelope(context.req.url, result, REVIEW_FLOW_INSTRUCTIONS));
  });

  return app;
}
