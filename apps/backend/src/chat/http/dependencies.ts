import type { AuthTransport } from "../../auth";
import {
  assertAiUsageAllowanceNotReached,
  reportHeavyAiUsageWeightedTokens,
  resolveAiUsageAllowanceForEnforcement,
} from "../../aiUsage";
import { createChatFileUpload } from "../../chatFiles";
import { assertGuestRequestSupportsProduct } from "../../guestAuth/webPlatform";
import { HttpError } from "../../shared/errors";
import {
  loadRequestContextFromRequest,
  resolveAccessibleChatWorkspaceId,
  type RequestContext,
  type WorkspaceRequestContext,
} from "../../server/requestContext";
import { createChatLiveStreamEnvelope } from "../live/auth";
import {
  archiveChatSession,
  getRecoveredChatSession,
  getRecoveredChatSessionSnapshot,
  getRecoveredPaginatedSession,
  interruptPreparedChatRun,
  prepareChatRun,
  recordAiLimitReachedAnalytics,
  recordAiMessageSentAnalytics,
  requestChatRunCancellation,
} from "../runs";
import {
  createFreshChatSession,
  getChatSessionId,
  listChatSessionHistory,
  renameChatSession,
  rolloverToFreshChatSession,
} from "../store";
import { invokeChatWorkerOrPersistFailure } from "../worker/invoke";

export type ChatRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  getRecoveredChatSessionFn?: typeof getRecoveredChatSession;
  getRecoveredChatSessionSnapshotFn?: typeof getRecoveredChatSessionSnapshot;
  getRecoveredPaginatedSessionFn?: typeof getRecoveredPaginatedSession;
  rolloverToFreshChatSessionFn?: typeof rolloverToFreshChatSession;
  createFreshChatSessionFn?: typeof createFreshChatSession;
  getChatSessionIdFn?: typeof getChatSessionId;
  prepareChatRunFn?: typeof prepareChatRun;
  recordAiMessageSentAnalyticsFn?: typeof recordAiMessageSentAnalytics;
  recordAiLimitReachedAnalyticsFn?: typeof recordAiLimitReachedAnalytics;
  interruptPreparedChatRunFn?: typeof interruptPreparedChatRun;
  invokeChatWorkerFn?: typeof invokeChatWorkerOrPersistFailure;
  requestChatRunCancellationFn?: typeof requestChatRunCancellation;
  createChatLiveStreamEnvelopeFn?: typeof createChatLiveStreamEnvelope;
  listChatSessionHistoryFn?: typeof listChatSessionHistory;
  renameChatSessionFn?: typeof renameChatSession;
  archiveChatSessionFn?: typeof archiveChatSession;
  resolveAccessibleChatWorkspaceIdFn?: typeof resolveAccessibleChatWorkspaceId;
  resolveAiUsageAllowanceForEnforcementFn?: typeof resolveAiUsageAllowanceForEnforcement;
  assertAiUsageAllowanceNotReachedFn?: typeof assertAiUsageAllowanceNotReached;
  reportHeavyAiUsageWeightedTokensFn?: typeof reportHeavyAiUsageWeightedTokens;
  createChatFileUploadFn?: typeof createChatFileUpload;
}>;

export type ChatRouteDependencies = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  getRecoveredChatSessionFn: typeof getRecoveredChatSession;
  getRecoveredChatSessionSnapshotFn: typeof getRecoveredChatSessionSnapshot;
  getRecoveredPaginatedSessionFn: typeof getRecoveredPaginatedSession;
  rolloverToFreshChatSessionFn: typeof rolloverToFreshChatSession;
  createFreshChatSessionFn: typeof createFreshChatSession;
  getChatSessionIdFn: typeof getChatSessionId;
  prepareChatRunFn: typeof prepareChatRun;
  recordAiMessageSentAnalyticsFn: typeof recordAiMessageSentAnalytics;
  recordAiLimitReachedAnalyticsFn: typeof recordAiLimitReachedAnalytics;
  interruptPreparedChatRunFn: typeof interruptPreparedChatRun;
  invokeChatWorkerFn: typeof invokeChatWorkerOrPersistFailure;
  requestChatRunCancellationFn: typeof requestChatRunCancellation;
  createChatLiveStreamEnvelopeFn: typeof createChatLiveStreamEnvelope;
  listChatSessionHistoryFn: typeof listChatSessionHistory;
  renameChatSessionFn: typeof renameChatSession;
  archiveChatSessionFn: typeof archiveChatSession;
  resolveAccessibleChatWorkspaceIdFn: typeof resolveAccessibleChatWorkspaceId;
  // Two halves rather than one call: the allowance is resolved before the run transaction opens, and only
  // the refusal runs inside it. See `prepareChatRun`.
  resolveAiUsageAllowanceForEnforcementFn: typeof resolveAiUsageAllowanceForEnforcement;
  assertAiUsageAllowanceNotReachedFn: typeof assertAiUsageAllowanceNotReached;
  reportHeavyAiUsageWeightedTokensFn: typeof reportHeavyAiUsageWeightedTokens;
  createChatFileUploadFn: typeof createChatFileUpload;
}>;

