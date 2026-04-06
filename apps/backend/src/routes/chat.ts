/**
 * Route factory and request parsing for the backend-owned chat surface.
 * These routes accept user turn input, resolve or create server-owned sessions, and schedule persisted runs for asynchronous execution.
 */
import { Hono } from "hono";
import {
  buildActiveRun,
  buildConversationEnvelopeFromPaginatedSession,
  buildConversationEnvelopeFromSnapshot,
  type ChatAcceptedConversationEnvelope,
  type ChatConversationEnvelope,
  type ChatStopResponse,
} from "../chat/contract";
import {
  type ChatComposerSuggestion,
} from "../chat/composerSuggestions";
import { getChatConfig } from "../chat/config";
import {
  getRecoveredChatSessionSnapshot,
  getRecoveredPaginatedSession,
  interruptPreparedChatRun,
  prepareChatRun,
  requestChatRunCancellation,
  type ChatRunStopState,
  type PreparedChatRun,
  type RecoveredPaginatedSession,
} from "../chat/runs";
import {
  ChatSessionConflictError,
  ChatSessionNotFoundError,
  createFreshChatSession,
  getChatSessionId,
  listChatMessagesLatest,
  rolloverToFreshChatSession,
  type ChatSessionSnapshot,
} from "../chat/store";
import { invokeChatWorkerOrPersistFailure } from "../chat/workerInvoke";
import type { AuthTransport } from "../auth";
import { HttpError } from "../errors";
import {
  createChatLiveStreamEnvelope,
  type ChatLiveStreamEnvelope,
} from "../chat/liveAuth";
import {
  loadRequestContextFromRequest,
  requireSelectedWorkspaceId,
  type RequestContext,
} from "../server/requestContext";
import {
  expectNonEmptyString,
  expectRecord,
  expectUuidString,
  parseJsonBody,
} from "../server/requestParsing";
import type { AppEnv } from "../app";
import { logCloudRouteEvent } from "../server/logging";
import { isChatSessionRequestedSessionIdConflictError } from "../chat/errors";

type ChatTextContentPart = Readonly<{
  type: "text";
  text: string;
}>;

type ChatImageContentPart = Readonly<{
  type: "image";
  mediaType: string;
  base64Data: string;
}>;

type ChatFileContentPart = Readonly<{
  type: "file";
  mediaType: string;
  base64Data: string;
  fileName: string;
}>;

type ChatCardContentPart = Readonly<{
  type: "card";
  cardId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: "fast" | "medium" | "long";
}>;

type ChatToolCallContentPart = Readonly<{
  type: "tool_call";
  id: string;
  name: string;
  status: "started" | "completed";
  input: string | null;
  output: string | null;
}>;

export type ChatContentPart =
  | ChatTextContentPart
  | ChatImageContentPart
  | ChatFileContentPart
  | ChatCardContentPart
  | ChatToolCallContentPart;

export type ChatRequestBody = Readonly<{
  sessionId?: string;
  clientRequestId: string;
  content: ReadonlyArray<ChatContentPart>;
  timezone: string;
}>;

type NewChatRequestBody = Readonly<{
  sessionId?: string;
}>;

type StopChatRequestBody = Readonly<{
  sessionId: string;
}>;

type ChatRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  getRecoveredChatSessionSnapshotFn?: typeof getRecoveredChatSessionSnapshot;
  getRecoveredPaginatedSessionFn?: typeof getRecoveredPaginatedSession;
  rolloverToFreshChatSessionFn?: typeof rolloverToFreshChatSession;
  createFreshChatSessionFn?: typeof createFreshChatSession;
  getChatSessionIdFn?: typeof getChatSessionId;
  prepareChatRunFn?: typeof prepareChatRun;
  interruptPreparedChatRunFn?: typeof interruptPreparedChatRun;
  invokeChatWorkerFn?: typeof invokeChatWorkerOrPersistFailure;
  requestChatRunCancellationFn?: typeof requestChatRunCancellation;
  createChatLiveStreamEnvelopeFn?: typeof createChatLiveStreamEnvelope;
  resolveLiveCursorFn?: typeof resolveLiveCursor;
  listChatMessagesLatestFn?: typeof listChatMessagesLatest;
}>;

