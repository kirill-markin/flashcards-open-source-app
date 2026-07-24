/**
 * Public facade for backend-owned chat run lifecycle APIs.
 * Internal implementation is split across focused modules under `./runs/`.
 */
export type {
  ChatRunClaimToken,
  ChatRunHeartbeatState,
  ChatRunSnapshot,
  ChatRunStatus,
  ChatRunStopState,
  ClaimedChatRun,
  PreparedChatRun,
  RecoveredPaginatedSession,
} from "./runs/types";

export {
  assertActiveChatRunClaimWithExecutor,
  InactiveChatRunClaimError,
} from "./runs/claimFence";
export type { ChatRunClaimFenceParams } from "./runs/claimFence";

export {
  getChatRunSnapshot,
  getRecoveredChatSessionSnapshot,
  getRecoveredPaginatedSession,
} from "./runs/readService";

export {
  claimChatRun,
  completeClaimedChatRun,
  interruptPreparedChatRun,
  markQueuedChatRunDispatchFailed,
  persistClaimedChatRunCancelled,
  persistClaimedChatRunTerminalError,
  prepareChatRun,
  requestChatRunCancellation,
  touchClaimedChatRunHeartbeat,
} from "./runs/lifecycleService";
