import { Hono } from "hono";
import type { AuthTransport } from "../auth";
import {
  createAgentConnectionListEnvelope,
  createAgentConnectionRevokeEnvelope,
  createAgentWorkspaceReadyEnvelope,
  createAgentWorkspacesEnvelope,
  shouldUseAgentSetupEnvelope,
} from "../agentSetup";
import {
  type AgentApiKeyConnection,
  listAgentApiKeyConnectionsPageForUser,
  revokeAgentApiKeyConnectionForUser,
} from "../agentApiKeys";
import { parseOptionalCursorQuery, parseRequiredPageLimit } from "../pagination";
import {
  createWorkspaceForApiKeyConnection,
  createWorkspaceForUser,
  deleteWorkspaceForUser,
  listUserWorkspacesPageForSelectedWorkspace,
  loadWorkspaceDeletePreviewForUser,
  loadWorkspaceResetProgressPreviewForUser,
  renameWorkspaceForUser,
  resetWorkspaceProgressForUser,
  selectWorkspaceForApiKeyConnection,
  selectWorkspaceForUser,
  type DeleteWorkspaceResult,
  type WorkspaceDeletePreview,
  type ResetWorkspaceProgressResult,
  type WorkspaceResetProgressPreview,
  type WorkspaceSummary,
} from "../workspaces";
import { HttpError } from "../errors";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
  requireAgentConnectionId,
} from "../server/requestContext";
import {
  expectNonEmptyString,
  expectRecord,
  parseJsonBody,
} from "../server/requestParsing";
import {
  logCloudRouteEvent,
  summarizeValidationIssues,
} from "../server/logging";
import type { AppEnv } from "../app";

type WorkspaceRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

type CursorQueryParams = Readonly<{
  cursor: string | null;
  limit: number;
}>;

type WorkspacesPageResponse = Readonly<{
  workspaces: ReadonlyArray<WorkspaceSummary>;
  nextCursor: string | null;
}>;

type WorkspaceDeleteResponse = DeleteWorkspaceResult;

type WorkspaceResetProgressPreviewResponse = WorkspaceResetProgressPreview;

type WorkspaceResetProgressResponse = ResetWorkspaceProgressResult;

type AgentApiKeyConnectionsPageResponse = Readonly<{
  connections: ReadonlyArray<AgentApiKeyConnection>;
  nextCursor: string | null;
  instructions: string;
}>;

function parseCursorQueryParams(request: Request): CursorQueryParams {
  const url = new URL(request.url);
  return {
    cursor: parseOptionalCursorQuery(url.searchParams.get("cursor") ?? undefined, "cursor"),
    limit: parseRequiredPageLimit(url.searchParams.get("limit") ?? undefined, "limit", 100),
  };
}

