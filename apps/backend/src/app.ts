import { randomUUID } from "node:crypto";
import { cors } from "hono/cors";
import { Hono, type Handler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticateRequest, AuthError, type AuthTransport } from "./auth";
import {
  createCard,
  getCard,
  listCards,
  listReviewQueue,
  submitReview,
  updateCard,
  type CreateCardInput,
  type EffortLevel,
  type UpdateCardInput,
} from "./cards";
import {
  createDeck,
  listDecks,
  parseCreateDeckInput,
} from "./decks";
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
import {
  getWorkspaceSchedulerSettings,
  updateWorkspaceSchedulerSettings,
  type UpdateWorkspaceSchedulerSettingsInput,
} from "./workspaceSchedulerSettings";
import { CHAT_MODELS } from "./chat/models";
import type { ChatMessage, ChatStreamEvent } from "./chat/types";

type RequestContext = Readonly<{
  userId: string;
  workspaceId: string;
  email: string | null;
  locale: string;
  transport: AuthTransport;
  deviceId: string | null;
}>;

type ChatRequestBody = Readonly<{
  messages: ReadonlyArray<ChatMessage>;
  model: string;
  timezone: string;
}>;

type ChatDiagnosticsStage =
  | "success"
  | "empty_response"
  | "response_not_ok"
  | "missing_reader"
  | "stream_error_event"
  | "fetch_throw"
  | "aborted";

type ChatDiagnosticsBody = Readonly<{
  clientRequestId: string;
  responseRequestId: string | null;
  model: string;
  stage: ChatDiagnosticsStage;
  statusCode: number | null;
  responseContentType: string | null;
  responseContentLength: string | null;
  responseContentEncoding: string | null;
  responseCacheControl: string | null;
  responseAmznRequestId: string | null;
  responseApiGatewayId: string | null;
  responseBodyMissing: boolean;
  chunkCount: number;
  bytesReceived: number;
  lineCount: number;
  nonEmptyLineCount: number;
  parseNullCount: number;
  deltaEventCount: number;
  toolCallEventCount: number;
  errorEventCount: number;
  doneEventCount: number;
  receivedContent: boolean;
  streamEnded: boolean;
  readerMissing: boolean;
  aborted: boolean;
  durationMs: number;
  bufferLength: number;
  errorName: string | null;
  lastEventType: string | null;
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

function expectOptionalNonEmptyString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectNonEmptyString(value, fieldName);
}

function expectNullableNonEmptyString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return expectNonEmptyString(value, fieldName);
}

function expectBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${fieldName} must be a boolean`);
  }

  return value;
}

function expectNumberInRange(
  value: unknown,
  fieldName: string,
  minExclusive: number,
  maxExclusive: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= minExclusive || value >= maxExclusive) {
    throw new HttpError(400, `${fieldName} must be a finite number between ${minExclusive} and ${maxExclusive}`);
  }

  return value;
}

function expectNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${fieldName} must be a non-negative integer`);
  }

  return value;
}

function expectNullableNonNegativeInteger(value: unknown, fieldName: string): number | null {
  if (value === null) {
    return null;
  }

  return expectNonNegativeInteger(value, fieldName);
}

function expectPositiveIntegerArray(value: unknown, fieldName: string): ReadonlyArray<number> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, `${fieldName} must be a non-empty array`);
  }

  const items = value.map((item) => {
    if (typeof item !== "number" || !Number.isInteger(item) || item <= 0 || item >= 1_440) {
      throw new HttpError(400, `${fieldName} must contain positive integer minutes under 1440`);
    }

    return item;
  });

  for (let index = 1; index < items.length; index += 1) {
    if (items[index] <= items[index - 1]) {
      throw new HttpError(400, `${fieldName} must be strictly increasing`);
    }
  }

  return items;
}

function normalizeTags(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "tags must be an array of strings");
  }

  const uniqueTags = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      throw new HttpError(400, "tags must be an array of strings");
    }

    const normalizedTag = item.trim();
    if (normalizedTag !== "") {
      uniqueTags.add(normalizedTag);
    }
  }

  return [...uniqueTags];
}

function expectEffortLevel(value: unknown): EffortLevel {
  if (value === "fast" || value === "medium" || value === "long") {
    return value;
  }

  throw new HttpError(400, "effortLevel must be one of fast, medium, or long");
}

