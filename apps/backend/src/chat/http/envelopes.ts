import {
  buildActiveRun,
  buildConversationEnvelopeFromPaginatedSession,
  buildConversationEnvelopeFromSnapshot,
  type ChatAcceptedConversationEnvelope,
  type ChatConversationEnvelope,
} from "../contract";
import {
  createChatLiveStreamEnvelope,
  type ChatLiveStreamEnvelope,
} from "../live/auth";
import {
  interruptPreparedChatRun,
  type PreparedChatRun,
  type RecoveredPaginatedSession,
} from "../runs";
import {
  listChatMessagesLatest,
  type ChatSessionSnapshot,
} from "../store";
import { HttpError } from "../../shared/errors";
import type { BackendTraceCarrier } from "../../observability/sentry";
import {
  captureUnexpectedChatLiveEnvelopeError,
  createChatResumeContractViolationError,
  logChatResumeContractViolation,
  type ChatResumeDiagnosticsHeaders,
} from "./diagnostics";

export async function resolveLiveCursor(
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

export async function assertRunningSnapshotInvariant(
  request: Request,
  diagnostics: ChatResumeDiagnosticsHeaders,
  requestId: string | null,
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
    requestId,
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
  throw createChatResumeContractViolationError();
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
  throw createChatResumeContractViolationError();
}

export async function buildConversationEnvelopeWithActiveRun(
  snapshot: ChatSessionSnapshot,
  userId: string,
  workspaceId: string,
  requestId: string | null,
  traceContext: BackendTraceCarrier | null,
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
      : await createChatLiveStreamEnvelopeFn(userId, workspaceId, snapshot.sessionId, snapshot.activeRunId, traceContext))
    : null;
  assertRunningLiveStreamInvariant(request, diagnostics, {
    requestId,
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

export async function buildPaginatedConversationEnvelopeWithActiveRun(
  result: RecoveredPaginatedSession,
  userId: string,
  workspaceId: string,
  requestId: string | null,
  traceContext: BackendTraceCarrier | null,
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
    requestId,
    traceContext,
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

export async function buildStartConversationEnvelope(
  params: Readonly<{
    preparedRun: PreparedChatRun;
    snapshot: ChatSessionSnapshot;
    userId: string;
    workspaceId: string;
    requestId: string | null;
    traceContext: BackendTraceCarrier | null;
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
      params.requestId,
      params.traceContext,
      params.createChatLiveStreamEnvelopeFn,
      params.resolveLiveCursorFn,
      params.request,
      params.diagnostics,
      params.listChatMessagesLatestFn,
    );

    // The accepted response mirrors the recovered snapshot at start time. For a
    // newly accepted running turn that snapshot can still omit the current
    // user/assistant items entirely, so clients must not infer current-turn
    // tool usage from historical messages alone.
    return {
      accepted: true,
      ...envelope,
      ...(params.preparedRun.deduplicated ? { deduplicated: true } : {}),
    };
  } catch (error) {
    if (!(error instanceof HttpError)) {
      captureUnexpectedChatLiveEnvelopeError(
        params.request,
        params.requestId,
        params.userId,
        params.workspaceId,
        params.snapshot.sessionId,
        params.snapshot.activeRunId ?? params.preparedRun.runId,
        error,
      );
    }

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

    throw createChatResumeContractViolationError();
  }
}
