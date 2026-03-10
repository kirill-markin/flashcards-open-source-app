import { cors } from "hono/cors";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AuthError } from "./auth";
import { HttpError } from "./errors";
import { createChatRoutes } from "./routes/chat";
import { createCardsRoutes } from "./routes/cards";
import { createSyncRoutes } from "./routes/sync";
import { createSystemRoutes } from "./routes/system";
import { createWorkspaceRoutes } from "./routes/workspaces";
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

function createMountedApp(basePath: string, allowedOrigins: Array<string>): Hono<AppEnv> {
  const app = new Hono<AppEnv>().basePath(basePath);
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

    if (error instanceof AuthError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({
        error: "Authentication failed. Sign in again.",
        requestId,
        code: "AUTH_UNAUTHORIZED",
      });
    }

    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({
        error: error.message,
        requestId,
        code: error.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId,
      code: "INTERNAL_ERROR",
    });
  });

  app.route("/", createSystemRoutes({ allowedOrigins }));
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

  const app = new Hono<AppEnv>();
  for (const routeMountPath of routeMountPaths) {
    app.route("/", createMountedApp(routeMountPath, allowedOrigins));
  }

  return app;
}
