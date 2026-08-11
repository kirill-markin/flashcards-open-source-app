import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AuthError } from "../../auth";
import {
  createAgentApiKeyErrorEnvelope,
  isAgentApiKeyAuthorizationHeader,
} from "../../agent/envelope";
import { getAuthConfig } from "../../auth/config";
import { createDirectImageIngestionRoutes } from "../../routes/directImageIngestion";
import { createCatalogAdminImageIngestionRoutes } from "../../routes/catalog/adminImageIngestion";
import {
  createPublicHttpErrorDetails,
  HttpError,
} from "../../shared/errors";
import type { AppEnv } from "../appEnv";
import {
  browserCorsAllowHeaders,
  browserCorsExposeHeaders,
  getAllowedBrowserOrigins,
} from "../browserCors";
import {
  getDirectImageIngestionRequestId,
} from "./directImageIngestionRequestTiming";
import { getHttpErrorResponseHeaders } from "../httpErrorResponseHeaders";

function applyHttpErrorResponseHeaders(
  context: Context<AppEnv>,
  error: HttpError,
): void {
  for (const [name, value] of getHttpErrorResponseHeaders(error)) {
    context.header(name, value);
  }
}

function createDirectImageIngestionMountedApp(
  basePath: string,
  allowedOrigins: Array<string>,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>({ strict: false }).basePath(basePath);
  const browserCorsMiddleware = cors({
    origin: allowedOrigins,
    allowMethods: ["POST", "PUT", "OPTIONS"],
    allowHeaders: [...browserCorsAllowHeaders],
    exposeHeaders: [...browserCorsExposeHeaders],
    credentials: true,
  });
  app.use("*", async (context, next) => {
    const requestId =
      getDirectImageIngestionRequestId() ?? crypto.randomUUID();
    context.set("requestId", requestId);
    context.set("clientAppVersion", context.req.header("x-client-version") ?? null);
    context.set("clientPlatform", context.req.header("x-client-platform") ?? null);
    context.header("X-Request-Id", requestId);
    await next();
  });
  app.use("*", browserCorsMiddleware);
  app.onError((error, context) => {
    const requestId = context.get("requestId");
    const apiKeyRequest = isAgentApiKeyAuthorizationHeader(
      context.req.header("authorization"),
    );

    if (error instanceof AuthError) {
      context.status(error.statusCode as ContentfulStatusCode);
      if (apiKeyRequest) {
        return context.json(createAgentApiKeyErrorEnvelope(
          context.req.url,
          "AUTH_UNAUTHORIZED",
          "Authentication failed. Sign in again.",
          error.statusCode,
          requestId,
          undefined,
        ));
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
      const publicDetails = createPublicHttpErrorDetails(error.details);
      if (apiKeyRequest) {
        return context.json(createAgentApiKeyErrorEnvelope(
          context.req.url,
          error.code ?? "REQUEST_FAILED",
          error.message,
          error.statusCode,
          requestId,
          publicDetails ?? undefined,
        ));
      }
      return context.json({
        error: error.message,
        requestId,
        code: error.code,
        ...(publicDetails === null ? {} : { details: publicDetails }),
      });
    }

    context.status(500);
    if (apiKeyRequest) {
      return context.json(createAgentApiKeyErrorEnvelope(
        context.req.url,
        "INTERNAL_ERROR",
        "Request failed. Try again.",
        500,
        requestId,
        undefined,
      ));
    }
    return context.json({
      error: "Request failed. Try again.",
      requestId,
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", createDirectImageIngestionRoutes({ allowedOrigins }));
  app.route("/", createCatalogAdminImageIngestionRoutes({ allowedOrigins }));
  return app;
}

export function createDirectImageIngestionApp(): Hono<AppEnv> {
  getAuthConfig();
  const allowedOrigins = getAllowedBrowserOrigins();
  const app = new Hono<AppEnv>({ strict: false });
  app.route("/", createDirectImageIngestionMountedApp("/", allowedOrigins));
  app.route("/", createDirectImageIngestionMountedApp("/v1", allowedOrigins));
  return app;
}