export function createWorkspaceRoutes(options: WorkspaceRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/workspaces", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const requestId = context.get("requestId");
    const pageInput = parseCursorQueryParams(context.req.raw);

    try {
      const workspacesPage = shouldUseAgentSetupEnvelope(requestContext.transport)
        ? await listUserWorkspacesPageForSelectedWorkspace(
          requestContext.userId,
          requestContext.selectedWorkspaceId,
          pageInput,
        )
        : await listUserWorkspacesPageForSelectedWorkspace(
          requestContext.userId,
          requestContext.selectedWorkspaceId,
          pageInput,
        );
      logCloudRouteEvent("workspaces_list", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        selectedWorkspaceId: requestContext.selectedWorkspaceId,
        workspacesCount: workspacesPage.workspaces.length,
        limit: pageInput.limit,
        hasNextCursor: workspacesPage.nextCursor !== null,
      }, false);
      if (shouldUseAgentSetupEnvelope(requestContext.transport)) {
        return context.json(createAgentWorkspacesEnvelope(
          context.req.url,
          workspacesPage.workspaces,
          workspacesPage.nextCursor,
        ));
      }
      return context.json({
        workspaces: workspacesPage.workspaces,
        nextCursor: workspacesPage.nextCursor,
      } satisfies WorkspacesPageResponse);
    } catch (error) {
      logCloudRouteEvent("workspaces_list_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        selectedWorkspaceId: requestContext.selectedWorkspaceId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const requestId = context.get("requestId");
    const body = expectRecord(await parseJsonBody(context.req.raw));

    try {
      const workspaceName = expectNonEmptyString(body.name, "name");
      const workspace = shouldUseAgentSetupEnvelope(requestContext.transport)
        ? await createWorkspaceForApiKeyConnection(
          requestContext.userId,
          requireAgentConnectionId(requestContext),
          workspaceName,
        )
        : await createWorkspaceForUser(requestContext.userId, workspaceName);
      logCloudRouteEvent("workspace_create", {
        requestId,
        route: context.req.path,
        statusCode: 201,
        userId: requestContext.userId,
        workspaceId: workspace.workspaceId,
      }, false);
      if (shouldUseAgentSetupEnvelope(requestContext.transport)) {
        return context.json(createAgentWorkspaceReadyEnvelope(context.req.url, workspace), 201);
      }
      return context.json({ workspace }, 201);
    } catch (error) {
      logCloudRouteEvent("workspace_create_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/select", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const requestId = context.get("requestId");

    try {
      const workspace = shouldUseAgentSetupEnvelope(requestContext.transport)
        ? await selectWorkspaceForApiKeyConnection(
          requestContext.userId,
          requireAgentConnectionId(requestContext),
          workspaceId,
        )
        : await selectWorkspaceForUser(requestContext.userId, workspaceId);
      logCloudRouteEvent("workspace_select", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
      }, false);
      if (shouldUseAgentSetupEnvelope(requestContext.transport)) {
        return context.json(createAgentWorkspaceReadyEnvelope(context.req.url, workspace));
      }
      return context.json({ workspace });
    } catch (error) {
      logCloudRouteEvent("workspace_select_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/rename", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const requestId = context.get("requestId");
    const body = expectRecord(await parseJsonBody(context.req.raw));

    try {
      const workspaceName = expectNonEmptyString(body.name, "name");
      const workspace = await renameWorkspaceForUser(
        requestContext.userId,
        workspaceId,
        workspaceName,
        requestContext.selectedWorkspaceId,
      );
      logCloudRouteEvent("workspace_rename", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
      }, false);
      return context.json({ workspace });
    } catch (error) {
      logCloudRouteEvent("workspace_rename_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/delete-preview", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const requestId = context.get("requestId");

    try {
      const preview = await loadWorkspaceDeletePreviewForUser(requestContext.userId, workspaceId);
      logCloudRouteEvent("workspace_delete_preview", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        cardsCount: preview.activeCardCount,
      }, false);
      return context.json(preview satisfies WorkspaceDeletePreview);
    } catch (error) {
      logCloudRouteEvent("workspace_delete_preview_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/delete", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const requestId = context.get("requestId");
    const body = expectRecord(await parseJsonBody(context.req.raw));

    if (typeof body.confirmationText !== "string") {
      throw new HttpError(
        400,
        "confirmationText must be a string",
        "WORKSPACE_DELETE_CONFIRMATION_INVALID",
      );
    }

    try {
      const response = await deleteWorkspaceForUser(
        requestContext.userId,
        workspaceId,
        body.confirmationText,
      );
      logCloudRouteEvent("workspace_delete", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        deletedCardsCount: response.deletedCardsCount,
        nextWorkspaceId: response.workspace.workspaceId,
      }, false);
      return context.json(response satisfies WorkspaceDeleteResponse);
    } catch (error) {
      logCloudRouteEvent("workspace_delete_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/reset-progress-preview", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const requestId = context.get("requestId");

    try {
      const preview = await loadWorkspaceResetProgressPreviewForUser(requestContext.userId, workspaceId);
      logCloudRouteEvent("workspace_reset_progress_preview", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        cardsCount: preview.cardsToResetCount,
      }, false);
      return context.json(preview satisfies WorkspaceResetProgressPreviewResponse);
    } catch (error) {
      logCloudRouteEvent("workspace_reset_progress_preview_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.post("/workspaces/:workspaceId/reset-progress", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const requestId = context.get("requestId");
    const body = expectRecord(await parseJsonBody(context.req.raw));

    if (typeof body.confirmationText !== "string") {
      throw new HttpError(
        400,
        "confirmationText must be a string",
        "WORKSPACE_RESET_PROGRESS_CONFIRMATION_INVALID",
      );
    }

    try {
      const response = await resetWorkspaceProgressForUser(
        requestContext.userId,
        workspaceId,
        body.confirmationText,
      );
      logCloudRouteEvent("workspace_reset_progress", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        cardsResetCount: response.cardsResetCount,
      }, false);
      return context.json(response satisfies WorkspaceResetProgressResponse);
    } catch (error) {
      logCloudRouteEvent("workspace_reset_progress_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  app.get("/agent-api-keys", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const pageInput = parseCursorQueryParams(context.req.raw);
    const connectionsPage = await listAgentApiKeyConnectionsPageForUser(requestContext.userId, pageInput);
    return context.json({
      ...createAgentConnectionListEnvelope(connectionsPage.connections),
      nextCursor: connectionsPage.nextCursor,
    } satisfies AgentApiKeyConnectionsPageResponse);
  });

  app.post("/agent-api-keys/:connectionId/revoke", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const connectionId = parseConnectionId(context.req.param("connectionId"));
    const connection = await revokeAgentApiKeyConnectionForUser(requestContext.userId, connectionId);
    return context.json(createAgentConnectionRevokeEnvelope(connection));
  });

  return app;
}

function parseConnectionId(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "connectionId is required", "AGENT_API_KEY_ID_REQUIRED");
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throw new HttpError(400, "connectionId must not be empty", "AGENT_API_KEY_ID_INVALID");
  }

  return trimmedValue;
}

function requireHumanManagedConnectionAccess(transport: AuthTransport): void {
  if (transport === "api_key") {
    throw new HttpError(403, "Agent connections must be managed from a human session", "AGENT_API_KEY_HUMAN_SESSION_REQUIRED");
  }

  if (transport === "guest") {
    throw new HttpError(403, "Sign in with an account before managing workspaces or agent connections.", "ACCOUNT_SIGN_IN_REQUIRED");
  }
}
