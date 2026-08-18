import { useCallback, useEffect, useRef } from "react";
import {
  ApiError,
  buildLogoutLocalUrl,
  getSession,
  isAuthRedirectError,
  revalidateSession as revalidateSessionRequest,
} from "../../../api";
import {
  clearBrowserReauthRequired,
  hasAccountDeletedMarker,
  isAccountDeletionPending,
  isAccountDeletionServerConfirmed,
  isBrowserReauthRequired,
  markAccountDeletionServerConfirmed,
  removeAccountDeletedMarker,
  runWithAccountDeletionLock,
  setAccountDeletionPending,
  type LocalBrowserDataCleanupReason,
} from "../../../accountDeletion";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";
import type { TranslationKey } from "../../../i18n";
import { loadCloudSettings, putCloudSettings } from "../../../localDb/sync/cloudSettings";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import { normalizeCaughtError, setWebObservabilityUser } from "../../../observability/webObservability";
import { getSyncFailureObservationCaptureState } from "../../sync/observation/syncErrorObservation";
import { getErrorMessage } from "../../domain";
import {
  buildLinkedCloudSettings,
  buildLinkingReadyCloudSettings,
  resolveLocalDataCleanupReasonForVerifiedSession,
} from "../cloud/workspaceSessionCloud";
import {
  createSessionAccountSwitchError,
  hasLoggedOutMarker,
  isSessionAccountSwitchError,
  removeLoggedOutMarker,
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
  // The resume chain feeds the periodic revalidate timer, so it depends on the
  // active workspace id instead of the workspace object: publishing the same
  // workspace as a new object must not tear down and restart that timer.
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const resumePromiseRef = useRef<Promise<void> | null>(null);

  const resumeConfirmedAccountDeletion = useCallback(async function resumeConfirmedAccountDeletion(): Promise<void> {
    await runWithAccountDeletionLock(
      indexedDbOpenRecoveryState.signal,
      async (): Promise<void> => {
        indexedDbOpenRecoveryState.throwIfFailed();
        if (
          isAccountDeletionPending() === false
          || isAccountDeletionServerConfirmed() === false
        ) {
          return;
        }

        await clearConfirmedUserScopedState("account_deletion_submit");
        indexedDbOpenRecoveryState.throwIfFailed();
        window.location.href = buildLogoutLocalUrl();
        setAccountDeletionPending(false);
      },
    );
    indexedDbOpenRecoveryState.throwIfFailed();
  }, [clearConfirmedUserScopedState, indexedDbOpenRecoveryState]);

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
      if (hasLoggedOutMarker()) {
        await clearConfirmedUserScopedState("logout_marker");
        indexedDbOpenRecoveryState.throwIfFailed();
        removeLoggedOutMarker();
      }

      if (hasAccountDeletedMarker()) {
        await clearConfirmedUserScopedState("account_deleted_marker");
        indexedDbOpenRecoveryState.throwIfFailed();
        removeAccountDeletedMarker();

        setSession(null);
        setWebObservabilityUser(null);
        setSessionLoadState("deleted");
        setSessionVerificationState("verified");
        setSessionErrorMessage(t("app.accountDeleted"));
        setSessionTechnicalError(null);
        return;
      }

      if (isAccountDeletionPending() && isAccountDeletionServerConfirmed()) {
        await resumeConfirmedAccountDeletion();
        return;
      }

      const wasBrowserReauthRequired = isBrowserReauthRequired();
      let currentSession: SessionInfo;
      try {
        currentSession = await getSession();
      } catch (error) {
        if (
          isAccountDeletionPending()
          && error instanceof ApiError
          && error.code === "ACCOUNT_DELETED"
        ) {
          markAccountDeletionServerConfirmed();
          indexedDbOpenRecoveryState.throwIfFailed();
          await resumeConfirmedAccountDeletion();
          return;
        }

        indexedDbOpenRecoveryState.throwIfFailed();
        throw error;
      }
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
      const normalizedError = normalizeCaughtError(error);
      indexedDbOpenRecoveryState.markFailed(normalizedError);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

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

      const nextErrorMessage = getErrorMessage(normalizedError);
      const isExpectedError = isExpectedWorkspaceSessionApiError(normalizedError);
      if (isExpectedError === false) {
        captureWorkspaceTransitionError("session_bootstrap_failed", {
          errorMessage: nextErrorMessage,
          sessionVerificationState,
        }, normalizedError);
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
    resumeConfirmedAccountDeletion,
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
          indexedDbOpenRecoveryState.markFailed(normalizedError);
          indexedDbOpenRecoveryState.throwIfFailed();
          const nextErrorMessage = getErrorMessage(normalizedError);
          const isExpectedError = isExpectedWorkspaceSessionApiError(normalizedError);
          if (isExpectedError === false) {
            captureWorkspaceTransitionError("session_account_switch_failed", {
              errorMessage: nextErrorMessage,
              sessionVerificationState,
            }, normalizedError);
          }
          setSessionLoadState("error");
          setSessionErrorMessage(nextErrorMessage);
          setErrorMessage(nextErrorMessage);
          setSessionTechnicalError(isExpectedError ? null : normalizedError);
          setTechnicalError(isExpectedError ? null : normalizedError);
          throw createSessionAccountSwitchError(nextErrorMessage);
        }
      }

      const persistedCloudSettings = await loadCloudSettings();
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return false;
      }

      // A long-lived tab can lose the persisted cloud settings record after
      // startup (storage eviction, another tab clearing browser data). Restore
      // it here so sync keeps a verified installation id without a reload.
      if (persistedCloudSettings === null) {
        const repairedCloudSettings = activeWorkspaceId === null
          ? buildLinkingReadyCloudSettings(currentSession)
          : buildLinkedCloudSettings(currentSession, activeWorkspaceId);
        await putCloudSettings(repairedCloudSettings);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return false;
        }

        setCloudSettings(repairedCloudSettings);
      }

      setSession(currentSession);
      clearBrowserReauthRequired();
      setSessionErrorMessage("");
      setErrorMessage("");
      setSessionTechnicalError(null);
      setTechnicalError(null);
      return true;
    } catch (error) {
      indexedDbOpenRecoveryState.markFailed(error);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (isAuthRedirectError(error)) {
        return false;
      }

      throw error;
    }
  }, [
    activeWorkspaceId,
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

      while (attemptNumber <= resumeRetryCount) {
        try {
          await runResumeAttempt();
          return;
        } catch (error) {
          indexedDbOpenRecoveryState.markFailed(error);
          if (indexedDbOpenRecoveryState.hasFailed()) {
            return;
          }

          if (isAuthRedirectError(error)) {
            return;
          }

          if (isSessionAccountSwitchError(error)) {
            return;
          }

          lastError = error;
          if (attemptNumber === resumeRetryCount) {
            break;
          }

          await waitForDelay(resumeRetryDelayMs);
          if (indexedDbOpenRecoveryState.hasFailed()) {
            return;
          }
          attemptNumber += 1;
        }
      }

      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
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
    if (
      indexedDbOpenRecoveryState.isFailed
      || sessionLoadState !== "ready"
      || sessionVerificationState !== "verified"
      || session === null
    ) {
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
  }, [
    indexedDbOpenRecoveryState.isFailed,
    resumeInBackground,
    session,
    sessionLoadState,
    sessionVerificationState,
  ]);

  return {
    initialize,
  };
}
