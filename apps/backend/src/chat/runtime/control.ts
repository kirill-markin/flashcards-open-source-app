import type {
  ChatStreamEvent,
} from "../types";
import {
  CHAT_RUN_HEARTBEAT_INTERVAL_MS,
} from "../worker/lease";
import type {
  ChatRuntimeDependencies,
} from "./dependencies";
import {
  logAbortRequested,
} from "./lifecycleLogs";
import type {
  ChatWorkerAbortReason,
  ChatWorkerExecutionPhase,
  StartPersistedChatRunParams,
} from "./types";
import type {
  ChatWorkerLogContext,
} from "../worker/logging";

export const CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS = 180_000;
export const DEADLINE_REACHED_MESSAGE = "This response took too long, so I stopped the run before the server timeout. Please try again or split the request into smaller steps.";

type InitialHeartbeatResult =
  | Readonly<{ outcome: "active" }>
  | Readonly<{ outcome: "ownership_lost" }>
  | Readonly<{ outcome: "initial_cancelled" }>;

export type ChatRuntimeControl = Readonly<{
  abortController: AbortController;
  startHeartbeat: () => void;
  touchInitialHeartbeat: () => Promise<InitialHeartbeatResult>;
  scheduleSoftDeadlineTimer: () => void;
  clearTimers: () => void;
  setExecutionPhase: (phase: ChatWorkerExecutionPhase) => void;
  shouldStopBeforeNextStep: () => boolean;
  shouldIgnoreStreamEvent: (event: ChatStreamEvent) => boolean;
  getAbortReason: () => ChatWorkerAbortReason | null;
  getStopRequestedByUser: () => boolean;
  getOwnershipLost: () => boolean;
}>;

export function createChatRuntimeControl(
  params: StartPersistedChatRunParams,
  dependencies: ChatRuntimeDependencies,
  logContext: ChatWorkerLogContext,
): ChatRuntimeControl {
  const abortController = new AbortController();
  let stopRequestedByUser = false;
  let ownershipLost = false;
  let abortReason: ChatWorkerAbortReason | null = null;
  let executionPhase: ChatWorkerExecutionPhase = "idle";
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let softDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

  const recordAbortRequest = (
    reason: ChatWorkerAbortReason,
    heartbeatAt: Date | null,
    cancellationRequested: boolean,
    ownershipLostState: boolean,
    abortSignal: boolean,
  ): void => {
    if (abortReason !== null) {
      return;
    }

    abortReason = reason;
    if (abortSignal && !abortController.signal.aborted) {
      abortController.abort();
    }
    logAbortRequested(
      logContext,
      reason,
      heartbeatAt,
      cancellationRequested,
      ownershipLostState,
      abortController.signal.aborted,
    );
  };

  const requestHardAbort = (
    reason: Exclude<ChatWorkerAbortReason, "deadline_reached">,
    heartbeatAt: Date | null,
    cancellationRequested: boolean,
    ownershipLostState: boolean,
  ): void => {
    recordAbortRequest(
      reason,
      heartbeatAt,
      cancellationRequested,
      ownershipLostState,
      true,
    );
  };

  const requestSoftDeadlineStop = (): void => {
    if (abortReason !== null) {
      return;
    }

    recordAbortRequest(
      "deadline_reached",
      null,
      false,
      false,
      executionPhase === "model",
    );
  };

  const handleHeartbeatState = (
    heartbeatAt: Date,
    state: Awaited<ReturnType<ChatRuntimeDependencies["touchChatRunHeartbeat"]>>,
  ): void => {
    if (state.ownershipLost) {
      ownershipLost = true;
      requestHardAbort(
        "ownership_lost",
        heartbeatAt,
        state.cancellationRequested,
        true,
      );
      return;
    }

    if (state.cancellationRequested) {
      stopRequestedByUser = true;
      requestHardAbort(
        "user_cancelled",
        heartbeatAt,
        true,
        ownershipLost,
      );
    }
  };

  return {
    abortController,
    startHeartbeat: (): void => {
      heartbeatTimer = setInterval(() => {
        const heartbeatAt = new Date();
        void dependencies.touchChatRunHeartbeat(
          params.userId,
          params.workspaceId,
          params.runId,
          heartbeatAt,
        ).then((state) => {
          handleHeartbeatState(heartbeatAt, state);
        }).catch((): void => undefined);
      }, CHAT_RUN_HEARTBEAT_INTERVAL_MS);
    },
    touchInitialHeartbeat: async (): Promise<InitialHeartbeatResult> => {
      const initialHeartbeatAt = new Date();
      const initialHeartbeatState = await dependencies.touchChatRunHeartbeat(
        params.userId,
        params.workspaceId,
        params.runId,
        initialHeartbeatAt,
      );
      if (initialHeartbeatState.ownershipLost) {
        ownershipLost = true;
        requestHardAbort(
          "ownership_lost",
          initialHeartbeatAt,
          initialHeartbeatState.cancellationRequested,
          true,
        );
        return { outcome: "ownership_lost" };
      }

      stopRequestedByUser = initialHeartbeatState.cancellationRequested;
      if (stopRequestedByUser) {
        requestHardAbort("initial_cancel_state", initialHeartbeatAt, true, false);
        return { outcome: "initial_cancelled" };
      }

      return { outcome: "active" };
    },
    scheduleSoftDeadlineTimer: (): void => {
      const remainingTimeMs = params.getRemainingTimeInMillis();
      const softDeadlineDelayMs = remainingTimeMs - CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS;
      if (softDeadlineDelayMs <= 0) {
        requestSoftDeadlineStop();
        return;
      }

      softDeadlineTimer = setTimeout(() => {
        requestSoftDeadlineStop();
      }, softDeadlineDelayMs);
    },
    clearTimers: (): void => {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      if (softDeadlineTimer !== null) {
        clearTimeout(softDeadlineTimer);
      }
    },
    setExecutionPhase: (phase: ChatWorkerExecutionPhase): void => {
      executionPhase = phase;
    },
    shouldStopBeforeNextStep: (): boolean => abortReason === "deadline_reached",
    shouldIgnoreStreamEvent: (event: ChatStreamEvent): boolean =>
      stopRequestedByUser
      || ownershipLost
      || (
        abortReason === "deadline_reached"
        && !(executionPhase === "tool" && event.type === "tool_call" && event.status === "completed")
      ),
    getAbortReason: (): ChatWorkerAbortReason | null => abortReason,
    getStopRequestedByUser: (): boolean => stopRequestedByUser,
    getOwnershipLost: (): boolean => ownershipLost,
  };
}
