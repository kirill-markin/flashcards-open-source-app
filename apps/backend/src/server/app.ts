import { cors } from "hono/cors";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  AuthError,
  authVerificationTemporarilyUnavailableCode,
} from "../auth";
import {
  createAgentApiKeyErrorEnvelope,
  createAgentErrorInstructions,
  isAgentApiKeyAuthorizationHeader,
} from "../agent/envelope";
import { getAuthConfig } from "../auth/config";
import {
  createPublicHttpErrorDetails,
  createPublicHttpErrorMessage,
  HttpError,
  type PublicHttpErrorDetails,
} from "../shared/errors";
import { createChatRoutes } from "../routes/chat";
import { createChatTranscriptionsRoutes } from "../routes/chatTranscriptions";
import { createAgentRoutes } from "../routes/agent";
import { createCardsRoutes } from "../routes/cards";
import { createFeedbackRoutes } from "../routes/feedback";
import { createGlobalSnapshotRoutes, globalSnapshotPath } from "../routes/globalSnapshot";
import { createMediaAssetsRoutes } from "../routes/mediaAssets";
import { createWorkspacePackageRoutes } from "../routes/workspacePackages";
import { createSyncRoutes } from "../routes/sync/index";
import { createSystemRoutes } from "../routes/system";
import { createAdminRoutes } from "../routes/admin";
import { createCatalogAdminRoutes } from "../routes/catalog/admin";
import { createCatalogAdminImageIngestionRoutes } from "../routes/catalog/adminImageIngestion";
import { createCatalogPublicRoutes } from "../routes/catalog/public";
import { createCatalogInstallRoutes } from "../routes/catalog/install";
import { createGuestAuthRoutes } from "../routes/guestAuth";
import { createWorkspaceRoutes } from "../routes/workspaces/index";
import {
  createAgentConnectionManagementErrorEnvelope,
} from "../agent/setup";
import { getGuestAiWeightedMonthlyTokenCap } from "../guestAiQuota/config";
import { logRequestError } from "./logging";
import { getAllowedOrigins } from "./requestContext";
import {
  getConfiguredPublicCatalogCorsOrigins,
  validatePublicUrlConfiguration,
} from "../shared/publicUrls";
import {
  captureBackendException,
  continueBackendTrace,
  createBackendObservationScope,
  normalizeCaughtError,
} from "../observability/sentry";
import { hasReportedBackendException } from "../observability/reporting";
import { getHttpErrorResponseHeaders } from "./httpErrorResponseHeaders";
import {
  browserCorsAllowHeaders,
  browserCorsExposeHeaders,
} from "./browserCors";
import type { AppEnv } from "./appEnv";

export { getHttpErrorResponseHeaders } from "./httpErrorResponseHeaders";
export type { AppEnv } from "./appEnv";

const globalSnapshotCorsAllowHeaders = [
  "content-type",
  "authorization",
  "sentry-trace",
  "baggage",
] as const;
const publicCatalogCorsAllowHeaders = [
  "content-type",
  "sentry-trace",
  "baggage",
  "x-client-platform",
  "x-client-version",
] as const;
const publicCatalogCorsExposeHeaders = [
  "cache-control",
  "content-length",
  "content-type",
  "x-request-id",
  "retry-after",
] as const;
const localPublicCatalogOrigins = [
  "http://localhost:3000",
] as const;

export function getRouteMountPaths(basePath: string): ReadonlyArray<string> {
  if (basePath === "") {
    return ["/", "/v1"];
  }

  return [basePath];
}

export function createPublicHttpErrorBody(error: HttpError, requestId: string): Readonly<{
  error: string;
  requestId: string;
  code: string | null;
  details?: PublicHttpErrorDetails;
}> {
  const publicDetails = createPublicHttpErrorDetails(error.details);
  return {
    error: createPublicHttpErrorMessage(error),
    requestId,
    code: error.code,
    ...(publicDetails === null ? {} : { details: publicDetails }),
  };
}

