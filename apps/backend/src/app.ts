import { cors } from "hono/cors";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AuthError } from "./auth";
import { HttpError } from "./errors";
import { createChatRoutes } from "./routes/chat";
import { createAgentRoutes } from "./routes/agent";
import { createCardsRoutes } from "./routes/cards";
import { createSyncRoutes } from "./routes/sync";
import { createSystemRoutes } from "./routes/system";
import { createWorkspaceRoutes } from "./routes/workspaces";
import {
  createAgentConnectionManagementErrorEnvelope,
  createAgentSetupErrorEnvelope,
} from "./agentSetup";
import { logRequestError } from "./server/logging";
import { getAllowedOrigins } from "./server/requestContext";

export type AppEnv = {
  Variables: {
    requestId: string;
  };
};

export function getRouteMountPaths(basePath: string): ReadonlyArray<string> {
  if (basePath === "") {
    return ["/", "/v1"];
  }

  return [basePath];
}

function usesApiKeyAuthorizationHeader(request: Request): boolean {
  const authorizationHeader = request.headers.get("authorization");
  return authorizationHeader !== null && authorizationHeader.startsWith("ApiKey ");
}

function isAgentConnectionManagementPath(pathname: string): boolean {
  return pathname.endsWith("/agent-api-keys") || pathname.includes("/agent-api-keys/");
}

function createAgentInstructions(code: string | null, statusCode: number): string {
  switch (code) {
    case "AUTH_UNAUTHORIZED":
    case "AGENT_API_KEY_INVALID":
      return "Use a valid non-revoked API key in the Authorization header as: ApiKey $FLASHCARDS_OPEN_SOURCE_API_KEY after exporting it once. If needed, restart from GET /v1/agent.";
    case "AGENT_TOOL_INPUT_INVALID":
      return "Fix the JSON body to match the tool schema. Use error.details.validationIssues paths and messages directly, then retry the same request.";
    case "WORKSPACE_SELECTION_REQUIRED":
      return "Call GET /v1/agent/me, then GET /v1/agent/workspaces?limit=100. A first workspace is auto-provisioned for new users. If data.nextCursor is not null, continue with the same limit and cursor=data.nextCursor. If multiple workspaces exist, select one with POST /v1/agent/workspaces/{workspaceId}/select.";
    case "WORKSPACE_ID_REQUIRED":
    case "WORKSPACE_ID_INVALID":
      return "Provide a valid workspaceId UUID in the request URL, then retry the action.";
  }

  if (statusCode >= 500) {
    return "Retry the same request once. If it fails again, treat it as a server-side error and stop changing the request. Use requestId when debugging.";
  }

  if (statusCode === 404) {
    return "Verify that the referenced resource id exists in the selected workspace, then retry only after correcting the id.";
  }

  if (statusCode >= 400) {
    return "Fix the request using error.message and any error.details.validationIssues, then retry the same request.";
  }

  return "If the issue persists, reload account context from GET /v1/agent/me or restart from GET /v1/agent.";
}

function createAgentConnectionManagementInstructions(code: string | null, statusCode: number): string {
  switch (code) {
    case "AUTH_UNAUTHORIZED":
      return "Sign in with a human browser or mobile session, then retry the connection management request.";
    case "AGENT_API_KEY_HUMAN_SESSION_REQUIRED":
      return "Manage long-lived bot connections from a human browser or mobile session, not from an ApiKey-authenticated bot.";
    case "AGENT_API_KEY_NOT_FOUND":
      return "Reload the connection list with GET /v1/agent-api-keys, then retry revoke with a current connectionId.";
    case "AGENT_API_KEY_ID_REQUIRED":
    case "AGENT_API_KEY_ID_INVALID":
      return "Provide a non-empty connectionId in the request URL, then retry the request.";
  }

  if (statusCode >= 500) {
    return "Retry the same request once. If it fails again, treat it as a server-side error and use requestId when debugging.";
  }

  if (statusCode >= 400) {
    return "Fix the request using the reported error details, then retry the same request.";
  }

  return "Refresh the settings screen and try again.";
}

