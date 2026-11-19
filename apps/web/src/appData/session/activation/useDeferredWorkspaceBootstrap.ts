import { useCallback, useEffect, useRef, useState } from "react";
import { isAuthRedirectError } from "../../../api";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";
import { normalizeCaughtError, type WorkspaceActivationBootstrapPhase } from "../../../observability/webObservability";
import type { WorkspaceSummary } from "../../../types";
import { getErrorMessage } from "../../domain";
import {
  getSyncFailureObservationCaptureState,
  isSyncFailurePresentedByCaller,
} from "../../sync/observation/syncErrorObservation";
import {
  captureWorkspaceTransitionError,
  logWorkspaceTransition,
} from "../observation/workspaceSessionObservation";
import type {
  SessionVerificationState,
  WorkspaceSessionSyncActions,
} from "../workspaceSessionTypes";

export type WorkspaceBootstrapOutcome =
  | Readonly<{ kind: "completed" }>
  | Readonly<{ kind: "redirected" }>
  | Readonly<{ kind: "failed"; errorMessage: string; technicalError: Error | null }>;

type UseDeferredWorkspaceBootstrapParams =
  & Readonly<{
    activeWorkspaceId: string | undefined;
    selectedWorkspaceId: string | null | undefined;
    sessionUserId: string | undefined;
    sessionVerificationState: SessionVerificationState;
    indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
    onOutcome: (outcome: WorkspaceBootstrapOutcome) => void;
  }>
  & Pick<WorkspaceSessionSyncActions, "refreshWorkspaceView" | "runSyncForWorkspace">;

type DeferredWorkspaceBootstrapCommands = Readonly<{
  scheduleWorkspaceBootstrap: (userId: string, workspace: WorkspaceSummary) => void;
  invalidateWorkspaceBootstrap: () => void;
}>;

type DeferredWorkspaceBootstrap = Readonly<{
  userId: string;
  workspace: WorkspaceSummary;
  generation: number;
}>;

export function useDeferredWorkspaceBootstrap(
  params: UseDeferredWorkspaceBootstrapParams,
): DeferredWorkspaceBootstrapCommands {
  const {
    activeWorkspaceId,
    selectedWorkspaceId,
    sessionUserId,
    sessionVerificationState,
    indexedDbOpenRecoveryState,
    onOutcome,
    refreshWorkspaceView,
    runSyncForWorkspace,
  } = params;
  const workspaceBootstrapGenerationRef = useRef<number>(0);
  const deferredBootstrapWorkspaceRef = useRef<DeferredWorkspaceBootstrap | null>(null);
  const [deferredBootstrapVersion, setDeferredBootstrapVersion] = useState<number>(0);

  const scheduleWorkspaceBootstrap = useCallback(function scheduleWorkspaceBootstrap(
    userId: string,
    workspace: WorkspaceSummary,
  ): void {
    workspaceBootstrapGenerationRef.current += 1;
    deferredBootstrapWorkspaceRef.current = {
      userId,
      workspace,
      generation: workspaceBootstrapGenerationRef.current,
    };
    // The effect must also run when a workspace is reactivated with the same IDs.
    setDeferredBootstrapVersion((currentVersion) => currentVersion + 1);
  }, []);

  const invalidateWorkspaceBootstrap = useCallback(function invalidateWorkspaceBootstrap(): void {
    workspaceBootstrapGenerationRef.current += 1;
    deferredBootstrapWorkspaceRef.current = null;
  }, []);

  useEffect(() => {
    const deferredBootstrap = deferredBootstrapWorkspaceRef.current;
    if (
      deferredBootstrap === null
      || indexedDbOpenRecoveryState.hasFailed()
      || sessionVerificationState !== "verified"
      || sessionUserId !== deferredBootstrap.userId
      || selectedWorkspaceId !== deferredBootstrap.workspace.workspaceId
      || activeWorkspaceId !== deferredBootstrap.workspace.workspaceId
    ) {
      return;
    }

    const { workspace, generation: bootstrapGeneration } = deferredBootstrap;
    let isActive = true;
    const isCurrentBootstrapGeneration = function isCurrentBootstrapGeneration(): boolean {
      return isActive && bootstrapGeneration === workspaceBootstrapGenerationRef.current;
    };

    logWorkspaceTransition("workspace_activate_bootstrap_started", {
      workspaceId: workspace.workspaceId,
      sessionVerificationState,
      bootstrapPhase: "refresh_before_sync",
    });

    void (async (): Promise<void> => {
      let bootstrapPhase: WorkspaceActivationBootstrapPhase = "refresh_before_sync";
      try {
        await refreshWorkspaceView(workspace.workspaceId);
        if (indexedDbOpenRecoveryState.hasFailed() || isCurrentBootstrapGeneration() === false) {
          return;
        }

        bootstrapPhase = "run_sync";
        await runSyncForWorkspace(workspace);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        if (isCurrentBootstrapGeneration() === false) {
          return;
        }

        bootstrapPhase = "final_refresh";
        await refreshWorkspaceView(workspace.workspaceId);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        if (isCurrentBootstrapGeneration() === false) {
          return;
        }

        bootstrapPhase = "completed";
        onOutcome({ kind: "completed" });
        logWorkspaceTransition("workspace_activate_bootstrap_succeeded", {
          workspaceId: workspace.workspaceId,
          sessionVerificationState,
          bootstrapPhase,
        });
      } catch (error) {
        if (isCurrentBootstrapGeneration() === false) {
          return;
        }

        const normalizedError = normalizeCaughtError(error);
        indexedDbOpenRecoveryState.markFailed(normalizedError);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        if (isAuthRedirectError(error)) {
          logWorkspaceTransition("workspace_activate_bootstrap_redirected", {
            workspaceId: workspace.workspaceId,
            redirected: true,
            sessionVerificationState,
            bootstrapPhase,
          });
          onOutcome({ kind: "redirected" });
          return;
        }

        if (bootstrapPhase === "run_sync" && isSyncFailurePresentedByCaller(normalizedError)) {
          return;
        }

        const nextErrorMessage = getErrorMessage(normalizedError);
        const syncFailureCaptureState = getSyncFailureObservationCaptureState(normalizedError);
        if (syncFailureCaptureState === null) {
          captureWorkspaceTransitionError("workspace_activate_bootstrap_failed", {
            workspaceId: workspace.workspaceId,
            errorMessage: nextErrorMessage,
            sessionVerificationState,
            bootstrapPhase,
          }, normalizedError);
        }
        onOutcome({
          kind: "failed",
          errorMessage: nextErrorMessage,
          technicalError: syncFailureCaptureState === false ? null : normalizedError,
        });
      } finally {
        if (isCurrentBootstrapGeneration()) {
          deferredBootstrapWorkspaceRef.current = null;
        }
      }
    })();
    return () => { isActive = false; };
  }, [
    activeWorkspaceId,
    deferredBootstrapVersion,
    indexedDbOpenRecoveryState,
    onOutcome,
    refreshWorkspaceView,
    runSyncForWorkspace,
    selectedWorkspaceId,
    sessionUserId,
    sessionVerificationState,
  ]);

  return { scheduleWorkspaceBootstrap, invalidateWorkspaceBootstrap };
}
