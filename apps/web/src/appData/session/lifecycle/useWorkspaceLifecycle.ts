import { useCallback, useEffect, useRef } from "react";
import {
  ApiError,
  getSession,
  isAuthRedirectError,
  revalidateSession as revalidateSessionRequest,
} from "../../../api";
import {
  clearBrowserReauthRequired,
  consumeAccountDeletedMarker,
  isBrowserReauthRequired,
  type LocalBrowserDataCleanupReason,
} from "../../../accountDeletion";
import {
  isIndexedDbOpenRecoveryFailureMark,
  ownsIndexedDbOpenRecoveryFailure,
  type IndexedDbOpenRecoveryMarkResult,
  type IndexedDbOpenRecoveryState,
} from "../../../appError/AppErrorContext";
import type { TranslationKey } from "../../../i18n";
import { loadCloudSettings, putCloudSettings } from "../../../localDb/sync/cloudSettings";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { normalizeCaughtError, setWebObservabilityUser } from "../../../observability/webObservability";
import { getSyncFailureObservationCaptureState } from "../../sync/observation/syncErrorObservation";
import { getErrorMessage } from "../../domain";
import {
  buildLinkingReadyCloudSettings,
  resolveLocalDataCleanupReasonForVerifiedSession,
} from "../cloud/workspaceSessionCloud";
import {
  consumeLoggedOutMarker,
  createSessionAccountSwitchError,
  isSessionAccountSwitchError,
  resumeRetryCount,
  resumeRetryDelayMs,
  waitForDelay,
} from "./workspaceLifecycleHelpers";
import {
  captureWorkspaceTransitionError,
  logWorkspaceTransition,
} from "../observation/workspaceSessionObservation";
import type {
  WorkspaceSessionSetters,
  WorkspaceSessionState,
} from "../workspaceSessionTypes";
import type { SessionInfo } from "../../../types";

type UseWorkspaceLifecycleParams =
  & Readonly<{
    t: (key: TranslationKey) => string;
    runSyncSilently: () => Promise<void>;
    resolveInitialWorkspace: (currentSession: SessionInfo) => Promise<void>;
    clearConfirmedUserScopedState: (reason: LocalBrowserDataCleanupReason) => Promise<void>;
    indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  }>
  & WorkspaceSessionState
  & WorkspaceSessionSetters;

type WorkspaceLifecycle = Readonly<{
  initialize: () => Promise<void>;
}>;

function isExpectedWorkspaceSessionApiError(error: Error): boolean {
  if (error instanceof ApiError === false) {
    return false;
  }

  switch (error.code) {
    case "WORKSPACE_NOT_FOUND":
    case "WORKSPACE_SELECTION_REQUIRED":
      return true;
  }

  return false;
}

function runLifecycleTaskInBackground(task: Promise<void>): void {
  void task.catch((): void => undefined);
}

