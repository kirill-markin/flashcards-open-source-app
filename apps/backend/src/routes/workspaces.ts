import { Hono } from "hono";
import { createWorkspaceForUser, listUserWorkspaces, selectWorkspaceForUser } from "../workspaces";
import { HttpError } from "../errors";
import {
  loadRequestContextFromRequest,
  parseWorkspaceIdParam,
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

export function createWorkspaceRoutes(options: WorkspaceRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/workspaces", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
    const requestId = context.get("requestId");

    try {
      const workspaces = await listUserWorkspaces(requestContext.userId);
      logCloudRouteEvent("workspaces_list", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        selectedWorkspaceId: requestContext.selectedWorkspaceId,
        workspacesCount: workspaces.length,
      }, false);
      return context.json({ workspaces });
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
      const workspace = await createWorkspaceForUser(
        requestContext.userId,
        expectNonEmptyString(body.name, "name"),
      );
      logCloudRouteEvent("workspace_create", {
        requestId,
        route: context.req.path,
        statusCode: 201,
        userId: requestContext.userId,
        workspaceId: workspace.workspaceId,
      }, false);
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
      const workspace = await selectWorkspaceForUser(requestContext.userId, workspaceId);
      logCloudRouteEvent("workspace_select", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
      }, false);
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

  return app;
}