function parseCreateCardInput(value: unknown): CreateCardInput {
  const body = expectRecord(value);

  return {
    frontText: expectNonEmptyString(body.frontText, "frontText"),
    backText: expectNonEmptyString(body.backText, "backText"),
    tags: normalizeTags(body.tags),
    effortLevel: expectEffortLevel(body.effortLevel),
  };
}

function parseUpdateCardInput(value: unknown): UpdateCardInput {
  const body = expectRecord(value);
  const disallowedKeys = [
    "cardId",
    "dueAt",
    "reps",
    "lapses",
    "fsrsCardState",
    "fsrsStepIndex",
    "fsrsStability",
    "fsrsDifficulty",
    "fsrsLastReviewedAt",
    "fsrsScheduledDays",
    "updatedAt",
    "serverVersion",
    "deletedAt",
  ];

  for (const key of disallowedKeys) {
    if (key in body) {
      throw new HttpError(400, `${key} is read-only and cannot be updated`);
    }
  }

  const nextInput: {
    frontText?: string;
    backText?: string;
    tags?: ReadonlyArray<string>;
    effortLevel?: EffortLevel;
  } = {};

  if ("frontText" in body) {
    nextInput.frontText = expectOptionalNonEmptyString(body.frontText, "frontText");
  }

  if ("backText" in body) {
    nextInput.backText = expectOptionalNonEmptyString(body.backText, "backText");
  }

  if ("tags" in body) {
    nextInput.tags = normalizeTags(body.tags);
  }

  if ("effortLevel" in body) {
    nextInput.effortLevel = expectEffortLevel(body.effortLevel);
  }

  if (
    nextInput.frontText === undefined &&
    nextInput.backText === undefined &&
    nextInput.tags === undefined &&
    nextInput.effortLevel === undefined
  ) {
    throw new HttpError(400, "At least one editable field must be provided");
  }

  return nextInput;
}

function parseReviewRating(value: unknown): ReviewRating {
  if (value === 0 || value === 1 || value === 2 || value === 3) {
    return value;
  }

  throw new HttpError(400, "rating must be one of 0, 1, 2, or 3");
}

function parseSubmitReviewInput(value: unknown): Readonly<{
  cardId: string;
  rating: ReviewRating;
  reviewedAtClient: string;
}> {
  const body = expectRecord(value);

  return {
    cardId: expectNonEmptyString(body.cardId, "cardId"),
    rating: parseReviewRating(body.rating),
    reviewedAtClient: expectNonEmptyString(body.reviewedAtClient, "reviewedAtClient"),
  };
}

function parseWorkspaceSchedulerSettingsInput(value: unknown): UpdateWorkspaceSchedulerSettingsInput {
  const body = expectRecord(value);

  return {
    desiredRetention: expectNumberInRange(body.desiredRetention, "desiredRetention", 0, 1),
    learningStepsMinutes: expectPositiveIntegerArray(body.learningStepsMinutes, "learningStepsMinutes"),
    relearningStepsMinutes: expectPositiveIntegerArray(body.relearningStepsMinutes, "relearningStepsMinutes"),
    maximumIntervalDays: expectNonNegativeInteger(body.maximumIntervalDays, "maximumIntervalDays"),
    enableFuzz: expectBoolean(body.enableFuzz, "enableFuzz"),
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

function parseChatMessages(value: unknown): ReadonlyArray<ChatMessage> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "messages must be a non-empty array");
  }

  return value as ReadonlyArray<ChatMessage>;
}

function parseChatRequestBody(value: unknown): ChatRequestBody {
  const body = expectRecord(value);
  const model = expectNonEmptyString(body.model, "model");
  const timezone = expectNonEmptyString(body.timezone, "timezone");

  return {
    messages: parseChatMessages(body.messages),
    model,
    timezone,
  };
}

/**
 * Restricts diagnostics logs to a known set of lifecycle stages so CloudWatch
 * queries stay stable and client payloads remain bounded.
 */
function parseChatDiagnosticsStage(value: unknown): ChatDiagnosticsStage {
  if (
    value === "success" ||
    value === "empty_response" ||
    value === "response_not_ok" ||
    value === "missing_reader" ||
    value === "stream_error_event" ||
    value === "fetch_throw" ||
    value === "aborted"
  ) {
    return value;
  }

  throw new HttpError(400, "stage is invalid");
}