function assertSupportedTransport(requestContext: RequestContext): void {
  const supportedTransports = new Set<AuthTransport>(["bearer", "session", "guest"]);
  if (supportedTransports.has(requestContext.transport) === false) {
    throw new HttpError(
      403,
      "This endpoint requires Bearer, session, or guest authentication.",
      "AI_CHAT_V2_HUMAN_AUTH_REQUIRED",
    );
  }

  assertGuestRequestSupportsProduct(requestContext);
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
        // Legacy fallback for released AI clients at 1.5.0 and older that still
        // omit workspaceId. TODO: Remove once the minimum supported first-party
        // AI client version is greater than 1.5.0.
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
    getRecoveredChatSessionFn: options.getRecoveredChatSessionFn ?? getRecoveredChatSession,
    getRecoveredChatSessionSnapshotFn: options.getRecoveredChatSessionSnapshotFn ?? getRecoveredChatSessionSnapshot,
    getRecoveredPaginatedSessionFn: options.getRecoveredPaginatedSessionFn ?? getRecoveredPaginatedSession,
    rolloverToFreshChatSessionFn: options.rolloverToFreshChatSessionFn ?? rolloverToFreshChatSession,
    createFreshChatSessionFn: options.createFreshChatSessionFn ?? createFreshChatSession,
    getChatSessionIdFn: options.getChatSessionIdFn ?? getChatSessionId,
    prepareChatRunFn: options.prepareChatRunFn ?? prepareChatRun,
    recordAiMessageSentAnalyticsFn: options.recordAiMessageSentAnalyticsFn ?? recordAiMessageSentAnalytics,
    recordAiLimitReachedAnalyticsFn: options.recordAiLimitReachedAnalyticsFn ?? recordAiLimitReachedAnalytics,
    interruptPreparedChatRunFn: options.interruptPreparedChatRunFn ?? interruptPreparedChatRun,
    invokeChatWorkerFn: options.invokeChatWorkerFn ?? invokeChatWorkerOrPersistFailure,
    requestChatRunCancellationFn: options.requestChatRunCancellationFn ?? requestChatRunCancellation,
    createChatLiveStreamEnvelopeFn: options.createChatLiveStreamEnvelopeFn ?? createChatLiveStreamEnvelope,
    listChatSessionHistoryFn: options.listChatSessionHistoryFn ?? listChatSessionHistory,
    renameChatSessionFn: options.renameChatSessionFn ?? renameChatSession,
    archiveChatSessionFn: options.archiveChatSessionFn ?? archiveChatSession,
    resolveAccessibleChatWorkspaceIdFn,
    resolveAiUsageAllowanceForEnforcementFn: options.resolveAiUsageAllowanceForEnforcementFn
      ?? resolveAiUsageAllowanceForEnforcement,
    assertAiUsageAllowanceNotReachedFn: options.assertAiUsageAllowanceNotReachedFn
      ?? assertAiUsageAllowanceNotReached,
    reportHeavyAiUsageWeightedTokensFn: options.reportHeavyAiUsageWeightedTokensFn
      ?? reportHeavyAiUsageWeightedTokens,
    createChatFileUploadFn: options.createChatFileUploadFn ?? createChatFileUpload,
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