function createMountedApp(basePath: string, allowedOrigins: Array<string>): Hono<AppEnv> {
  const app = new Hono<AppEnv>({ strict: false }).basePath(basePath);
  app.use(
    "*",
    async (context, next) => {
      const requestId = crypto.randomUUID();
      context.set("requestId", requestId);
      context.header("X-Request-Id", requestId);
      await next();
    },
    cors({
      origin: allowedOrigins,
      allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "x-csrf-token"],
      exposeHeaders: [
        "cache-control",
        "content-encoding",
        "content-length",
        "content-type",
        "x-request-id",
        "x-amz-apigw-id",
        "x-amzn-requestid",
        "x-chat-request-id",
      ],
      credentials: true,
    }),
  );

  app.onError((error, context) => {
    const requestId = context.get("requestId");
    logRequestError(requestId, context.req.path, context.req.method, error);
    const apiKeyRequest = usesApiKeyAuthorizationHeader(context.req.raw);
    const agentConnectionManagementRequest = isAgentConnectionManagementPath(context.req.path);

    if (error instanceof AuthError) {
      context.status(error.statusCode as ContentfulStatusCode);
      if (apiKeyRequest) {
        return context.json(
          createAgentSetupErrorEnvelope(
            context.req.url,
            "AUTH_UNAUTHORIZED",
            "Authentication failed. Sign in again.",
            createAgentInstructions("AUTH_UNAUTHORIZED", error.statusCode),
            requestId,
          ),
        );
      }
      if (agentConnectionManagementRequest) {
        return context.json(
          createAgentConnectionManagementErrorEnvelope(
            "AUTH_UNAUTHORIZED",
            "Authentication failed. Sign in again.",
            createAgentConnectionManagementInstructions("AUTH_UNAUTHORIZED", error.statusCode),
            requestId,
          ),
        );
      }
      return context.json({
        error: "Authentication failed. Sign in again.",
        requestId,
        code: "AUTH_UNAUTHORIZED",
      });
    }

    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      if (apiKeyRequest) {
        return context.json(
          createAgentSetupErrorEnvelope(
            context.req.url,
            error.code ?? "REQUEST_FAILED",
            error.message,
            createAgentInstructions(error.code, error.statusCode),
            requestId,
            error.details ?? undefined,
          ),
        );
      }
      if (agentConnectionManagementRequest) {
        return context.json(
          createAgentConnectionManagementErrorEnvelope(
            error.code ?? "REQUEST_FAILED",
            error.message,
            createAgentConnectionManagementInstructions(error.code, error.statusCode),
            requestId,
          ),
        );
      }
      return context.json({
        error: error.message,
        requestId,
        code: error.code,
      });
    }

    context.status(500);
    if (apiKeyRequest) {
      return context.json(
        createAgentSetupErrorEnvelope(
          context.req.url,
          "INTERNAL_ERROR",
          "Request failed. Try again.",
          createAgentInstructions("INTERNAL_ERROR", 500),
          requestId,
        ),
      );
    }
    if (agentConnectionManagementRequest) {
      return context.json(
        createAgentConnectionManagementErrorEnvelope(
          "INTERNAL_ERROR",
          "Request failed. Try again.",
          createAgentConnectionManagementInstructions("INTERNAL_ERROR", 500),
          requestId,
        ),
      );
    }
    return context.json({
      error: "Request failed. Try again.",
      requestId,
      code: "INTERNAL_ERROR",
    });
  });

  app.route("/", createSystemRoutes({ allowedOrigins }));
  app.route("/", createAgentRoutes({ allowedOrigins }));
  app.route("/", createWorkspaceRoutes({ allowedOrigins }));
  app.route("/", createCardsRoutes({ allowedOrigins }));
  app.route("/", createChatRoutes({ allowedOrigins }));
  app.route("/", createSyncRoutes({ allowedOrigins }));

  return app;
}

export function createApp(basePath: string): Hono<AppEnv> {
  const allowedOrigins = getAllowedOrigins();
  const routeMountPaths = getRouteMountPaths(basePath);
  if (routeMountPaths.length === 1) {
    return createMountedApp(routeMountPaths[0], allowedOrigins);
  }

  const app = new Hono<AppEnv>({ strict: false });
  for (const routeMountPath of routeMountPaths) {
    app.route("/", createMountedApp(routeMountPath, allowedOrigins));
  }

  return app;
}
