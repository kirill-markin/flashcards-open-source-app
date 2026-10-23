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
  type RecoveredChatSession,
  type RecoveredPaginatedSession,
} from "../runs";
import type { PaginatedChatMessages } from "../store";
import { HttpError } from "../../shared/errors";
import type { BackendTraceCarrier } from "../../observability/sentry";
import {
  captureUnexpectedChatLiveEnvelopeError,
  createChatResumeContractViolationError,
  logChatRunInterruptedLiveStreamUnavailable,
  logChatResumeContractViolation,
  type ChatResumeDiagnosticsHeaders,
} from "./diagnostics";

function resolveLiveCursor(page: PaginatedChatMessages): string | null {
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

function requireLatestMessagesPage(session: RecoveredChatSession): PaginatedChatMessages {
  if (session.latestMessagesPage === null) {
    throw new Error(`Running chat session ${session.snapshot.sessionId} was read without its latest messages page`);
  }

  return session.latestMessagesPage;
}

export function assertRunningSnapshotInvariant(
  request: Request,
  diagnostics: ChatResumeDiagnosticsHeaders,
  requestId: string | null,
  session: RecoveredChatSession,
  userId: string,
  workspaceId: string,
): void {
  const snapshot = session.snapshot;
  if (snapshot.runState !== "running") {
    return;
  }

  const latestMessagesPage = requireLatestMessagesPage(session);
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
  session: RecoveredChatSession,
  userId: string,
  workspaceId: string,
  requestId: string | null,
  traceContext: BackendTraceCarrier | null,
  createChatLiveStreamEnvelopeFn: typeof createChatLiveStreamEnvelope,
  request: Request,
  diagnostics: ChatResumeDiagnosticsHeaders,
): Promise<ChatConversationEnvelope> {
  const snapshot = session.snapshot;
  const latestMessagesPage = snapshot.runState === "running"
    ? requireLatestMessagesPage(session)
    : null;
  const liveCursor = latestMessagesPage === null ? null : resolveLiveCursor(latestMessagesPage);
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
  request: Request,
  diagnostics: ChatResumeDiagnosticsHeaders,
): Promise<ChatConversationEnvelope> {
  const activeEnvelope = await buildConversationEnvelopeWithActiveRun(
    result,
    userId,
    workspaceId,
    requestId,
    traceContext,
    createChatLiveStreamEnvelopeFn,
    request,
    diagnostics,
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
    session: RecoveredChatSession;
    userId: string;
    workspaceId: string;
    requestId: string | null;
    traceContext: BackendTraceCarrier | null;
    createChatLiveStreamEnvelopeFn: typeof createChatLiveStreamEnvelope;
    interruptPreparedChatRunFn: typeof interruptPreparedChatRun;
    request: Request;
    diagnostics: ChatResumeDiagnosticsHeaders;
  }>,
): Promise<ChatAcceptedConversationEnvelope> {
  const snapshot = params.session.snapshot;
  try {
    const envelope = await buildConversationEnvelopeWithActiveRun(
      params.session,
      params.userId,
      params.workspaceId,
      params.requestId,
      params.traceContext,
      params.createChatLiveStreamEnvelopeFn,
      params.request,
      params.diagnostics,
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
        snapshot.sessionId,
        snapshot.activeRunId ?? params.preparedRun.runId,
        error,
      );
    }

    const runIdToInterrupt = snapshot.activeRunId ?? params.preparedRun.runId;
    logChatRunInterruptedLiveStreamUnavailable(
      params.request,
      params.requestId,
      params.userId,
      params.workspaceId,
      snapshot.sessionId,
      runIdToInterrupt,
      error,
    );
    await params.interruptPreparedChatRunFn(
      params.userId,
      params.workspaceId,
      runIdToInterrupt,
    );

    if (error instanceof HttpError) {
      throw error;
    }

    throw createChatResumeContractViolationError();
  }
}