export function useWorkspaceLifecycle(params: UseWorkspaceLifecycleParams): WorkspaceLifecycle {
  const {
    t,
    sessionLoadState,
    sessionVerificationState,
    session,
    activeWorkspace,
    availableWorkspaces,
    setSessionLoadState,
    setSessionVerificationState,
    setSessionErrorMessage,
    setSessionTechnicalError,
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setErrorMessage,
    setTechnicalError,
    setCloudSettings,
    runSyncSilently,
    resolveInitialWorkspace,
    clearConfirmedUserScopedState,
    indexedDbOpenRecoveryState,
  } = params;
  const resumePromiseRef = useRef<Promise<void> | null>(null);

  const initialize = useCallback(async function initialize(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const shouldPreserveWarmStartState = sessionLoadState === "ready"
      && sessionVerificationState === "unverified"
      && session !== null
      && activeWorkspace !== null
      && availableWorkspaces.length > 0;

    // Warm start intentionally keeps the last known shell visible while the
    // browser revalidates auth in the background. If verification fails, this
    // optimistic state is discarded by the mismatch or redirect handling below.
    if (shouldPreserveWarmStartState === false) {
      setSessionLoadState("loading");
      setActiveWorkspace(null);
      setAvailableWorkspaces([]);
    }

    setSessionVerificationState("unverified");
    setSessionErrorMessage("");
    setErrorMessage("");
    setSessionTechnicalError(null);
    setTechnicalError(null);

    try {
      if (consumeLoggedOutMarker()) {
        await clearConfirmedUserScopedState("logout_marker");
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }
      }

      if (consumeAccountDeletedMarker()) {
        await clearConfirmedUserScopedState("account_deleted_marker");
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        setSession(null);
        setWebObservabilityUser(null);
        setSessionLoadState("deleted");
        setSessionVerificationState("verified");
        setSessionErrorMessage(t("app.accountDeleted"));
        setSessionTechnicalError(null);
        return;
      }

      const wasBrowserReauthRequired = isBrowserReauthRequired();
      const currentSession = await getSession();
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      setWebObservabilityUser({ id: currentSession.userId });
      const persistedCloudSettings = await loadCloudSettings();
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      const localDataCleanupReason = resolveLocalDataCleanupReasonForVerifiedSession(
        persistedCloudSettings,
        currentSession,
        wasBrowserReauthRequired,
      );
      if (localDataCleanupReason !== null) {
        await clearConfirmedUserScopedState(localDataCleanupReason);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }
      }

      clearBrowserReauthRequired();
      const linkingReadyCloudSettings = buildLinkingReadyCloudSettings(currentSession);
      await putCloudSettings(linkingReadyCloudSettings);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      setCloudSettings(linkingReadyCloudSettings);
      await resolveInitialWorkspace(currentSession);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      setSessionVerificationState("verified");
    } catch (error) {
      if (isAuthRedirectError(error)) {
        logWorkspaceTransition("session_bootstrap_redirected", {
          redirected: true,
          sessionVerificationState,
        });
        setSession(null);
        setWebObservabilityUser(null);
        setActiveWorkspace(null);
        setAvailableWorkspaces([]);
        setCloudSettings(null);
        setSessionLoadState("redirecting");
        return;
      }

      const normalizedError = normalizeCaughtError(error);
      const markResult = indexedDbOpenRecoveryState.markFailed(normalizedError);
      const nextErrorMessage = getErrorMessage(normalizedError);
      const isExpectedError = isExpectedWorkspaceSessionApiError(normalizedError);
      if (isExpectedError === false) {
        captureWorkspaceTransitionError("session_bootstrap_failed", {
          errorMessage: nextErrorMessage,
          sessionVerificationState,
        }, normalizedError);
      }
      if (indexedDbOpenRecoveryState.hasFailed() && ownsIndexedDbOpenRecoveryFailure(markResult) === false) {
        return;
      }

      setSessionLoadState("error");
      setSessionErrorMessage(nextErrorMessage);
      setSessionTechnicalError(isExpectedError ? null : normalizedError);
      setTechnicalError(null);
    }
  }, [
    clearConfirmedUserScopedState,
    indexedDbOpenRecoveryState,
    resolveInitialWorkspace,
    session,
    sessionLoadState,
    sessionVerificationState,
    t,
    activeWorkspace,
    availableWorkspaces,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setCloudSettings,
    setErrorMessage,
    setSession,
    setSessionErrorMessage,
    setSessionLoadState,
    setSessionTechnicalError,
    setSessionVerificationState,
    setTechnicalError,
  ]);

  const initializeRef = useRef(initialize);

  useEffect(() => {
    initializeRef.current = initialize;
  }, [initialize]);

  useEffect(() => {
    void initializeRef.current();
  }, []);

  const revalidateActiveSession = useCallback(async function revalidateActiveSession(): Promise<boolean> {
    if (
      indexedDbOpenRecoveryState.hasFailed()
      || sessionLoadState !== "ready"
      || sessionVerificationState !== "verified"
      || session === null
    ) {
      return false;
    }

    try {
      const currentSession = await revalidateSessionRequest();
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return false;
      }

      if (currentSession.userId !== session.userId) {
        try {
          setWebObservabilityUser({ id: currentSession.userId });
          await clearConfirmedUserScopedState("confirmed_account_switch");
          if (indexedDbOpenRecoveryState.hasFailed()) {
            return false;
          }

          clearBrowserReauthRequired();
          const linkingReadyCloudSettings = buildLinkingReadyCloudSettings(currentSession);
          await putCloudSettings(linkingReadyCloudSettings);
          if (indexedDbOpenRecoveryState.hasFailed()) {
            return false;
          }

          setCloudSettings(linkingReadyCloudSettings);
          await resolveInitialWorkspace(currentSession);
          if (indexedDbOpenRecoveryState.hasFailed()) {
            return false;
          }

          setSessionVerificationState("verified");
          setSessionErrorMessage("");
          setErrorMessage("");
          return false;
        } catch (error) {
          const normalizedError = normalizeCaughtError(error);
          const markResult = indexedDbOpenRecoveryState.markFailed(normalizedError);
          const nextErrorMessage = getErrorMessage(normalizedError);
          const isExpectedError = isExpectedWorkspaceSessionApiError(normalizedError);
          if (isExpectedError === false) {
            captureWorkspaceTransitionError("session_account_switch_failed", {
              errorMessage: nextErrorMessage,
              sessionVerificationState,
            }, normalizedError);
          }
          if (indexedDbOpenRecoveryState.hasFailed() && ownsIndexedDbOpenRecoveryFailure(markResult) === false) {
            throw createSessionAccountSwitchError(nextErrorMessage);
          }

          setSessionLoadState("error");
          setSessionErrorMessage(nextErrorMessage);
          setErrorMessage(nextErrorMessage);
          setSessionTechnicalError(isExpectedError ? null : normalizedError);
          setTechnicalError(isExpectedError ? null : normalizedError);
          throw createSessionAccountSwitchError(nextErrorMessage);
        }
      }

      setSession(currentSession);
      clearBrowserReauthRequired();
      setSessionErrorMessage("");
      setErrorMessage("");
      setSessionTechnicalError(null);
      setTechnicalError(null);
      return true;
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return false;
      }

      throw error;
    }
  }, [
    clearConfirmedUserScopedState,
    indexedDbOpenRecoveryState,
    resolveInitialWorkspace,
    session,
    sessionLoadState,
    sessionVerificationState,
    setCloudSettings,
    setErrorMessage,
    setSession,
    setSessionErrorMessage,
    setSessionLoadState,
    setSessionTechnicalError,
    setSessionVerificationState,
    setTechnicalError,
  ]);

  const runResumeAttempt = useCallback(async function runResumeAttempt(): Promise<void> {
    const isSessionValid = await revalidateActiveSession();
    if (isSessionValid) {
      await runSyncSilently();
    }

    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    setSessionErrorMessage("");
    setErrorMessage("");
    setSessionTechnicalError(null);
    setTechnicalError(null);
  }, [indexedDbOpenRecoveryState, revalidateActiveSession, runSyncSilently, setErrorMessage, setSessionErrorMessage, setSessionTechnicalError, setTechnicalError]);

  const resumeInBackground = useCallback(async function resumeInBackground(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const activeResume = resumePromiseRef.current;
    if (activeResume !== null) {
      return activeResume;
    }

    let trackedResumePromise: Promise<void>;
    trackedResumePromise = (async (): Promise<void> => {
      let attemptNumber = 1;
      let lastError: unknown = null;
      let lastMarkResult: IndexedDbOpenRecoveryMarkResult = "not_recovery";

      while (attemptNumber <= resumeRetryCount) {
        try {
          await runResumeAttempt();
          return;
        } catch (error) {
          if (isAuthRedirectError(error)) {
            return;
          }

          if (isSessionAccountSwitchError(error)) {
            return;
          }

          lastMarkResult = indexedDbOpenRecoveryState.markFailed(error);

          lastError = error;
          if (isIndexedDbOpenRecoveryFailureMark(lastMarkResult) || attemptNumber === resumeRetryCount) {
            break;
          }

          if (indexedDbOpenRecoveryState.hasFailed()) {
            break;
          }

          await waitForDelay(resumeRetryDelayMs);
          attemptNumber += 1;
        }
      }

      const normalizedError = normalizeCaughtError(lastError);
      const nextErrorMessage = getErrorMessage(normalizedError);
      const syncFailureCaptureState = getSyncFailureObservationCaptureState(normalizedError);
      const didCaptureResumeError = syncFailureCaptureState === null
        ? captureAppOperationError(normalizedError, {
          feature: "auth",
          operation: "session_resume",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: null,
          entityId: null,
        })
        : syncFailureCaptureState;
      if (indexedDbOpenRecoveryState.hasFailed() && ownsIndexedDbOpenRecoveryFailure(lastMarkResult) === false) {
        throw normalizedError;
      }

      setErrorMessage(nextErrorMessage);
      setTechnicalError(didCaptureResumeError ? normalizedError : null);
      throw normalizedError;
    })().finally(() => {
      if (resumePromiseRef.current === trackedResumePromise) {
        resumePromiseRef.current = null;
      }
    });

    resumePromiseRef.current = trackedResumePromise;
    return trackedResumePromise;
  }, [activeWorkspace?.workspaceId, indexedDbOpenRecoveryState, runResumeAttempt, session?.userId, setErrorMessage, setTechnicalError]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || sessionVerificationState !== "verified" || session === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        runLifecycleTaskInBackground(resumeInBackground());
      }
    }, 60_000);

    const handleResume = (): void => {
      runLifecycleTaskInBackground(resumeInBackground());
    };

    const handleFocus = (): void => {
      handleResume();
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        handleResume();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [resumeInBackground, session, sessionLoadState, sessionVerificationState]);

  return {
    initialize,
  };
}
