import { randomUUID } from "node:crypto";
import { cors } from "hono/cors";
import { Hono, type Handler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticateRequest, AuthError, type AuthTransport } from "./auth";
import { query } from "./db";
import { ensureSyncDevice } from "./devices";
import { HttpError } from "./errors";
import { ensureUserProfile } from "./ensureUser";
import {
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
  getSessionCsrfToken,
  toAuthRequest,
  type RequestAuthInputs,
} from "./requestSecurity";
import {
  parseSyncPullInput,
  parseSyncPushInput,
  processSyncPull,
  processSyncPush,
} from "./sync";
import {
  assertUserHasWorkspaceAccess,
  createWorkspaceForUser,
  listUserWorkspaces,
  selectWorkspaceForUser,
} from "./workspaces";
import type {
  LocalAssistantToolCall,
  LocalChatMessage,
  LocalChatRequestBody,
  LocalChatStreamEvent,
} from "./chat/localTypes";
import { CHAT_MODELS } from "./chat/models";
import type { ChatMessage, ChatStreamEvent } from "./chat/types";

type AppEnv = {
  Variables: {
    requestId: string;
  };
};

type RequestContext = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  email: string | null;
  locale: string;
  transport: AuthTransport;
}>;

type ChatRequestBody = Readonly<{
  messages: ReadonlyArray<ChatMessage>;
  model: string;
  timezone: string;
  deviceId: string;
  appVersion: string;
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
  const userProfile = await ensureUserProfile(auth.userId);

  return {
    userId: userProfile.userId,
    selectedWorkspaceId: userProfile.selectedWorkspaceId,
    email: userProfile.email,
    locale: userProfile.locale,
    transport: auth.transport,
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

function parseWorkspaceIdParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "workspaceId is required", "WORKSPACE_ID_REQUIRED");
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throw new HttpError(400, "workspaceId must not be empty", "WORKSPACE_ID_INVALID");
  }

  return trimmedValue;
}

function requireSelectedWorkspaceId(requestContext: RequestContext): string {
  if (requestContext.selectedWorkspaceId === null) {
    throw new HttpError(
      409,
      "Select a workspace before using this endpoint",
      "WORKSPACE_SELECTION_REQUIRED",
    );
  }

  return requestContext.selectedWorkspaceId;
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
    deviceId: expectNonEmptyString(body.deviceId, "deviceId"),
    appVersion: expectNonEmptyString(body.appVersion, "appVersion"),
  };
}

function parseLocalAssistantToolCall(value: unknown): LocalAssistantToolCall {
  const body = expectRecord(value);

  return {
    toolCallId: expectNonEmptyString(body.toolCallId, "toolCallId"),
    name: expectNonEmptyString(body.name, "name"),
    input: expectNonEmptyString(body.input, "input"),
  };
}

function parseLocalChatMessages(value: unknown): ReadonlyArray<LocalChatMessage> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "messages must be a non-empty array");
  }

  return value.map((messageValue, index) => {
    const body = expectRecord(messageValue);
    const role = expectNonEmptyString(body.role, `messages[${index}].role`);

    if (role === "user") {
      return {
        role: "user",
        content: expectNonEmptyString(body.content, `messages[${index}].content`),
      };
    }

    if (role === "assistant") {
      const toolCallsValue = body.toolCalls;
      const toolCalls = toolCallsValue === undefined
        ? []
        : Array.isArray(toolCallsValue)
        ? toolCallsValue.map(parseLocalAssistantToolCall)
        : (() => {
          throw new HttpError(400, `messages[${index}].toolCalls must be an array`);
        })();

      return {
        role: "assistant",
        content: typeof body.content === "string" ? body.content : "",
        toolCalls,
      };
    }

    if (role === "tool") {
      const outputValue = body.output;
      if (typeof outputValue !== "string") {
        throw new HttpError(400, `messages[${index}].output must be a string`);
      }

      return {
        role: "tool",
        toolCallId: expectNonEmptyString(body.toolCallId, `messages[${index}].toolCallId`),
        name: expectNonEmptyString(body.name, `messages[${index}].name`),
        output: outputValue,
      };
    }

    throw new HttpError(400, `messages[${index}].role is invalid`);
  });
}