/**
 * Accepts only scalar stream metadata from the browser and rejects any richer
 * payload shape that could accidentally include prompts, content, or files.
 */
function parseChatDiagnosticsBody(value: unknown): ChatDiagnosticsBody {
  const body = expectRecord(value);

  return {
    clientRequestId: expectNonEmptyString(body.clientRequestId, "clientRequestId"),
    responseRequestId: expectNullableNonEmptyString(body.responseRequestId, "responseRequestId"),
    model: expectNonEmptyString(body.model, "model"),
    stage: parseChatDiagnosticsStage(body.stage),
    statusCode: expectNullableNonNegativeInteger(body.statusCode, "statusCode"),
    responseContentType: expectNullableNonEmptyString(body.responseContentType, "responseContentType"),
    responseContentLength: expectNullableNonEmptyString(body.responseContentLength, "responseContentLength"),
    responseContentEncoding: expectNullableNonEmptyString(body.responseContentEncoding, "responseContentEncoding"),
    responseCacheControl: expectNullableNonEmptyString(body.responseCacheControl, "responseCacheControl"),
    responseAmznRequestId: expectNullableNonEmptyString(body.responseAmznRequestId, "responseAmznRequestId"),
    responseApiGatewayId: expectNullableNonEmptyString(body.responseApiGatewayId, "responseApiGatewayId"),
    responseBodyMissing: expectBoolean(body.responseBodyMissing, "responseBodyMissing"),
    chunkCount: expectNonNegativeInteger(body.chunkCount, "chunkCount"),
    bytesReceived: expectNonNegativeInteger(body.bytesReceived, "bytesReceived"),
    lineCount: expectNonNegativeInteger(body.lineCount, "lineCount"),
    nonEmptyLineCount: expectNonNegativeInteger(body.nonEmptyLineCount, "nonEmptyLineCount"),
    parseNullCount: expectNonNegativeInteger(body.parseNullCount, "parseNullCount"),
    deltaEventCount: expectNonNegativeInteger(body.deltaEventCount, "deltaEventCount"),
    toolCallEventCount: expectNonNegativeInteger(body.toolCallEventCount, "toolCallEventCount"),
    errorEventCount: expectNonNegativeInteger(body.errorEventCount, "errorEventCount"),
    doneEventCount: expectNonNegativeInteger(body.doneEventCount, "doneEventCount"),
    receivedContent: expectBoolean(body.receivedContent, "receivedContent"),
    streamEnded: expectBoolean(body.streamEnded, "streamEnded"),
    readerMissing: expectBoolean(body.readerMissing, "readerMissing"),
    aborted: expectBoolean(body.aborted, "aborted"),
    durationMs: expectNonNegativeInteger(body.durationMs, "durationMs"),
    bufferLength: expectNonNegativeInteger(body.bufferLength, "bufferLength"),
    errorName: expectNullableNonEmptyString(body.errorName, "errorName"),
    lastEventType: expectNullableNonEmptyString(body.lastEventType, "lastEventType"),
  };
}

function getInternalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Writes client-side stream diagnostics with the authenticated workspace
 * context so browser failures can be correlated with backend request logs.
 */
function logFrontendChatDiagnostics(requestContext: RequestContext, body: ChatDiagnosticsBody): void {
  const logRecord = {
    domain: "chat",
    vendor: "frontend",
    action: "frontend_diagnostics",
    workspaceId: requestContext.workspaceId,
    transport: requestContext.transport,
    ...body,
  };

  if (body.stage === "success") {
    console.log(JSON.stringify(logRecord));
    return;
  }

  console.error(JSON.stringify(logRecord));
}

/**
 * Keeps chat failures on the SSE transport so the frontend parser sees the
 * same envelope shape for both model and backend exceptions.
 */
function createChatErrorResponse(message: string, requestId: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 500,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Chat-Request-Id": requestId,
    },
  });
}