const chatResumeContractViolationCode = "CHAT_LIVE_RESUME_CONTRACT_VIOLATION";
const chatSessionIdConflictCode = "CHAT_SESSION_ID_CONFLICT";

type ChatResumeDiagnosticsHeaders = Readonly<{
  resumeAttemptId: string | null;
  clientPlatform: string | null;
  clientVersion: string | null;
}>;

const UNSUPPORTED_CHAT_REQUEST_FIELDS = [
  "messages",
  "model",
  "selectedModel",
  "selectedModelId",
  "devicePlatform",
  "chatSessionId",
  "codeInterpreterContainerId",
  "userContext",
  "totalCards",
  "codeInterpreterContainer",
  "vendor",
  "thinking",
  "thinkingLevel",
] as const;

/**
 * Accepts nullable string fields in the new chat request contract without permitting empty strings.
 */
function expectNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return expectNonEmptyString(value, fieldName);
}

function expectString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  return value;
}

/**
 * Parses one content part from the backend-owned chat request contract.
 */
function parseChatContentPart(value: unknown, context: string): ChatContentPart {
  const body = expectRecord(value);
  const type = expectNonEmptyString(body.type, `${context}.type`);

  if (type === "text") {
    return {
      type: "text",
      text: expectNonEmptyString(body.text, `${context}.text`),
    };
  }

  if (type === "image") {
    return {
      type: "image",
      mediaType: expectNonEmptyString(body.mediaType, `${context}.mediaType`),
      base64Data: expectNonEmptyString(body.base64Data, `${context}.base64Data`),
    };
  }

  if (type === "file") {
    return {
      type: "file",
      mediaType: expectNonEmptyString(body.mediaType, `${context}.mediaType`),
      base64Data: expectNonEmptyString(body.base64Data, `${context}.base64Data`),
      fileName: expectNonEmptyString(body.fileName, `${context}.fileName`),
    };
  }

  if (type === "card") {
    const tagsValue = body.tags;
    if (!Array.isArray(tagsValue)) {
      throw new HttpError(400, `${context}.tags must be an array`);
    }

    const effortLevel = expectNonEmptyString(body.effortLevel, `${context}.effortLevel`);
    if (effortLevel !== "fast" && effortLevel !== "medium" && effortLevel !== "long") {
      throw new HttpError(400, `${context}.effortLevel is invalid`);
    }

    return {
      type: "card",
      cardId: expectNonEmptyString(body.cardId, `${context}.cardId`),
      frontText: expectString(body.frontText, `${context}.frontText`),
      backText: expectString(body.backText, `${context}.backText`),
      tags: tagsValue.map((tag, index) => expectNonEmptyString(tag, `${context}.tags[${index}]`)),
      effortLevel,
    };
  }

  if (type === "tool_call") {
    const status = expectNonEmptyString(body.status, `${context}.status`);
    if (status !== "started" && status !== "completed") {
      throw new HttpError(400, `${context}.status is invalid`);
    }

    return {
      type: "tool_call",
      id: expectNonEmptyString(body.id, `${context}.id`),
      name: expectNonEmptyString(body.name, `${context}.name`),
      status,
      input: expectNullableString(body.input ?? null, `${context}.input`),
      output: expectNullableString(body.output ?? null, `${context}.output`),
    };
  }

  throw new HttpError(400, `${context}.type is invalid`);
}

/**
 * Parses the user-supplied content array for a backend-owned chat turn.
 */
function parseChatContentParts(value: unknown, context: string): ReadonlyArray<ChatContentPart> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, `${context} must be a non-empty array`);
  }

  return value.map((part, index) => parseChatContentPart(part, `${context}[${index}]`));
}

/**
 * Rejects request fields that are not part of the backend-owned chat contract.
 */
function assertNoUnsupportedRequestFields(body: Record<string, unknown>): void {
  for (const fieldName of UNSUPPORTED_CHAT_REQUEST_FIELDS) {
    if (fieldName in body) {
      throw new HttpError(400, `Unsupported request field: ${fieldName}`);
    }
  }
}

/**
 * Parses the new backend-owned chat request body that contains only the current turn input.
 */
