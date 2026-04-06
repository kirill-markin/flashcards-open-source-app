import { Hono } from "hono";
import { createAgentEnvelope } from "../agentEnvelope";
import {
  createAgentAccountEnvelope,
  createAgentWorkspaceReadyEnvelope,
  createAgentWorkspacesEnvelope,
} from "../agentSetup";
import { executeAgentSql } from "../aiTools/agentSql";
import { loadOpenApiDocument } from "../openapi";
import { parseOptionalCursorQuery, parseRequiredPageLimit } from "../pagination";
import {
  createWorkspaceForApiKeyConnection,
  listUserWorkspacesPageForSelectedWorkspace,
  selectWorkspaceForApiKeyConnection,
} from "../workspaces";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
  requireAgentConnectionId,
  requireAccessibleSelectedWorkspaceId,
} from "../server/requestContext";
import {
  expectNonEmptyString,
  expectRecord,
  parseJsonBody,
} from "../server/requestParsing";
import type { AppEnv } from "../app";

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

function parseSqlBody(value: unknown): Readonly<{ sql: string }> {
  const body = expectRecord(value);
  return {
    sql: expectNonEmptyString(body.sql, "sql"),
  };
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
 * response envelopes, and the `/agent/sql` transport contract. SQL parsing
 * and execution planning live in `apps/backend/src/aiTools/agentSql.ts`.
 */
export function createAgentRoutes(options: AgentRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/agent/openapi.json", async (context) => context.json(loadOpenApiDocument()));
  app.get("/agent/swagger.json", async (context) => context.json(loadOpenApiDocument()));

  app.get("/agent/me", async (context) => {
    const { requestContext } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    return context.json(createAgentAccountEnvelope(context.req.url, requestContext));
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

  app.post("/agent/sql", async (context) => {
    const { requestContext, connectionId } = await loadAgentRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = await requireAccessibleSelectedWorkspaceId(requestContext);
    const body = parseSqlBody(await parseJsonBody(context.req.raw));
    const result = await executeAgentSql({
      userId: requestContext.userId,
      workspaceId,
      selectedWorkspaceId: requestContext.selectedWorkspaceId,
      connectionId,
    }, body.sql);

    return context.json(createAgentEnvelope(context.req.url, result.data, result.instructions));
  });
  return app;
}