function parseLocalChatRequestBody(value: unknown): LocalChatRequestBody {
  const body = expectRecord(value);
  const model = expectNonEmptyString(body.model, "model");
  const timezone = expectNonEmptyString(body.timezone, "timezone");

  return {
    messages: parseLocalChatMessages(body.messages),
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

function logRequestError(
  requestId: string,
  path: string,
  method: string,
  error: AuthError | HttpError | unknown,
): void {
  const baseRecord = {
    domain: "backend",
    action: "request_error",
    requestId,
    path,
    method,
  };

  if (error instanceof AuthError) {
    console.error(JSON.stringify({
      ...baseRecord,
      errorClass: "AuthError",
      statusCode: error.statusCode,
      code: "AUTH_UNAUTHORIZED",
    }));
    return;
  }

  if (error instanceof HttpError) {
    console.error(JSON.stringify({
      ...baseRecord,
      errorClass: "HttpError",
      statusCode: error.statusCode,
      code: error.code,
      details: error.details,
    }));
    return;
  }

  console.error(JSON.stringify({
    ...baseRecord,
    errorClass: error instanceof Error ? error.name : "UnknownError",
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: getInternalErrorMessage(error),
  }));
}

function logCloudRouteEvent(
  action: string,
  payload: Record<string, unknown>,
  isError: boolean,
): void {
  const logger = isError ? console.error : console.log;
  logger(JSON.stringify({
    domain: "backend",
    action,
    ...payload,
  }));
}

function summarizeValidationIssues(error: HttpError | unknown): ReadonlyArray<Readonly<{ path: string; code: string }>> {
  if (!(error instanceof HttpError) || error.details === null) {
    return [];
  }

  return error.details.validationIssues.map((issue) => ({
    path: issue.path,
    code: issue.code,
  }));
}

/**
 * Writes client-side stream diagnostics with the current selected workspace
 * context so browser failures can be correlated with backend request logs.
 */
function logFrontendChatDiagnostics(requestContext: RequestContext, body: ChatDiagnosticsBody): void {
  const logRecord = {
    domain: "chat",
    vendor: "frontend",
    action: "frontend_diagnostics",
    workspaceId: requestContext.selectedWorkspaceId,
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
  workspaceId: string,
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
          workspaceId,
          deviceId: body.deviceId,
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

export async function streamLocalChatResponse(
  body: LocalChatRequestBody,
  requestId: string,
): Promise<Response> {
  const validModel = CHAT_MODELS.find((model) => model.id === body.model && model.vendor === "openai");
  if (validModel === undefined) {
    throw new HttpError(400, `Unknown local chat model: ${body.model}`);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new HttpError(500, "OPENAI_API_KEY environment variable is not set");
  }

  const agentModule = await import("./chat/openai/localAgent");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of agentModule.streamLocalTurn({
          messages: body.messages,
          model: body.model,
          timezone: body.timezone,
        })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === "done" || event.type === "await_tool_results") {
            break;
          }
        }
      } catch (error) {
        const message = getInternalErrorMessage(error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message } satisfies LocalChatStreamEvent)}\n\n`));
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

export function createApp(basePath: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
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
    async (context, next) => {
      const requestId = randomUUID();
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
      selectedWorkspaceId: requestContext.selectedWorkspaceId,
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

  registerRoute("get", "/workspaces", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
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

  registerRoute("post", "/workspaces", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
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

  registerRoute("post", "/workspaces/:workspaceId/select", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
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

  registerRoute("post", "/chat", async (context) => {
    const requestId = randomUUID();

    try {
      const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
      const body = parseChatRequestBody(await parseJsonBody(context.req.raw));
      const workspaceId = requireSelectedWorkspaceId(requestContext);
      await ensureSyncDevice(
        workspaceId,
        requestContext.userId,
        body.deviceId,
        "web",
        body.appVersion,
      );
      return await streamChatResponse(body, workspaceId, requestId);
    } catch (error) {
      if (error instanceof HttpError || error instanceof AuthError) {
        throw error;
      }

      return createChatErrorResponse(getInternalErrorMessage(error), requestId);
    }
  });

  registerRoute("post", "/chat/local-turn", async (context) => {
    const requestId = randomUUID();

    try {
      await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
      const body = parseLocalChatRequestBody(await parseJsonBody(context.req.raw));
      return await streamLocalChatResponse(body, requestId);
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

  registerRoute("post", "/workspaces/:workspaceId/sync/push", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
    const input = parseSyncPushInput(await parseJsonBody(context.req.raw));
    const requestId = context.get("requestId");
    const entityTypes = [...new Set(input.operations.map((operation) => operation.entityType))];

    try {
      const result = await processSyncPush(workspaceId, requestContext.userId, input);
      logCloudRouteEvent("sync_push", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        deviceId: input.deviceId,
        operationsCount: input.operations.length,
        entityTypes,
      }, false);
      return context.json(result);
    } catch (error) {
      logCloudRouteEvent("sync_push_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        deviceId: input.deviceId,
        operationsCount: input.operations.length,
        entityTypes,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  registerRoute("post", "/workspaces/:workspaceId/sync/pull", async (context) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, allowedOrigins);
    const workspaceId = parseWorkspaceIdParam(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
    const input = parseSyncPullInput(await parseJsonBody(context.req.raw));
    const requestId = context.get("requestId");

    try {
      const result = await processSyncPull(workspaceId, requestContext.userId, input);
      logCloudRouteEvent("sync_pull", {
        requestId,
        route: context.req.path,
        statusCode: 200,
        userId: requestContext.userId,
        workspaceId,
        deviceId: input.deviceId,
        afterChangeId: input.afterChangeId,
        nextChangeId: result.nextChangeId,
        changesCount: result.changes.length,
      }, false);
      return context.json(result);
    } catch (error) {
      logCloudRouteEvent("sync_pull_error", {
        requestId,
        route: context.req.path,
        statusCode: error instanceof HttpError ? error.statusCode : 500,
        userId: requestContext.userId,
        workspaceId,
        deviceId: input.deviceId,
        afterChangeId: input.afterChangeId,
        code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
        validationIssues: summarizeValidationIssues(error),
      }, true);
      throw error;
    }
  });

  return app;
}