export function parseChatRequestBody(value: unknown): ChatRequestBody {
  const body = expectRecord(value);
  assertNoUnsupportedRequestFields(body);

  const sessionId = body.sessionId === undefined
    ? undefined
    : expectUuidString(body.sessionId, "sessionId");

  return {
    sessionId,
    clientRequestId: expectNonEmptyString(body.clientRequestId, "clientRequestId"),
    content: parseChatContentParts(body.content, "content"),
    timezone: expectNonEmptyString(body.timezone, "timezone"),
  };
}

/**
 * Parses the request body for creating or resolving a chat session.
 */
export function parseNewChatRequestBody(value: unknown): NewChatRequestBody {
  const body = expectRecord(value);

  return {
    sessionId: body.sessionId === undefined
      ? undefined
      : expectUuidString(body.sessionId, "sessionId"),
  };
}

/**
 * Parses the stop request body for cancelling the active run of a server-owned chat session.
 */
export function parseStopChatRequestBody(value: unknown): StopChatRequestBody {
  const body = expectRecord(value);

  return {
    sessionId: expectUuidString(body.sessionId, "sessionId"),
  };
}

/**
 * Restricts the backend-owned chat surface to human-facing auth transports.
 */
function assertSupportedTransport(requestContext: RequestContext): void {
  const supportedTransports = new Set<AuthTransport>(["bearer", "session", "guest"]);
  if (supportedTransports.has(requestContext.transport)) {
    return;
  }

  throw new HttpError(
    403,
    "This endpoint requires Bearer, session, or guest authentication.",
    "AI_CHAT_V2_HUMAN_AUTH_REQUIRED",
  );
}

function parseOptionalSessionIdQuery(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectUuidString(value, "sessionId");
}

type ChatNewResponse = Readonly<{
  ok: true;
  sessionId: string;
  composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
  chatConfig: ReturnType<typeof getChatConfig>;
}>;

const MAX_CHAT_PAGE_LIMIT = 50;

