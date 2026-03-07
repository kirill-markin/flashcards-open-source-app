import { cors } from "hono/cors";
import { Hono, type Handler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticateRequest, AuthError, type AuthTransport } from "./auth";
import { createCard, listCards, listReviewQueue, submitReview, type CreateCardInput, type SubmitReviewInput } from "./cards";
import { query } from "./db";
import { ensureWebDevice } from "./devices";
import { HttpError } from "./errors";
import { ensureUserAndWorkspace } from "./ensureUser";
import {
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
  getSessionCsrfToken,
  toAuthRequest,
  type RequestAuthInputs,
} from "./requestSecurity";
import type { ReviewRating } from "./schedule";

type RequestContext = Readonly<{
  userId: string;
  workspaceId: string;
  email: string | null;
  locale: string;
  transport: AuthTransport;
  deviceId: string | null;
}>;

function getAllowedOrigins(): Array<string> {
  const raw = process.env.BACKEND_ALLOWED_ORIGINS ?? "http://localhost:3000";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function getRouteMountPaths(basePath: string): ReadonlyArray<string> {
  if (basePath === "") {
    return ["/", "/v1"];
  }

  return [basePath];
}

async function loadRequestContext(requestAuthInputs: RequestAuthInputs): Promise<RequestContext> {
  const auth = await authenticateRequest(toAuthRequest(requestAuthInputs));
  const userWorkspace = await ensureUserAndWorkspace(auth.userId);

  if (auth.transport === "session") {
    const device = await ensureWebDevice(userWorkspace.workspaceId, userWorkspace.userId);
    return {
      userId: userWorkspace.userId,
      workspaceId: userWorkspace.workspaceId,
      email: userWorkspace.email,
      locale: userWorkspace.locale,
      transport: auth.transport,
      deviceId: device.deviceId,
    };
  }

  return {
    userId: userWorkspace.userId,
    workspaceId: userWorkspace.workspaceId,
    email: userWorkspace.email,
    locale: userWorkspace.locale,
    transport: auth.transport,
    deviceId: null,
  };
}

async function loadReviewContext(requestAuthInputs: RequestAuthInputs): Promise<RequestContext> {
  const requestContext = await loadRequestContext(requestAuthInputs);

  if (requestContext.deviceId !== null) {
    return requestContext;
  }

  const device = await ensureWebDevice(requestContext.workspaceId, requestContext.userId);
  return {
    ...requestContext,
    deviceId: device.deviceId,
  };
}

async function loadRequestContextFromRequest(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
): Promise<Readonly<{
  requestAuthInputs: RequestAuthInputs;
  requestContext: RequestContext;
}>> {
  const requestAuthInputs = extractRequestAuthInputs(request);
  const requestContext = await loadRequestContext(requestAuthInputs);

  // Cookie-authenticated browser requests need CSRF validation, while bearer
  // clients keep the existing API contract unchanged.
  if (requestContext.transport === "session") {
    await enforceSessionCsrfProtection(request.method, requestAuthInputs, allowedOrigins);
  }

  return {
    requestAuthInputs,
    requestContext,
  };
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }

  return value as Record<string, unknown>;
}

function expectNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    throw new HttpError(400, `${fieldName} must not be empty`);
  }

  return trimmed;
}

function parseCreateCardInput(value: unknown): CreateCardInput {
  const body = expectRecord(value);

  return {
    frontText: expectNonEmptyString(body.frontText, "frontText"),
    backText: expectNonEmptyString(body.backText, "backText"),
  };
}

function parseReviewRating(value: unknown): ReviewRating {
  if (value === 0 || value === 1 || value === 2 || value === 3) {
    return value;
  }

  throw new HttpError(400, "rating must be one of 0, 1, 2, or 3");
}

function parseSubmitReviewInput(value: unknown): SubmitReviewInput {
  const body = expectRecord(value);

  return {
    cardId: expectNonEmptyString(body.cardId, "cardId"),
    rating: parseReviewRating(body.rating),
    reviewedAtClient: expectNonEmptyString(body.reviewedAtClient, "reviewedAtClient"),
  };
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) {
    return 20;
  }

  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, "limit must be an integer between 1 and 100");
  }

  return limit;
}

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createApp(basePath: string): Hono {
  const app = new Hono();
  const allowedOrigins = getAllowedOrigins();
  const routeMountPaths = getRouteMountPaths(basePath);
  const registerRoute = (
    method: "get" | "post",
    routePath: string,
    handler: Handler,
  ): void => {
    for (const mountPath of routeMountPaths) {
      const fullPath = mountPath === "/" ? routePath : `${mountPath}${routePath}`;
      if (method === "get") {
        app.get(fullPath, handler);
        continue;
      }

      app.post(fullPath, handler);
    }
  };

  app.use(
    "*",
    cors({
      origin: allowedOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "x-csrf-token"],
      credentials: true,
    }),
  );

  app.onError((error, context) => {
    if (error instanceof AuthError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({ error: error.message });
    }

    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({ error: error.message });
    }

    console.error(JSON.stringify({
      domain: "backend",
      action: "request_error",
      message: getInternalErrorMessage(error),
      path: context.req.path,
      method: context.req.method,
    }));

    context.status(500);
    return context.json({ error: getInternalErrorMessage(error) });
  });

  registerRoute("get", "/health", async (context) => {
    const result = await query<Readonly<{ now: Date | string }>>("SELECT now() AS now", []);
    return context.json({
      status: "ok",
      service: "flashcards-open-source-app-backend",
      dbTime: result.rows[0]?.now ?? null,
    });
  });

  registerRoute("get", "/me", async (context) => {
    const { requestAuthInputs, requestContext } = await loadRequestContextFromRequest(
      context.req.raw,
      allowedOrigins,
    );
    return context.json({
      userId: requestContext.userId,
      workspaceId: requestContext.workspaceId,
      authTransport: requestContext.transport,
      csrfToken: requestContext.transport === "session" && requestAuthInputs.sessionToken !== undefined
        ? await getSessionCsrfToken(requestAuthInputs.sessionToken)
        : null,
      profile: {
        email: requestContext.email,
        locale: requestContext.locale,
      },
    });
  });

  registerRoute("get", "/cards", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const cards = await listCards(requestContext.workspaceId);
    return context.json({ items: cards });
  });

  registerRoute("post", "/cards", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const input = parseCreateCardInput(await parseJsonBody(context.req.raw));
    const card = await createCard(requestContext.workspaceId, input);
    return context.json({ card }, 201);
  });

  registerRoute("get", "/review-queue", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const limit = parseLimit(context.req.query("limit"));
    const cards = await listReviewQueue(requestContext.workspaceId, limit);
    return context.json({ items: cards });
  });

  registerRoute("post", "/reviews", async (context) => {
    const requestAuthInputs = extractRequestAuthInputs(context.req.raw);
    const requestContext = await loadReviewContext(requestAuthInputs);
    if (requestContext.transport === "session") {
      await enforceSessionCsrfProtection(context.req.method, requestAuthInputs, allowedOrigins);
    }
    const input = parseSubmitReviewInput(await parseJsonBody(context.req.raw));
    const result = await submitReview(requestContext.workspaceId, requestContext.deviceId!, input);
    return context.json(result);
  });

  registerRoute("post", "/sync/push", async (context) => {
    await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    return context.json({ error: "Sync push is not implemented yet" }, 501);
  });

  registerRoute("post", "/sync/pull", async (context) => {
    await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    return context.json({ error: "Sync pull is not implemented yet" }, 501);
  });

  return app;
}