function isAgentConnectionManagementPath(pathname: string): boolean {
  return pathname.endsWith("/agent-api-keys") || pathname.includes("/agent-api-keys/");
}

export function createAgentInstructions(
  code: string | null,
  statusCode: number,
  requestUrl: string,
): string {
  return createAgentErrorInstructions(code, statusCode, requestUrl);
}

function applyHttpErrorResponseHeaders(
  context: Context<AppEnv>,
  error: HttpError,
): void {
  for (const [name, value] of getHttpErrorResponseHeaders(error)) {
    context.header(name, value);
  }
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

function shouldCaptureRequestFailureException(error: unknown): boolean {
  if (error instanceof AuthError) {
    return false;
  }

  if (error instanceof HttpError) {
    if (error.code === authVerificationTemporarilyUnavailableCode) {
      return false;
    }

    if (error.code === "CHAT_LIVE_RESUME_CONTRACT_VIOLATION") {
      return false;
    }

    return error.statusCode >= 500;
  }

  return true;
}

function isPublicCatalogPath(path: string): boolean {
  return path === "/catalog"
    || path.startsWith("/catalog/")
    || path === "/v1/catalog"
    || path.startsWith("/v1/catalog/");
}

function getPublicCatalogCorsOrigin(origin: string): string | null {
  if (origin === "") {
    return null;
  }

  const allowedOrigins = [
    ...getConfiguredPublicCatalogCorsOrigins(),
    ...localPublicCatalogOrigins,
  ];
  return allowedOrigins.includes(origin) ? origin : null;
}

function createMountedApp(basePath: string, allowedOrigins: Array<string>): Hono<AppEnv> {
  const app = new Hono<AppEnv>({ strict: false }).basePath(basePath);
  const publicCatalogCorsMiddleware = cors({
    origin: (origin) => getPublicCatalogCorsOrigin(origin),
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: [...publicCatalogCorsAllowHeaders],
    exposeHeaders: [...publicCatalogCorsExposeHeaders],
  });
  const browserCorsMiddleware = cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
    allowHeaders: [...browserCorsAllowHeaders],
    exposeHeaders: [...browserCorsExposeHeaders],
    credentials: true,
  });
  app.use("*", async (context, next) => {
    const requestId = crypto.randomUUID();
    context.set("requestId", requestId);
    context.set("clientAppVersion", context.req.header("x-client-version") ?? null);
    context.set("clientPlatform", context.req.header("x-client-platform") ?? null);
    context.header("X-Request-Id", requestId);
    await next();
  });
  app.use("*", async (context, next) => {
    const sentryTrace = context.req.header("sentry-trace") || null;
    const baggage = context.req.header("baggage") || null;
    const traceCarrier = sentryTrace === null && baggage === null
      ? null
      : { sentryTrace, baggage };
    await continueBackendTrace(traceCarrier, async () => {
      await next();
    });
  });
  app.use("*", async (context, next) => {
    if (isPublicCatalogPath(context.req.path)) {
      return publicCatalogCorsMiddleware(context, next);
    }

    await next();
  });
  app.use(globalSnapshotPath, cors({
    origin: "*",
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: [...globalSnapshotCorsAllowHeaders],
    exposeHeaders: ["retry-after"],
  }));
  app.use("*", async (context, next) => {
    if (isPublicCatalogPath(context.req.path)) {
      await next();
      return;
    }

    return browserCorsMiddleware(context, next);
  });

  app.onError((error, context) => {
    const requestId = context.get("requestId");
    logRequestError(requestId, context.req.path, context.req.method, error);
    const normalizedError = normalizeCaughtError(error);
    if (
      hasReportedBackendException(normalizedError) === false
      && shouldCaptureRequestFailureException(error)
    ) {
      captureBackendException({
        action: "request_failed",
        error: normalizedError,
        scope: createBackendObservationScope(
          "backend-api",
          requestId,
          context.req.path,
          context.req.method,
          null,
          null,
          null,
          null,
          null,
          context.get("clientAppVersion"),
          context.get("clientPlatform"),
        ),
        details: {
          statusCode: error instanceof HttpError ? error.statusCode : 500,
          code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
          validationIssues: error instanceof HttpError
            ? (error.details?.validationIssues ?? []).map((issue) => ({
              path: issue.path,
              code: issue.code,
            }))
            : [],
        },
      });
    }
    const apiKeyRequest = isAgentApiKeyAuthorizationHeader(
      context.req.header("authorization"),
    );
    const agentConnectionManagementRequest = isAgentConnectionManagementPath(context.req.path);
    const publicCatalogRequest = isPublicCatalogPath(context.req.path);

    if (error instanceof AuthError) {
      context.status(error.statusCode as ContentfulStatusCode);
      if (publicCatalogRequest) {
        return context.json({
          error: "Authentication failed. Sign in again.",
          requestId,
          code: "AUTH_UNAUTHORIZED",
        });
      }
      if (apiKeyRequest) {
        return context.json(
          createAgentApiKeyErrorEnvelope(
            context.req.url,
            "AUTH_UNAUTHORIZED",
            "Authentication failed. Sign in again.",
            error.statusCode,
            requestId,
            undefined,
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
      applyHttpErrorResponseHeaders(context, error);
      const publicMessage = createPublicHttpErrorMessage(error);
      if (publicCatalogRequest) {
        return context.json(createPublicHttpErrorBody(error, requestId));
      }
      if (apiKeyRequest) {
        return context.json(
          createAgentApiKeyErrorEnvelope(
            context.req.url,
            error.code ?? "REQUEST_FAILED",
            publicMessage,
            error.statusCode,
            requestId,
            createPublicHttpErrorDetails(error.details) ?? undefined,
          ),
        );
      }
      if (agentConnectionManagementRequest) {
        return context.json(
          createAgentConnectionManagementErrorEnvelope(
            error.code ?? "REQUEST_FAILED",
            publicMessage,
            createAgentConnectionManagementInstructions(error.code, error.statusCode),
            requestId,
          ),
        );
      }
      return context.json(createPublicHttpErrorBody(error, requestId));
    }

    context.status(500);
    if (publicCatalogRequest) {
      return context.json({
        error: "Request failed. Try again.",
        requestId,
        code: "INTERNAL_ERROR",
      });
    }
    if (apiKeyRequest) {
      return context.json(
        createAgentApiKeyErrorEnvelope(
          context.req.url,
          "INTERNAL_ERROR",
          "Request failed. Try again.",
          500,
          requestId,
          undefined,
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
  app.route("/", createAdminRoutes({ allowedOrigins }));
  app.route("/", createCatalogAdminRoutes({ allowedOrigins }));
  app.route("/", createCatalogAdminImageIngestionRoutes({ allowedOrigins }));
  app.route("/", createCatalogPublicRoutes({}));
  app.route("/", createCatalogInstallRoutes({ allowedOrigins }));
  app.route("/", createCardsRoutes({ allowedOrigins }));
  app.route("/", createFeedbackRoutes({ allowedOrigins }));
  app.route("/", createWorkspacePackageRoutes({ allowedOrigins }));
  app.route("/", createMediaAssetsRoutes({ allowedOrigins }));
  app.route("/", createGlobalSnapshotRoutes({}));
  app.route("/", createGuestAuthRoutes());
  app.route("/", createChatTranscriptionsRoutes({ allowedOrigins }));
  app.route("/", createChatRoutes({ allowedOrigins }));
  app.route("/", createSyncRoutes({ allowedOrigins }));

  return app;
}

/**
 * Constructs the backend app and validates auth config eagerly so local
 * startup and Lambda cold start both fail closed before serving requests.
 */
export function createApp(basePath: string): Hono<AppEnv> {
  getAuthConfig();
  getGuestAiWeightedMonthlyTokenCap();
  validatePublicUrlConfiguration();
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