async function resolveLiveCursor(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<string | null> {
  const page = await listChatMessagesLatest(userId, workspaceId, sessionId, 2);
  const latestMessage = page.messages.length > 0 ? page.messages[page.messages.length - 1]! : null;
  if (latestMessage === null) {
    return null;
  }

  if (latestMessage.state !== "in_progress") {
    return String(latestMessage.itemOrder);
  }

  const previousMessage = page.messages.length > 1 ? page.messages[page.messages.length - 2]! : null;
  return previousMessage === null ? null : String(previousMessage.itemOrder);
}

function readOptionalRequestHeader(request: Request, headerName: string): string | null {
  const value = request.headers.get(headerName);
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? null : trimmedValue;
}

function readChatResumeDiagnosticsHeaders(request: Request): ChatResumeDiagnosticsHeaders {
  return {
    resumeAttemptId: readOptionalRequestHeader(request, "X-Chat-Resume-Attempt-Id"),
    clientPlatform: readOptionalRequestHeader(request, "X-Client-Platform"),
    clientVersion: readOptionalRequestHeader(request, "X-Client-Version"),
  };
}

function logChatResumeContractViolation(
  request: Request,
  diagnostics: ChatResumeDiagnosticsHeaders,
  payload: Record<string, unknown>,
): void {
  logCloudRouteEvent("chat_resume_contract_violation", {
    path: new URL(request.url).pathname,
    method: request.method,
    resumeAttemptId: diagnostics.resumeAttemptId,
    clientPlatform: diagnostics.clientPlatform,
    clientVersion: diagnostics.clientVersion,
    ...payload,
  }, true);
}

async function assertRunningSnapshotInvariant(
  request: Request,
  diagnostics: ChatResumeDiagnosticsHeaders,
  snapshot: ChatSessionSnapshot,
  userId: string,
  workspaceId: string,
  listChatMessagesLatestFn: typeof listChatMessagesLatest,
): Promise<void> {
  if (snapshot.runState !== "running") {
    return;
  }

  const latestMessagesPage = await listChatMessagesLatestFn(userId, workspaceId, snapshot.sessionId, 2);
  const latestAssistantMessage = [...latestMessagesPage.messages].reverse().find((message) => message.role === "assistant") ?? null;
  if (latestAssistantMessage?.state === "in_progress") {
    return;
  }

  logChatResumeContractViolation(request, diagnostics, {
    violationReason: "running_without_in_progress_item",
    requestId: null,
    userId,
    workspaceId,
    sessionId: snapshot.sessionId,
    resolvedLiveCursor: null,
    snapshotRunState: snapshot.runState,
    latestAssistantItemId: latestAssistantMessage?.itemId ?? null,
    latestAssistantItemOrder: latestAssistantMessage?.itemOrder ?? null,
    latestAssistantState: latestAssistantMessage?.state ?? null,
    inProgressAssistantItemId: null,
    inProgressAssistantItemOrder: null,
    terminationReason: null,
  });
  throw new HttpError(500, "Chat live resume contract violation", chatResumeContractViolationCode);
}

function assertRunningLiveStreamInvariant(
  request: Request,
  diagnostics: ChatResumeDiagnosticsHeaders,
  params: Readonly<{
    requestId: string | null;
    userId: string;
    workspaceId: string;
    sessionId: string;
    resolvedLiveCursor: string | null;
    snapshotRunState: string;
    latestAssistantItemId: string | null;
    latestAssistantItemOrder: number | null;
    latestAssistantState: string | null;
    inProgressAssistantItemId: string | null;
    inProgressAssistantItemOrder: number | null;
    liveStream: ChatLiveStreamEnvelope | null;
  }>,
): void {
  if (params.snapshotRunState !== "running" || params.liveStream !== null) {
    return;
  }

  logChatResumeContractViolation(request, diagnostics, {
    violationReason: "missing_live_stream",
    requestId: params.requestId,
    userId: params.userId,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    resolvedLiveCursor: params.resolvedLiveCursor,
    snapshotRunState: params.snapshotRunState,
    latestAssistantItemId: params.latestAssistantItemId,
    latestAssistantItemOrder: params.latestAssistantItemOrder,
    latestAssistantState: params.latestAssistantState,
    inProgressAssistantItemId: params.inProgressAssistantItemId,
    inProgressAssistantItemOrder: params.inProgressAssistantItemOrder,
    terminationReason: null,
  });
  throw new HttpError(500, "Chat live resume contract violation", chatResumeContractViolationCode);
}

async function buildConversationEnvelopeWithActiveRun(
  snapshot: ChatSessionSnapshot,
  userId: string,
  workspaceId: string,
  createChatLiveStreamEnvelopeFn: typeof createChatLiveStreamEnvelope,
  resolveLiveCursorFn: typeof resolveLiveCursor,
  request: Request,
  diagnostics: ChatResumeDiagnosticsHeaders,
  listChatMessagesLatestFn: typeof listChatMessagesLatest,
): Promise<ChatConversationEnvelope> {
  const liveCursor = snapshot.runState === "running"
    ? await resolveLiveCursorFn(userId, workspaceId, snapshot.sessionId)
    : null;
  const latestMessagesPage = snapshot.runState === "running"
    ? await listChatMessagesLatestFn(userId, workspaceId, snapshot.sessionId, 2)
    : null;
  const latestAssistantMessage = latestMessagesPage === null
    ? null
    : [...latestMessagesPage.messages].reverse().find((message) => message.role === "assistant") ?? null;
  const inProgressAssistantMessage = latestMessagesPage === null
    ? null
    : [...latestMessagesPage.messages].reverse().find((message) =>
      message.role === "assistant" && message.state === "in_progress",
    ) ?? null;
  const liveStream = snapshot.runState === "running"
    ? (snapshot.activeRunId === null
      ? null
      : await createChatLiveStreamEnvelopeFn(userId, workspaceId, snapshot.sessionId, snapshot.activeRunId))
    : null;
  assertRunningLiveStreamInvariant(request, diagnostics, {
    requestId: null,
    userId,
    workspaceId,
    sessionId: snapshot.sessionId,
    resolvedLiveCursor: liveCursor,
    snapshotRunState: snapshot.runState,
    latestAssistantItemId: latestAssistantMessage?.itemId ?? null,
    latestAssistantItemOrder: latestAssistantMessage?.itemOrder ?? null,
    latestAssistantState: latestAssistantMessage?.state ?? null,
    inProgressAssistantItemId: inProgressAssistantMessage?.itemId ?? null,
    inProgressAssistantItemOrder: inProgressAssistantMessage?.itemOrder ?? null,
    liveStream,
  });

  if (snapshot.runState !== "running" || liveStream === null) {
    return buildConversationEnvelopeFromSnapshot(snapshot, null);
  }

  return buildConversationEnvelopeFromSnapshot(
    snapshot,
    buildActiveRun(snapshot, liveCursor, liveStream),
  );
}

async function buildPaginatedConversationEnvelopeWithActiveRun(
  result: RecoveredPaginatedSession,
  userId: string,
  workspaceId: string,
  createChatLiveStreamEnvelopeFn: typeof createChatLiveStreamEnvelope,
  resolveLiveCursorFn: typeof resolveLiveCursor,
  request: Request,
  diagnostics: ChatResumeDiagnosticsHeaders,
  listChatMessagesLatestFn: typeof listChatMessagesLatest,
): Promise<ChatConversationEnvelope> {
  const activeEnvelope = await buildConversationEnvelopeWithActiveRun(
    result.snapshot,
    userId,
    workspaceId,
    createChatLiveStreamEnvelopeFn,
    resolveLiveCursorFn,
    request,
    diagnostics,
    listChatMessagesLatestFn,
  );

  return buildConversationEnvelopeFromPaginatedSession(
    result.snapshot,
    result.page,
    activeEnvelope.activeRun,
  );
}

async function buildStartConversationEnvelope(
  params: Readonly<{
    preparedRun: PreparedChatRun;
    snapshot: ChatSessionSnapshot;
    userId: string;
    workspaceId: string;
    createChatLiveStreamEnvelopeFn: typeof createChatLiveStreamEnvelope;
    resolveLiveCursorFn: typeof resolveLiveCursor;
    interruptPreparedChatRunFn: typeof interruptPreparedChatRun;
    request: Request;
    diagnostics: ChatResumeDiagnosticsHeaders;
    listChatMessagesLatestFn: typeof listChatMessagesLatest;
  }>,
): Promise<ChatAcceptedConversationEnvelope> {
  try {
    const envelope = await buildConversationEnvelopeWithActiveRun(
      params.snapshot,
      params.userId,
      params.workspaceId,
      params.createChatLiveStreamEnvelopeFn,
      params.resolveLiveCursorFn,
      params.request,
      params.diagnostics,
      params.listChatMessagesLatestFn,
    );

    return {
      accepted: true,
      ...envelope,
      ...(params.preparedRun.deduplicated ? { deduplicated: true } : {}),
    };
  } catch (error) {
    const runIdToInterrupt = params.snapshot.activeRunId ?? params.preparedRun.runId;
    await params.interruptPreparedChatRunFn(
      params.userId,
      params.workspaceId,
      runIdToInterrupt,
      "AI live stream is unavailable for the active run.",
    );

    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(500, "Chat live resume contract violation", chatResumeContractViolationCode);
  }
}

/**
 * Maps store-layer errors into the HTTP error contract used by the thin chat clients.
 */
function mapStoreError(error: unknown): never {
  if (error instanceof ChatSessionNotFoundError) {
    throw new HttpError(404, error.message);
  }

  if (isChatSessionRequestedSessionIdConflictError(error)) {
    throw new HttpError(
      409,
      "Requested chat session id is already in use.",
      chatSessionIdConflictCode,
    );
  }

  if (error instanceof ChatSessionConflictError) {
    throw new HttpError(
      409,
      "Chat session already has an active response",
      "CHAT_ACTIVE_RUN_IN_PROGRESS",
    );
  }

  throw error;
}

/**
 * Loads request context and enforces the auth transports supported by backend-owned chat.
 */
async function loadSupportedRequestContext(
  request: Request,
  allowedOrigins: ReadonlyArray<string>,
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest,
): Promise<RequestContext> {
  const { requestContext } = await loadRequestContextFromRequestFn(request, allowedOrigins);
  assertSupportedTransport(requestContext);
  return requestContext;
}

/**
 * Mounts the backend-owned `/chat` routes for history, start, new-session, and stop operations.
 */
export function createChatRoutes(options: ChatRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const getRecoveredChatSessionSnapshotFn = options.getRecoveredChatSessionSnapshotFn ?? getRecoveredChatSessionSnapshot;
  const getRecoveredPaginatedSessionFn = options.getRecoveredPaginatedSessionFn ?? getRecoveredPaginatedSession;
  const rolloverToFreshChatSessionFn = options.rolloverToFreshChatSessionFn ?? rolloverToFreshChatSession;
  const createFreshChatSessionFn = options.createFreshChatSessionFn ?? createFreshChatSession;
  const getChatSessionIdFn = options.getChatSessionIdFn ?? getChatSessionId;
  const prepareChatRunFn = options.prepareChatRunFn ?? prepareChatRun;
  const interruptPreparedChatRunFn = options.interruptPreparedChatRunFn ?? interruptPreparedChatRun;
  const invokeChatWorkerFn = options.invokeChatWorkerFn ?? invokeChatWorkerOrPersistFailure;
  const requestChatRunCancellationFn = options.requestChatRunCancellationFn ?? requestChatRunCancellation;
  const createChatLiveStreamEnvelopeFn = options.createChatLiveStreamEnvelopeFn ?? createChatLiveStreamEnvelope;
  const resolveLiveCursorFn = options.resolveLiveCursorFn ?? resolveLiveCursor;
  const listChatMessagesLatestFn = options.listChatMessagesLatestFn ?? listChatMessagesLatest;

  app.get("/chat", async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const sessionId = parseOptionalSessionIdQuery(context.req.query("sessionId") ?? undefined);
    const limitParam = context.req.query("limit") ?? undefined;
    const resumeDiagnostics = readChatResumeDiagnosticsHeaders(context.req.raw);

    if (limitParam !== undefined) {
      const limit = Math.min(Math.max(Number.parseInt(limitParam, 10) || 7, 1), MAX_CHAT_PAGE_LIMIT);
      const beforeParam = context.req.query("before") ?? undefined;
      const beforeCursor = beforeParam !== undefined
        ? Number.parseInt(beforeParam, 10)
        : undefined;
      if (beforeParam !== undefined && (!Number.isSafeInteger(beforeCursor) || (beforeCursor as number) < 0)) {
        throw new HttpError(400, "Invalid before cursor");
      }

      try {
        const result = await getRecoveredPaginatedSessionFn(
          requestContext.userId,
          workspaceId,
          sessionId,
          limit,
          beforeCursor,
        );
        return context.json(await buildPaginatedConversationEnvelopeWithActiveRun(
          result,
          requestContext.userId,
          workspaceId,
          createChatLiveStreamEnvelopeFn,
          resolveLiveCursorFn,
          context.req.raw,
          resumeDiagnostics,
          listChatMessagesLatestFn,
        ));
      } catch (error) {
        return mapStoreError(error);
      }
    }

      try {
        const snapshot = await getRecoveredChatSessionSnapshotFn(
          requestContext.userId,
          workspaceId,
          sessionId,
        );
        await assertRunningSnapshotInvariant(
          context.req.raw,
          resumeDiagnostics,
          snapshot,
          requestContext.userId,
          workspaceId,
          listChatMessagesLatestFn,
        );
        return context.json(await buildConversationEnvelopeWithActiveRun(
          snapshot,
          requestContext.userId,
          workspaceId,
          createChatLiveStreamEnvelopeFn,
          resolveLiveCursorFn,
          context.req.raw,
          resumeDiagnostics,
          listChatMessagesLatestFn,
        ));
      } catch (error) {
        return mapStoreError(error);
      }
  });

  app.post("/chat", async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseChatRequestBody(await parseJsonBody(context.req.raw));
    const resumeDiagnostics = readChatResumeDiagnosticsHeaders(context.req.raw);
    context.header("X-Chat-Request-Id", body.clientRequestId);

    let preparedRun: PreparedChatRun;
    try {
      preparedRun = await prepareChatRunFn(
        requestContext.userId,
        workspaceId,
        body.sessionId,
        body.content,
        body.clientRequestId,
        body.timezone,
      );
    } catch (error) {
      return mapStoreError(error);
    }

    if (preparedRun.shouldInvokeWorker) {
      await invokeChatWorkerFn({
        runId: preparedRun.runId,
        userId: requestContext.userId,
        workspaceId,
      });
    }

    try {
      const snapshot = await getRecoveredChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        preparedRun.sessionId,
      );

      return context.json(await buildStartConversationEnvelope({
        preparedRun,
        snapshot,
        userId: requestContext.userId,
        workspaceId,
        createChatLiveStreamEnvelopeFn,
        resolveLiveCursorFn,
        interruptPreparedChatRunFn,
        request: context.req.raw,
        diagnostics: resumeDiagnostics,
        listChatMessagesLatestFn,
      }));
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.post("/chat/new", async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseNewChatRequestBody(await parseJsonBody(context.req.raw));

    // Preferred modern flow: clients send an explicit client-generated sessionId.
    // When an explicit id is present, this route is idempotent: create exactly
    // that session if it does not exist yet, otherwise return the existing
    // session unchanged. The omitted-sessionId path below stays intentionally
    // preserved for backward compatibility with older clients.
    if (body.sessionId !== undefined) {
      let existingSessionId: string | null;
      try {
        existingSessionId = await getChatSessionIdFn(
          requestContext.userId,
          workspaceId,
          body.sessionId,
        );
      } catch (error) {
        return mapStoreError(error);
      }

      if (existingSessionId === null) {
        try {
          const createdSessionId = await createFreshChatSessionFn(
            requestContext.userId,
            workspaceId,
            body.sessionId,
          );
          const createdSnapshot = await getRecoveredChatSessionSnapshotFn(
            requestContext.userId,
            workspaceId,
            createdSessionId,
          );

          return context.json({
            ok: true,
            sessionId: createdSnapshot.sessionId,
            composerSuggestions: createdSnapshot.composerSuggestions,
            chatConfig: getChatConfig(),
          } satisfies ChatNewResponse);
        } catch (error) {
          return mapStoreError(error);
        }
      }

      try {
        const existingSnapshot = await getRecoveredChatSessionSnapshotFn(
          requestContext.userId,
          workspaceId,
          existingSessionId,
        );

        return context.json({
          ok: true,
          sessionId: existingSnapshot.sessionId,
          composerSuggestions: existingSnapshot.composerSuggestions,
          chatConfig: getChatConfig(),
        } satisfies ChatNewResponse);
      } catch (error) {
        return mapStoreError(error);
      }
    }

    let snapshot: ChatSessionSnapshot;
    try {
      snapshot = await getRecoveredChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        body.sessionId,
      );
    } catch (error) {
      return mapStoreError(error);
    }

    if (snapshot.messages.length === 0 && snapshot.runState === "idle") {
      return context.json({
        ok: true,
        sessionId: snapshot.sessionId,
        composerSuggestions: snapshot.composerSuggestions,
        chatConfig: getChatConfig(),
      } satisfies ChatNewResponse);
    }

    let newSnapshot: ChatSessionSnapshot;
    try {
      const newSessionId = await rolloverToFreshChatSessionFn(
        requestContext.userId,
        workspaceId,
        snapshot.sessionId,
      );
      newSnapshot = await getRecoveredChatSessionSnapshotFn(
        requestContext.userId,
        workspaceId,
        newSessionId,
      );
    } catch (error) {
      return mapStoreError(error);
    }

    return context.json({
      ok: true,
      sessionId: newSnapshot.sessionId,
      composerSuggestions: newSnapshot.composerSuggestions,
      chatConfig: getChatConfig(),
    } satisfies ChatNewResponse);
  });

  app.post("/chat/stop", async (context) => {
    const requestContext = await loadSupportedRequestContext(
      context.req.raw,
      options.allowedOrigins,
      loadRequestContextFromRequestFn,
    );
    const workspaceId = requireSelectedWorkspaceId(requestContext);
    const body = parseStopChatRequestBody(await parseJsonBody(context.req.raw));

    let sessionId: string | null;
    try {
      sessionId = await getChatSessionIdFn(
        requestContext.userId,
        workspaceId,
        body.sessionId,
      );
    } catch (error) {
      return mapStoreError(error);
    }

    if (sessionId === null) {
      return mapStoreError(new ChatSessionNotFoundError(body.sessionId));
    }

    const stopState: ChatRunStopState = await requestChatRunCancellationFn(
      requestContext.userId,
      workspaceId,
      sessionId,
    );

    return context.json({
      sessionId: stopState.sessionId,
      conversationScopeId: stopState.sessionId,
      runId: stopState.runId,
      stopped: stopState.stopped,
      stillRunning: stopState.stillRunning,
    } satisfies ChatStopResponse);
  });

  return app;
}
