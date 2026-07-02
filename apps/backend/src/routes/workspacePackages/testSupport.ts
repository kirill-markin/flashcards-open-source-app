import { Buffer } from "node:buffer";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../../server/app";
import type { RequestContext } from "../../server/requestContext";
import { HttpError } from "../../shared/errors";

export const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
export const cardId = "33333333-3333-4333-8333-333333333333";

export type ErrorResponseBody = Readonly<{
  error: string;
  requestId: string;
  code: string | null;
  details?: unknown;
}>;

export function createRequestContext(): RequestContext {
  return {
    userId: "user-1",
    subjectUserId: "subject-1",
    selectedWorkspaceId: otherWorkspaceId,
    email: "user@example.com",
    locale: "en",
    userSettingsCreatedAt: "2026-06-30T00:00:00.000Z",
    preferences: {
      reviewReactionAnimationsEnabled: true,
    },
    transport: "bearer",
    connectionId: null,
    guestSessionId: null,
    guestPlatform: null,
  };
}

export function createWorkspacePackageZipBytes(): Buffer {
  return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
}

export function createWorkspacePackageTestApp(routes: Hono<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    context.set("clientAppVersion", null);
    context.set("clientPlatform", null);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({
        error: error.message,
        requestId: context.get("requestId"),
        code: error.code,
        ...(error.details === null ? {} : { details: error.details }),
      } satisfies ErrorResponseBody);
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: context.get("requestId"),
      code: "INTERNAL_ERROR",
    } satisfies ErrorResponseBody);
  });
  app.route("/", routes);
  return app;
}
