import { useCallback, useEffect, useRef } from "react";
import {
  getSession,
  isAuthRedirectError,
  revalidateSession as revalidateSessionRequest,
} from "../../api";
import {
  clearBrowserReauthRequired,
  consumeAccountDeletedMarker,
  isBrowserReauthRequired,
  type LocalBrowserDataCleanupReason,
} from "../../accountDeletion";
import type { TranslationKey } from "../../i18n";
import { loadCloudSettings, putCloudSettings } from "../../localDb/sync/cloudSettings";
import { setWebObservabilityUser } from "../../observability/webObservability";
import { getErrorMessage } from "../domain";
import {
  buildLinkingReadyCloudSettings,
  resolveLocalDataCleanupReasonForVerifiedSession,
} from "./workspaceSessionCloud";
import {
  consumeLoggedOutMarker,
  createSessionAccountSwitchError,
  isSessionAccountSwitchError,
  resumeRetryCount,
  resumeRetryDelayMs,
  waitForDelay,
} from "./workspaceSessionHelpers";
import {
  captureWorkspaceTransitionError,
  logWorkspaceTransition,
} from "./workspaceSessionObservation";
import type {
  WorkspaceSessionSetters,
  WorkspaceSessionState,
} from "./workspaceSessionTypes";
import type { SessionInfo } from "../../types";

type UseWorkspaceLifecycleParams =
  & Readonly<{
    t: (key: TranslationKey) => string;
    runSync: () => Promise<void>;
    runSyncSilently: () => Promise<void>;
    resolveInitialWorkspace: (currentSession: SessionInfo) => Promise<void>;
    clearConfirmedUserScopedState: (reason: LocalBrowserDataCleanupReason) => Promise<void>;
  }>
  & WorkspaceSessionState
  & WorkspaceSessionSetters;

type WorkspaceLifecycle = Readonly<{
  initialize: () => Promise<void>;
}>;

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
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setErrorMessage,
    setCloudSettings,
    runSync,
    runSyncSilently,
    resolveInitialWorkspace,
    clearConfirmedUserScopedState,
  } = params;
  const resumePromiseRef = useRef<Promise<void> | null>(null);

  const initialize = useCallback(async function initialize(): Promise<void> {
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

    try {
      if (consumeLoggedOutMarker()) {
        await clearConfirmedUserScopedState("logout_marker");
      }

      if (consumeAccountDeletedMarker()) {
        await clearConfirmedUserScopedState("account_deleted_marker");
        setSession(null);
        setWebObservabilityUser(null);
        setSessionLoadState("deleted");
        setSessionVerificationState("verified");
        setSessionErrorMessage(t("app.accountDeleted"));
        return;
      }

      const wasBrowserReauthRequired = isBrowserReauthRequired();
      const currentSession = await getSession();
      setWebObservabilityUser({ id: currentSession.userId });
      const persistedCloudSettings = await loadCloudSettings();
      const localDataCleanupReason = resolveLocalDataCleanupReasonForVerifiedSession(
        persistedCloudSettings,
        currentSession,
        wasBrowserReauthRequired,
      );
      if (localDataCleanupReason !== null) {
        await clearConfirmedUserScopedState(localDataCleanupReason);
      }

      clearBrowserReauthRequired();
      const linkingReadyCloudSettings = buildLinkingReadyCloudSettings(currentSession);
      await putCloudSettings(linkingReadyCloudSettings);
      setCloudSettings(linkingReadyCloudSettings);
      await resolveInitialWorkspace(currentSession);
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

      const nextErrorMessage = getErrorMessage(error);
      captureWorkspaceTransitionError("session_bootstrap_failed", {
        errorMessage: nextErrorMessage,
        sessionVerificationState,
      }, error);
      setSessionLoadState("error");
      setSessionErrorMessage(nextErrorMessage);
    }
  }, [
    clearConfirmedUserScopedState,
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
    setSessionVerificationState,
  ]);

  const initializeRef = useRef(initialize);

  useEffect(() => {
    initializeRef.current = initialize;
  }, [initialize]);

  useEffect(() => {
    void initializeRef.current();
  }, []);

  const revalidateActiveSession = useCallback(async function revalidateActiveSession(): Promise<boolean> {
    if (sessionLoadState !== "ready" || sessionVerificationState !== "verified" || session === null) {
      return false;
    }

    try {
      const currentSession = await revalidateSessionRequest();
      if (currentSession.userId !== session.userId) {
        try {
          setWebObservabilityUser({ id: currentSession.userId });
          await clearConfirmedUserScopedState("confirmed_account_switch");
          clearBrowserReauthRequired();
          const linkingReadyCloudSettings = buildLinkingReadyCloudSettings(currentSession);
          await putCloudSettings(linkingReadyCloudSettings);
          setCloudSettings(linkingReadyCloudSettings);
          await resolveInitialWorkspace(currentSession);
          setSessionVerificationState("verified");
          setSessionErrorMessage("");
          setErrorMessage("");
          return false;
        } catch (error) {
          const nextErrorMessage = getErrorMessage(error);
          captureWorkspaceTransitionError("session_account_switch_failed", {
            errorMessage: nextErrorMessage,
            sessionVerificationState,
          }, error);
          setSessionLoadState("error");
          setSessionErrorMessage(nextErrorMessage);
          setErrorMessage(nextErrorMessage);
          throw createSessionAccountSwitchError(nextErrorMessage);
        }
      }

      setSession(currentSession);
      clearBrowserReauthRequired();
      setSessionErrorMessage("");
      setErrorMessage("");
      return true;
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return false;
      }

      throw error;
    }
  }, [
    clearConfirmedUserScopedState,
    resolveInitialWorkspace,
    session,
    sessionLoadState,
    sessionVerificationState,
    setCloudSettings,
    setErrorMessage,
    setSession,
    setSessionErrorMessage,
    setSessionLoadState,
    setSessionVerificationState,
  ]);

  const runResumeAttempt = useCallback(async function runResumeAttempt(): Promise<void> {
    const isSessionValid = await revalidateActiveSession();
    if (isSessionValid) {
      await runSyncSilently();
    }

    setSessionErrorMessage("");
    setErrorMessage("");
  }, [revalidateActiveSession, runSyncSilently, setErrorMessage, setSessionErrorMessage]);

  const resumeInBackground = useCallback(async function resumeInBackground(): Promise<void> {
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
          attemptNumber += 1;
        }
      }

      const nextErrorMessage = getErrorMessage(lastError);
      setErrorMessage(nextErrorMessage);
      throw lastError;
    })().finally(() => {
      if (resumePromiseRef.current === trackedResumePromise) {
        resumePromiseRef.current = null;
      }
    });

    resumePromiseRef.current = trackedResumePromise;
    return trackedResumePromise;
  }, [runResumeAttempt, setErrorMessage]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || sessionVerificationState !== "verified" || session === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    }, 60_000);

    const handleResume = (): void => {
      void resumeInBackground();
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
  }, [resumeInBackground, runSync, session, sessionLoadState, sessionVerificationState]);

  return {
    initialize,
  };
}
