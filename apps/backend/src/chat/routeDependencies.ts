import type { AuthTransport } from "../auth";
import { HttpError } from "../errors";
import {
  loadRequestContextFromRequest,
  resolveAccessibleChatWorkspaceId,
  type RequestContext,
  type WorkspaceRequestContext,
} from "../server/requestContext";
import { createChatLiveStreamEnvelope } from "./liveAuth";
import {
  getRecoveredChatSessionSnapshot,
  getRecoveredPaginatedSession,
  interruptPreparedChatRun,
  prepareChatRun,
  requestChatRunCancellation,
} from "./runs";
import {
  createFreshChatSession,
  getChatSessionId,
  listChatMessagesLatest,
  rolloverToFreshChatSession,
} from "./store";
import { invokeChatWorkerOrPersistFailure } from "./workerInvoke";
import { resolveLiveCursor } from "./routeEnvelopes";

export type ChatRoutesOptions = Readonly<{
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
  resolveAccessibleChatWorkspaceIdFn?: typeof resolveAccessibleChatWorkspaceId;
}>;

export type ChatRouteDependencies = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  getRecoveredChatSessionSnapshotFn: typeof getRecoveredChatSessionSnapshot;
  getRecoveredPaginatedSessionFn: typeof getRecoveredPaginatedSession;
  rolloverToFreshChatSessionFn: typeof rolloverToFreshChatSession;
  createFreshChatSessionFn: typeof createFreshChatSession;
  getChatSessionIdFn: typeof getChatSessionId;
  prepareChatRunFn: typeof prepareChatRun;
  interruptPreparedChatRunFn: typeof interruptPreparedChatRun;
  invokeChatWorkerFn: typeof invokeChatWorkerOrPersistFailure;
  requestChatRunCancellationFn: typeof requestChatRunCancellation;
  createChatLiveStreamEnvelopeFn: typeof createChatLiveStreamEnvelope;
  resolveLiveCursorFn: typeof resolveLiveCursor;
  listChatMessagesLatestFn: typeof listChatMessagesLatest;
  resolveAccessibleChatWorkspaceIdFn: typeof resolveAccessibleChatWorkspaceId;
}>;

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

export function createChatRouteDependencies(options: ChatRoutesOptions): ChatRouteDependencies {
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const resolveAccessibleChatWorkspaceIdFn = options.resolveAccessibleChatWorkspaceIdFn
    ?? (options.loadRequestContextFromRequestFn === undefined
      ? resolveAccessibleChatWorkspaceId
      : async (requestContext: WorkspaceRequestContext, explicitWorkspaceId: string | undefined): Promise<string> => {
        if (explicitWorkspaceId !== undefined) {
          return explicitWorkspaceId;
        }

        // Route tests often stub request context directly and do not exercise
        // the real workspace access path, so keep a minimal local fallback.
        // Legacy fallback for released AI clients that still omit workspaceId.
        // TODO: Remove this fallback once every supported AI client sends workspaceId.
        if (requestContext.selectedWorkspaceId === null) {
          throw new HttpError(
            409,
            "Select a workspace before using this endpoint",
            "WORKSPACE_SELECTION_REQUIRED",
          );
        }

        return requestContext.selectedWorkspaceId;
      });

  return {
    allowedOrigins: options.allowedOrigins,
    loadRequestContextFromRequestFn,
    getRecoveredChatSessionSnapshotFn: options.getRecoveredChatSessionSnapshotFn ?? getRecoveredChatSessionSnapshot,
    getRecoveredPaginatedSessionFn: options.getRecoveredPaginatedSessionFn ?? getRecoveredPaginatedSession,
    rolloverToFreshChatSessionFn: options.rolloverToFreshChatSessionFn ?? rolloverToFreshChatSession,
    createFreshChatSessionFn: options.createFreshChatSessionFn ?? createFreshChatSession,
    getChatSessionIdFn: options.getChatSessionIdFn ?? getChatSessionId,
    prepareChatRunFn: options.prepareChatRunFn ?? prepareChatRun,
    interruptPreparedChatRunFn: options.interruptPreparedChatRunFn ?? interruptPreparedChatRun,
    invokeChatWorkerFn: options.invokeChatWorkerFn ?? invokeChatWorkerOrPersistFailure,
    requestChatRunCancellationFn: options.requestChatRunCancellationFn ?? requestChatRunCancellation,
    createChatLiveStreamEnvelopeFn: options.createChatLiveStreamEnvelopeFn ?? createChatLiveStreamEnvelope,
    resolveLiveCursorFn: options.resolveLiveCursorFn ?? resolveLiveCursor,
    listChatMessagesLatestFn: options.listChatMessagesLatestFn ?? listChatMessagesLatest,
    resolveAccessibleChatWorkspaceIdFn,
  };
}

/**
 * Loads request context and enforces the auth transports supported by backend-owned chat.
 */
export async function loadSupportedRequestContext(
  request: Request,
  dependencies: ChatRouteDependencies,
): Promise<RequestContext> {
  const { requestContext } = await dependencies.loadRequestContextFromRequestFn(
    request,
    dependencies.allowedOrigins,
  );
  assertSupportedTransport(requestContext);
  return requestContext;
}