async function streamChatResponse(
  body: ChatRequestBody,
  requestContext: RequestContext,
  requestId: string,
): Promise<Response> {
  const validModel = CHAT_MODELS.find((model) => model.id === body.model);
  if (validModel === undefined) {
    throw new HttpError(400, `Unknown model: ${body.model}`);
  }

  const envKey = validModel.vendor === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const apiKey = process.env[envKey];
  if (apiKey === undefined || apiKey === "") {
    throw new HttpError(500, `${envKey} environment variable is not set`);
  }

  const agentModule = validModel.vendor === "anthropic"
    ? await import("./chat/anthropic/agent")
    : await import("./chat/openai/agent");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of agentModule.streamAgentResponse({
          messages: body.messages,
          model: body.model,
          requestId,
          workspaceId: requestContext.workspaceId,
          timezone: body.timezone,
        })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === "done") {
            break;
          }
        }
      } catch (error) {
        const message = getInternalErrorMessage(error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message } satisfies ChatStreamEvent)}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Chat-Request-Id": requestId,
    },
  });
}

export function createApp(basePath: string): Hono {
  const app = new Hono();
  const allowedOrigins = getAllowedOrigins();
  const routeMountPaths = getRouteMountPaths(basePath);
  const registerRoute = (
    method: "get" | "post" | "patch" | "put",
    routePath: string,
    handler: Handler,
  ): void => {
    for (const mountPath of routeMountPaths) {
      const fullPath = mountPath === "/" ? routePath : `${mountPath}${routePath}`;
      if (method === "get") {
        app.get(fullPath, handler);
        continue;
      }

      if (method === "post") {
        app.post(fullPath, handler);
        continue;
      }

      if (method === "put") {
        app.put(fullPath, handler);
        continue;
      }

      app.patch(fullPath, handler);
    }
  };

  app.use(
    "*",
    cors({
      origin: allowedOrigins,
      allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "x-csrf-token"],
      exposeHeaders: [
        "cache-control",
        "content-encoding",
        "content-length",
        "content-type",
        "x-amz-apigw-id",
        "x-amzn-requestid",
        "x-chat-request-id",
      ],
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

  registerRoute("get", "/workspace/scheduler-settings", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const schedulerSettings = await getWorkspaceSchedulerSettings(requestContext.workspaceId);
    return context.json({ schedulerSettings });
  });

  registerRoute("put", "/workspace/scheduler-settings", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const input = parseWorkspaceSchedulerSettingsInput(await parseJsonBody(context.req.raw));
    const schedulerSettings = await updateWorkspaceSchedulerSettings(requestContext.workspaceId, input);
    return context.json({ schedulerSettings });
  });

  registerRoute("get", "/cards", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const cards = await listCards(requestContext.workspaceId);
    return context.json({ items: cards });
  });

  registerRoute("get", "/decks", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const decks = await listDecks(requestContext.workspaceId);
    return context.json({ items: decks });
  });

  registerRoute("get", "/cards/:cardId", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const cardId = expectNonEmptyString(context.req.param("cardId"), "cardId");
    const card = await getCard(requestContext.workspaceId, cardId);
    return context.json({ card });
  });

  registerRoute("post", "/cards", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const input = parseCreateCardInput(await parseJsonBody(context.req.raw));
    const card = await createCard(requestContext.workspaceId, input);
    return context.json({ card }, 201);
  });

  registerRoute("post", "/decks", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const input = parseCreateDeckInput(await parseJsonBody(context.req.raw));
    const deck = await createDeck(requestContext.workspaceId, input);
    return context.json({ deck }, 201);
  });

  registerRoute("patch", "/cards/:cardId", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const cardId = expectNonEmptyString(context.req.param("cardId"), "cardId");
    const input = parseUpdateCardInput(await parseJsonBody(context.req.raw));
    const card = await updateCard(requestContext.workspaceId, cardId, input);
    return context.json({ card });
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

  registerRoute("post", "/chat", async (context) => {
    const requestId = randomUUID();

    try {
      const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
      const body = parseChatRequestBody(await parseJsonBody(context.req.raw));
      return await streamChatResponse(body, requestContext, requestId);
    } catch (error) {
      if (error instanceof HttpError || error instanceof AuthError) {
        throw error;
      }

      return createChatErrorResponse(getInternalErrorMessage(error), requestId);
    }
  });

  registerRoute("post", "/chat/diagnostics", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const body = parseChatDiagnosticsBody(await parseJsonBody(context.req.raw));
    logFrontendChatDiagnostics(requestContext, body);
    return new Response(null, { status: 204 });
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
