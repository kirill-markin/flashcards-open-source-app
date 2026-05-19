import { Hono } from "hono";
import type { AuthTransport } from "../auth";
import {
  createAgentConnectionListEnvelope,
  createAgentConnectionRevokeEnvelope,
  createAgentWorkspaceReadyEnvelope,
  createAgentWorkspacesEnvelope,
  shouldUseAgentSetupEnvelope,
} from "../agent/setup";
import {
  type AgentApiKeyConnection,
  listAgentApiKeyConnectionsPageForUser,
  revokeAgentApiKeyConnectionForUser,
} from "../agent/apiKeys";
import { parseOptionalCursorQuery, parseRequiredPageLimit } from "../pagination";
import {
  listUserWorkspacesPageForSelectedWorkspace,
  renameWorkspaceForUser,
  selectWorkspaceForApiKeyConnection,
  selectWorkspaceForUser,
  type DeleteWorkspaceResult,
  type WorkspaceDeletePreview,
  type ResetWorkspaceProgressResult,
  type WorkspaceResetProgressPreview,
  type WorkspaceSummary,
} from "../workspaces";
import {
  createWorkspaceForApiKeyConnectionWithObservationScope,
  createWorkspaceForUserWithObservationScope,
} from "../workspaces/create";
import {
  deleteWorkspaceForUserWithObservationScope,
  loadWorkspaceDeletePreviewForUserWithObservationScope,
  loadWorkspaceResetProgressPreviewForUserWithObservationScope,
  resetWorkspaceProgressForUserWithObservationScope,
} from "../workspaces/management";
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
import { createBackendFailureDetails } from "../server/logging";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
  normalizeCaughtError,
  type BackendObservationScope,
} from "../observability/sentry";
import { reportBackendExceptionOrBreadcrumb } from "../observability/reporting";
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

function createWorkspaceRouteScope(
  requestId: string,
  route: string,
  method: string,
  userId: string,
  workspaceId: string | null,
): BackendObservationScope {
  return createBackendObservationScope(
    "backend-api",
    requestId,
    route,
    method,
    userId,
    workspaceId,
    null,
    null,
    null,
  );
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
      addBackendBreadcrumb({
        action: "workspaces_list",
        scope: createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, null),
        details: {
          statusCode: 200,
          selectedWorkspaceId: requestContext.selectedWorkspaceId,
          workspacesCount: workspacesPage.workspaces.length,
          limit: pageInput.limit,
          hasNextCursor: workspacesPage.nextCursor !== null,
        },
      });
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
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, null);
      const details = {
        selectedWorkspaceId: requestContext.selectedWorkspaceId,
        workspacesCount: null,
        limit: pageInput.limit,
        hasNextCursor: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspaces_list_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspaces_list_error", scope, details },
      );
      throw error;
    }
  });

  app.post("/workspaces", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const requestId = context.get("requestId");
    const body = expectRecord(await parseJsonBody(context.req.raw));

    try {
      const workspaceName = expectNonEmptyString(body.name, "name");
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, null);
      const workspace = shouldUseAgentSetupEnvelope(requestContext.transport)
        ? await createWorkspaceForApiKeyConnectionWithObservationScope(
          requestContext.userId,
          requireAgentConnectionId(requestContext),
          workspaceName,
          scope,
        )
        : await createWorkspaceForUserWithObservationScope(requestContext.userId, workspaceName, scope);
      addBackendBreadcrumb({
        action: "workspace_create",
        scope: createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspace.workspaceId),
        details: {
          statusCode: 201,
        },
      });
      if (shouldUseAgentSetupEnvelope(requestContext.transport)) {
        return context.json(createAgentWorkspaceReadyEnvelope(context.req.url, workspace), 201);
      }
      return context.json({ workspace }, 201);
    } catch (error) {
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, null);
      const details = {
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_create_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_create_error", scope, details },
      );
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
      addBackendBreadcrumb({
        action: "workspace_select",
        scope: createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId),
        details: {
          statusCode: 200,
        },
      });
      if (shouldUseAgentSetupEnvelope(requestContext.transport)) {
        return context.json(createAgentWorkspaceReadyEnvelope(context.req.url, workspace));
      }
      return context.json({ workspace });
    } catch (error) {
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_select_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_select_error", scope, details },
      );
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
      addBackendBreadcrumb({
        action: "workspace_rename",
        scope: createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId),
        details: {
          statusCode: 200,
        },
      });
      return context.json({ workspace });
    } catch (error) {
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_rename_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_rename_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/delete-preview", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const requestId = context.get("requestId");

    try {
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const preview = await loadWorkspaceDeletePreviewForUserWithObservationScope(
        requestContext.userId,
        workspaceId,
        scope,
      );
      addBackendBreadcrumb({
        action: "workspace_delete_preview",
        scope,
        details: {
          statusCode: 200,
          cardsCount: preview.activeCardCount,
        },
      });
      return context.json(preview satisfies WorkspaceDeletePreview);
    } catch (error) {
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        cardsCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_delete_preview_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_delete_preview_error", scope, details },
      );
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
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const response = await deleteWorkspaceForUserWithObservationScope(
        requestContext.userId,
        workspaceId,
        body.confirmationText,
        scope,
      );
      addBackendBreadcrumb({
        action: "workspace_delete",
        scope,
        details: {
          statusCode: 200,
          deletedCardsCount: response.deletedCardsCount,
          nextWorkspaceId: response.workspace.workspaceId,
        },
      });
      return context.json(response satisfies WorkspaceDeleteResponse);
    } catch (error) {
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        deletedCardsCount: null,
        nextWorkspaceId: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_delete_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_delete_error", scope, details },
      );
      throw error;
    }
  });

  app.get("/workspaces/:workspaceId/reset-progress-preview", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    requireHumanManagedConnectionAccess(requestContext.transport);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    const requestId = context.get("requestId");

    try {
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const preview = await loadWorkspaceResetProgressPreviewForUserWithObservationScope(
        requestContext.userId,
        workspaceId,
        scope,
      );
      addBackendBreadcrumb({
        action: "workspace_reset_progress_preview",
        scope,
        details: {
          statusCode: 200,
          cardsCount: preview.cardsToResetCount,
        },
      });
      return context.json(preview satisfies WorkspaceResetProgressPreviewResponse);
    } catch (error) {
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        cardsCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_reset_progress_preview_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_reset_progress_preview_error", scope, details },
      );
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
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const response = await resetWorkspaceProgressForUserWithObservationScope(
        requestContext.userId,
        workspaceId,
        body.confirmationText,
        scope,
      );
      addBackendBreadcrumb({
        action: "workspace_reset_progress",
        scope,
        details: {
          statusCode: 200,
          cardsResetCount: response.cardsResetCount,
        },
      });
      return context.json(response satisfies WorkspaceResetProgressResponse);
    } catch (error) {
      const scope = createWorkspaceRouteScope(requestId, context.req.path, context.req.method, requestContext.userId, workspaceId);
      const details = {
        cardsResetCount: null,
        ...createBackendFailureDetails(error),
      };
      reportBackendExceptionOrBreadcrumb(
        error,
        { action: "workspace_reset_progress_error", error: normalizeCaughtError(error), scope, details },
        { action: "workspace_reset_progress_error", scope, details },
      );
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
