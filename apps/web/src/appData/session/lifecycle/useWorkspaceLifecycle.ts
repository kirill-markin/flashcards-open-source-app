import { retireEntryWorkspaceAddress } from "../activation/workspaceActivationHelpers";
import { clearWebSyncCacheForLocalBrowserDataCleanup } from "../../../localDb/cache";
import { requireWorkspaceMediaUploadsCompleted } from "../../../localDb/mediaTransfers";
import { isBrowserGuestSessionVerified, pauseBrowserGuestSession } from "../../../api/transport/transport";
import { GuestConversionRequiredError, loadBrowserProductSession, loadCachedBrowserGuestOwner, readBrowserGuestVerificationGeneration, requireBrowserGuestVerificationGeneration, restoreBrowserGuestSessionAfterCleanup } from "../guest/browserGuestSession";
import { invalidateBrowserGuestOwnership, readBrowserGuestState, readPendingGuestConversion, runWithBrowserGuestLock, subscribeToBrowserGuestChanges } from "../guest/browserGuestStorage";
import { consumeAcceptedBrowserSignInMethod, readBrowserSignInInformationGeneration } from "../../../api/browserHints";
import { readPendingConnection, storePendingConnection } from "../../../screens/settings/account/accountConnectionPending";
import { getAppConfig } from "../../../config";
import { projectSessionToLocalOwner } from "../../../api/transport/sessionIdentity";
import { mergeRefreshedSessionPreferences, readAccountPreferencesWriteVersion } from "../accentColorWrite";
import { clearEntitlementState, readEntitlementIdentityGeneration, setEntitlementIdentity } from "../../../premium/entitlementStore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  buildLogoutLocalUrl,
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
import {
  registerAnalyticsSessionOwnerPublisher,
  setAnalyticsConfirmedOwner,
  syncAnalyticsPreferencesWithAccount,
  track,
  readAnalyticsSessionOwnerId,
} from "../../../analytics";
import { clearAnalyticsVisitorCookie, resetAnalyticsSession } from "../../../analytics/identity";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";
import type { TranslationKey } from "../../../i18n";
import { isIndexedDbUnavailableError } from "../../../localDb/core/indexedDbAvailability";
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
import { linkWebGuestIdentityInBackground } from "../guest/webGuestIdentityLink";
import {
  readStoredWebGuestSession,
  readWebGuestIdentityGeneration,
} from "../guest/webGuestSession";
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
import type { CloudSettings, SessionInfo } from "../../../types";

const sessionInitializationInvalidatedMessage = "Session changed during initialization. Retry to verify the current account.";

type UseWorkspaceLifecycleParams =
  & Readonly<{
    t: (key: TranslationKey) => string;
    runSyncSilently: () => Promise<void>;
    discardAllSyncWork: (action: () => Promise<void>) => Promise<void>;
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
    case "GUEST_BROWSER_CRAWLER_REFUSED":
      return true;
  }

  return false;
}

function runLifecycleTaskInBackground(task: Promise<void>): void {
  void task.catch((): void => undefined);
}

// Cleanup invalidates the session response that preceded it, including on an account switch.
async function restoreEntitlementIdentityAfterCleanup(userId: string): Promise<number> {
  const generation = readEntitlementIdentityGeneration();
  const currentSession = await revalidateSessionRequest();
  if (generation !== readEntitlementIdentityGeneration()) {
    throw createSessionAccountSwitchError(sessionInitializationInvalidatedMessage);
  }
  if (currentSession.userId !== userId) {
    throw createSessionAccountSwitchError("Session identity changed during entitlement restoration");
  }
  if (setEntitlementIdentity(userId, generation) === false) {
    throw createSessionAccountSwitchError(sessionInitializationInvalidatedMessage);
  }
  return generation;
}

function requireBrowserGuestOwnerForInitialization(session: SessionInfo, generation: number | null): void {
  requireBrowserGuestVerificationGeneration(session.userId, generation);
  const saved = readBrowserGuestState();
  if (saved?.status !== "owned" || saved.owner.userId !== session.userId
    || saved.owner.workspaceId !== session.selectedWorkspaceId || saved.owner.pending !== null) {
    throw createSessionAccountSwitchError(sessionInitializationInvalidatedMessage);
  }
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
    discardAllSyncWork,
    resolveInitialWorkspace,
    clearConfirmedUserScopedState,
    indexedDbOpenRecoveryState,
  } = params;
  // The resume chain feeds the periodic revalidate timer, so it depends on the
  // active workspace id instead of the workspace object: publishing the same
  // workspace as a new object must not tear down and restart that timer.
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  // One-use method consumption must survive a ready-to-ready workspace switch.
  const hasReadyWorkspace = activeWorkspaceId !== null;
  const sessionUserId = session?.userId ?? null;
  const [guestConversionPending, setGuestConversionPending] = useState(() => readPendingGuestConversion() !== null);
  const initializePromiseRef = useRef<Promise<void> | null>(null);
  const resumePromiseRef = useRef<Promise<void> | null>(null);
  const analyticsReadyRef = useRef<Readonly<{ userId: string; ready: Promise<void> }> | null>(null);

  const showCachedGuestRecovery = useCallback(async (error: Error): Promise<boolean> => {
    if (error instanceof GuestConversionRequiredError) return false;
    let owner: CloudSettings | null;
    try {
      owner = await loadCachedBrowserGuestOwner();
    } catch (recoveryError) {
      const storageError = normalizeCaughtError(recoveryError);
      indexedDbOpenRecoveryState.markFailed(storageError);
      if (indexedDbOpenRecoveryState.hasFailed()) return true;
      setSessionLoadState("error");
      setSessionErrorMessage(getErrorMessage(storageError));
      setSessionTechnicalError(storageError);
      return true;
    }
    if (owner === null) return false;
    pauseBrowserGuestSession();
    await discardAllSyncWork(async () => {
      setSession(null);
      setActiveWorkspace(null);
      setAvailableWorkspaces([]);
      setCloudSettings(owner);
      setSessionVerificationState("unverified");
      setSessionLoadState("guest_recovery");
      setSessionErrorMessage(`${t("guest.recovery")} ${getErrorMessage(error)}`);
      setSessionTechnicalError(error);
      setTechnicalError(null);
    });
    return true;
  }, [discardAllSyncWork, indexedDbOpenRecoveryState, setActiveWorkspace, setAvailableWorkspaces, setCloudSettings, setSession, setSessionErrorMessage, setSessionLoadState, setSessionTechnicalError, setSessionVerificationState, setTechnicalError, t]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || sessionVerificationState !== "verified"
      || session?.browserGuestCapabilities?.isGuest === true || sessionUserId === null || !hasReadyWorkspace) return;
    const userId = sessionUserId;
    const generation = readEntitlementIdentityGeneration();
    const informationGeneration = readBrowserSignInInformationGeneration();
    let current = true;
    const isCurrent = (): boolean => current && !indexedDbOpenRecoveryState.hasFailed()
      && informationGeneration === readBrowserSignInInformationGeneration()
      && generation === readEntitlementIdentityGeneration() && readAnalyticsSessionOwnerId() === userId;
    void (async (): Promise<void> => {
      const preferences = analyticsReadyRef.current;
      if (preferences?.userId !== userId) return;
      await preferences.ready;
      if (!isCurrent()) return;
      const verified = await revalidateSessionRequest();
      if (!isCurrent() || verified.userId !== userId) return;
      const method = await consumeAcceptedBrowserSignInMethod((suggestion) => {
        if (!isCurrent()) return;
        if (readPendingConnection(userId) !== null) return;
        storePendingConnection({ userId, phase: "suggestion", suggestion: suggestion.suggestion,
          csrfToken: suggestion.suggestion, expiresAt: Date.parse(suggestion.expiresAt) });
        window.location.assign(getAppConfig().appBaseUrl + "/settings/account-status");
      });
      if (method === null || !isCurrent()) return;
      track({ name: "auth_session_accepted", screen: "signin", method });
      track({ name: "auth_account_ready", screen: "signin", method });
    })().catch((error: unknown): void => {
      if (isCurrent()) setErrorMessage(normalizeCaughtError(error).message);
    });
    return () => { current = false; };
  }, [hasReadyWorkspace, indexedDbOpenRecoveryState, session?.browserGuestCapabilities?.isGuest, sessionUserId, sessionLoadState, sessionVerificationState, setErrorMessage]);

  useEffect(() => {
    let hadPending = readPendingGuestConversion() !== null;
    setGuestConversionPending(hadPending);
    return subscribeToBrowserGuestChanges(() => {
      const saved = readBrowserGuestState();
      const wasPending = hadPending;
      hadPending = saved?.status === "owned" && saved.owner.pending !== null;
      setGuestConversionPending(hadPending);
      if (session?.browserGuestCapabilities?.isGuest !== true) return;
      if (saved?.status === "owned" && saved.owner.pending === null && saved.owner.userId === session.userId
        && saved.owner.workspaceId === session.selectedWorkspaceId) {
        if (wasPending || isBrowserGuestSessionVerified(saved.owner.userId, saved.owner.workspaceId) === false) {
          setSessionVerificationState("unverified");
        }
        return;
      }
      setSessionVerificationState("unverified");
    });
  }, [session, setSessionVerificationState]);

  useEffect(() => {
    if (session?.browserGuestCapabilities?.isGuest === true
      && (sessionLoadState === "ready" || sessionLoadState === "guest_conversion")
      && sessionVerificationState === "unverified" && guestConversionPending === false
      && readPendingGuestConversion() === null) {
      void initializeRef.current();
    }
  }, [guestConversionPending, session, sessionLoadState, sessionVerificationState]);

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

  const initializeSession = useCallback(async function initializeSession(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const shouldPreserveWarmStartState = sessionLoadState === "ready"
      && sessionVerificationState === "unverified"
      && session !== null
      && activeWorkspace !== null
      && availableWorkspaces.length > 0;

    if (shouldPreserveWarmStartState === false) {
      if (sessionLoadState !== "guest_conversion") setSessionLoadState("loading");
      setActiveWorkspace(null);
      setAvailableWorkspaces([]);
    }

    setEntitlementIdentity(session?.userId ?? null, readEntitlementIdentityGeneration());
    setSessionVerificationState("unverified");
    setSessionErrorMessage("");
    setErrorMessage("");
    setSessionTechnicalError(null);
    setTechnicalError(null);

    // Read before any of the identity-boundary cleanup below can clear it. This is the guest
    // identity this browser measured under while signed out, and the link at the end of a verified
    // sign-in is the only thing that carries its analytics history into the account.
    //
    // The generation is captured with it, because reading early also survives the boots where that
    // cleanup fires for the worst reason there is: a confirmed account switch or an unknown reauth
    // owner, where the envelope belongs to the person who left rather than to the one signing in.
    // The link refuses to run once this number has moved on.
    const storedGuestSession = readStoredWebGuestSession();
    const storedGuestIdentityGeneration = readWebGuestIdentityGeneration();

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
      let entitlementGeneration = readEntitlementIdentityGeneration();
      const preferenceWriteVersion = readAccountPreferencesWriteVersion();
      let currentSession: SessionInfo;
      try {
        currentSession = await loadBrowserProductSession();
      } catch (error) {
        if (
          isAccountDeletionPending()
          && error instanceof ApiError
          && error.code === "ACCOUNT_DELETED"
        ) {
          markAccountDeletionServerConfirmed();
          // Where a deletion this browser dispatched but never saw answered is confirmed instead,
          // so the visitor identity and the session reporting under it are retired together, for
          // the reason stated at the other confirmation site
          // (`accountDeletion/AccountDeletionRecoveryGate.tsx`). The resume above is not a third
          // site: it runs on a later load of a browser that has already retired both.
          //
          // Nothing is reported here, and that is a decision rather than an omission. There is no
          // usable credential — `getSession()` has just answered `410 ACCOUNT_DELETED` — and the
          // resume two statements below runs `clearConfirmedUserScopedState`, which resets
          // analytics and discards the queue with `shouldReportDiscard`. A `signed_out` row written
          // here would therefore be destroyed before any flush could carry it, and would add one
          // more to the boundary-loss signal on every single confirmed resume, teaching that
          // observability number to read a designed outcome as a loss. The fact itself is reported
          // at the site that dispatched the deletion and drained before it.
          clearAnalyticsVisitorCookie();
          resetAnalyticsSession();
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

      let guestVerificationGeneration = readBrowserGuestVerificationGeneration(currentSession.userId);
      let persistedCloudSettings = await loadCloudSettings();
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      if (entitlementGeneration !== readEntitlementIdentityGeneration()) {
        throw createSessionAccountSwitchError(sessionInitializationInvalidatedMessage);
      }

      const completion = readPendingGuestConversion();
      const hasFinalizedGuestConversion = completion?.phase === "completed" && completion.result !== null
        && completion.destinationUserId === currentSession.userId;
      if (hasFinalizedGuestConversion && completion?.result !== null && completion?.result !== undefined) {
        currentSession = { ...currentSession, selectedWorkspaceId: completion.result.workspace.workspaceId };
        const destinationSession = currentSession;
        const destinationWorkspaceId = completion.result.workspace.workspaceId;
        persistedCloudSettings = await runWithBrowserGuestLock("exclusive", async () => {
          const owner = await loadCloudSettings();
          const alreadyOwnsDestination = owner?.linkedUserId === destinationSession.userId && owner.linkedWorkspaceId === destinationWorkspaceId;
          if (alreadyOwnsDestination) {
            if (owner?.cloudState === "guest") invalidateBrowserGuestOwnership();
            const installed = buildLinkedCloudSettings(destinationSession, destinationWorkspaceId, owner);
            await putCloudSettings(installed);
            return installed;
          }
          if (owner !== null && owner.linkedUserId !== completion.sourceUserId) {
            throw new Error("Local owner differs from both saved conversion accounts. Preserve local data before recovery.");
          }
          invalidateBrowserGuestOwnership();
          await discardAllSyncWork(async () => {
            if (owner !== null) {
              await requireWorkspaceMediaUploadsCompleted(completion.sourceWorkspaceId);
              await clearWebSyncCacheForLocalBrowserDataCleanup(indexedDbOpenRecoveryState.throwIfFailed);
            }
            indexedDbOpenRecoveryState.throwIfFailed();
            await putCloudSettings(buildLinkedCloudSettings(destinationSession, destinationWorkspaceId, owner));
          });
          indexedDbOpenRecoveryState.throwIfFailed();
          const installed = await loadCloudSettings();
          if (installed?.linkedUserId !== destinationSession.userId || installed.linkedWorkspaceId !== destinationWorkspaceId) {
            throw new Error("The converted destination owner could not be installed.");
          }
          return installed;
        });
        retireEntryWorkspaceAddress();
      }

      currentSession = projectSessionToLocalOwner(currentSession, persistedCloudSettings?.linkedUserId ?? null);
      if (setEntitlementIdentity(currentSession.userId, entitlementGeneration) === false) {
        throw createSessionAccountSwitchError(sessionInitializationInvalidatedMessage);
      }
      setWebObservabilityUser({ id: currentSession.userId });
      const localDataCleanupReason = hasFinalizedGuestConversion ? null : resolveLocalDataCleanupReasonForVerifiedSession(
        persistedCloudSettings,
        currentSession,
        wasBrowserReauthRequired,
      );
      if (localDataCleanupReason !== null) {
        if (currentSession.browserGuestCapabilities?.isGuest === true) {
          currentSession = await restoreBrowserGuestSessionAfterCleanup(currentSession, guestVerificationGeneration, async () => {
            if (entitlementGeneration !== readEntitlementIdentityGeneration()) {
              throw createSessionAccountSwitchError(sessionInitializationInvalidatedMessage);
            }
            await clearConfirmedUserScopedState(localDataCleanupReason);
            indexedDbOpenRecoveryState.throwIfFailed();
          });
          guestVerificationGeneration = readBrowserGuestVerificationGeneration(currentSession.userId);
        } else {
          await clearConfirmedUserScopedState(localDataCleanupReason);
        }
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }
        const restoredGeneration = await restoreEntitlementIdentityAfterCleanup(currentSession.userId);
        entitlementGeneration = restoredGeneration;
      }

      if (currentSession.browserGuestCapabilities?.isGuest === true) {
        requireBrowserGuestOwnerForInitialization(currentSession, guestVerificationGeneration);
      }
      clearBrowserReauthRequired();
      const linkingReadyCloudSettings = buildLinkingReadyCloudSettings(
        currentSession,
        localDataCleanupReason === null ? persistedCloudSettings : null,
      );
      await putCloudSettings(linkingReadyCloudSettings);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      if (currentSession.browserGuestCapabilities?.isGuest === true) {
        requireBrowserGuestOwnerForInitialization(currentSession, guestVerificationGeneration);
      }
      if (setEntitlementIdentity(currentSession.userId, entitlementGeneration) === false) {
        throw createSessionAccountSwitchError(sessionInitializationInvalidatedMessage);
      }
      setCloudSettings(linkingReadyCloudSettings);
      setSession((previousSession): SessionInfo => previousSession === null
        ? currentSession
        : mergeRefreshedSessionPreferences(previousSession, currentSession, preferenceWriteVersion));
      await resolveInitialWorkspace(currentSession);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      // Publishes the account this browser's credential belongs to. The analytics queue stores the
      // account it was filled under, so this is what lets analytics compare the two and either ship
      // or discard; until it is published nothing is sent, which is why it is only reached once the
      // session is verified and any user-scoped cleanup has already run.
      setAnalyticsConfirmedOwner(currentSession.userId);
      // Reconciles this browser's two analytics answers with the account's, which win where both
      // exist. Not awaited here, like the link below: no sign-in may wait on analytics. The link
      // does wait for it, because it must not spend the guest identity on answers this is about to
      // replace.
      const analyticsPreferencesSync = syncAnalyticsPreferencesWithAccount(
        currentSession.preferences,
      );
      analyticsReadyRef.current = { userId: currentSession.userId, ready: analyticsPreferencesSync };
      // Started after the owner publish above, and never awaited: no user action may be blocked,
      // delayed or failed by an analytics call. `getSession()` above is also the
      // request-context call the route requires to have run first, and the account it verified is
      // passed along so the link can assert, on every attempt and on every later load, that it is
      // still binding the envelope to the account it started for.
      if (currentSession.browserGuestCapabilities?.isGuest !== true) linkWebGuestIdentityInBackground(
        storedGuestSession,
        storedGuestIdentityGeneration,
        currentSession.userId,
        analyticsPreferencesSync,
      );
      setSessionVerificationState("verified");
    } catch (error) {
      if (error instanceof GuestConversionRequiredError) {
        setSessionLoadState("guest_conversion");
        setSessionErrorMessage("");
        setSessionTechnicalError(null);
        setTechnicalError(null);
        return;
      }
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
        clearEntitlementState();
        setSession(null);
        setWebObservabilityUser(null);
        setActiveWorkspace(null);
        setAvailableWorkspaces([]);
        setCloudSettings(null);
        setSessionLoadState("redirecting");
        return;
      }

      if (isIndexedDbUnavailableError(normalizedError)) {
        // This browser exposes no IndexedDB at all. It is not a fault of this app and retrying
        // cannot change it, so the gate below must not report it or offer a retry.
        setSessionLoadState("storage_unavailable");
        setSessionErrorMessage(t("appError.storageUnavailable.message"));
        setSessionTechnicalError(null);
        setTechnicalError(null);
        return;
      }

      const nextErrorMessage = getErrorMessage(normalizedError);
      if (await showCachedGuestRecovery(normalizedError)) return;
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
    discardAllSyncWork,
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
    showCachedGuestRecovery,
  ]);

  const initialize = useCallback(function initialize(): Promise<void> {
    if (initializePromiseRef.current !== null) return initializePromiseRef.current;
    const initializing = initializeSession().finally(() => {
      if (initializePromiseRef.current === initializing) initializePromiseRef.current = null;
    });
    initializePromiseRef.current = initializing;
    return initializing;
  }, [initializeSession]);

  const initializeRef = useRef(initialize);

  useEffect(() => {
    initializeRef.current = initialize;
  }, [initialize]);

  // Announces, for as long as this layer is mounted, that an account owner can still be published on
  // this page load. Analytics reports nothing credential-free while that holds, so a signed-in
  // person's events wait for their session rather than going out as a visitor's. The public catalog,
  // invite and share routes mount no session layer, so a visitor there is measured as one unless
  // this browser's own `logged_in` cookie says an account owns it.
  useEffect(() => {
    return registerAnalyticsSessionOwnerPublisher();
  }, []);

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

    const entitlementGeneration = readEntitlementIdentityGeneration();
    const preferenceWriteVersion = readAccountPreferencesWriteVersion();
    try {
      const verifiedSession = await loadBrowserProductSession();
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return false;
      }

      if (entitlementGeneration !== readEntitlementIdentityGeneration()) {
        return false;
      }

      const persistedCloudSettings = await loadCloudSettings();
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return false;
      }
      const currentSession = projectSessionToLocalOwner(verifiedSession, persistedCloudSettings?.linkedUserId ?? null);
      if (currentSession.userId !== session.userId) {
        try {
          setWebObservabilityUser({ id: currentSession.userId });
          await clearConfirmedUserScopedState("confirmed_account_switch");
          if (indexedDbOpenRecoveryState.hasFailed()) {
            return false;
          }

          const restoredGeneration = await restoreEntitlementIdentityAfterCleanup(currentSession.userId);
          clearBrowserReauthRequired();
          const linkingReadyCloudSettings = buildLinkingReadyCloudSettings(currentSession, null);
          await putCloudSettings(linkingReadyCloudSettings);
          if (indexedDbOpenRecoveryState.hasFailed()) {
            return false;
          }

          if (setEntitlementIdentity(currentSession.userId, restoredGeneration) === false) {
            throw createSessionAccountSwitchError(sessionInitializationInvalidatedMessage);
          }
          setCloudSettings(linkingReadyCloudSettings);
          await resolveInitialWorkspace(currentSession);
          if (indexedDbOpenRecoveryState.hasFailed()) {
            return false;
          }

          // No guest link here, deliberately. A different account now holds this browser, so any
          // envelope still stored was the previous person's: `clearConfirmedUserScopedState` above
          // dropped it and advanced the guest identity generation, which also stops a link started
          // by `initialize` from binding it to the account being published on this line.
          setAnalyticsConfirmedOwner(currentSession.userId);
          analyticsReadyRef.current = { userId: currentSession.userId,
            ready: syncAnalyticsPreferencesWithAccount(currentSession.preferences) };
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

      // A long-lived tab can lose the persisted cloud settings record after
      // startup (storage eviction, another tab clearing browser data). Restore
      // it here so sync keeps a verified installation id without a reload.
      if (persistedCloudSettings === null) {
        const repairedCloudSettings = activeWorkspaceId === null
          ? buildLinkingReadyCloudSettings(currentSession, null)
          : buildLinkedCloudSettings(currentSession, activeWorkspaceId, null);
        await putCloudSettings(repairedCloudSettings);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return false;
        }

        setCloudSettings(repairedCloudSettings);
      }

      if (setEntitlementIdentity(currentSession.userId, entitlementGeneration) === false) {
        return false;
      }
      setSession((previousSession): SessionInfo | null => previousSession === null
        ? null
        : mergeRefreshedSessionPreferences(previousSession, currentSession, preferenceWriteVersion));
      clearBrowserReauthRequired();
      setSessionErrorMessage("");
      setErrorMessage("");
      setSessionTechnicalError(null);
      setTechnicalError(null);
      return true;
    } catch (error) {
      indexedDbOpenRecoveryState.markFailed(error);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (error instanceof GuestConversionRequiredError) {
        setSessionVerificationState("unverified");
        setSessionLoadState("guest_conversion");
        setSessionErrorMessage("");
        setSessionTechnicalError(null);
        setTechnicalError(null);
        return false;
      }
      if (session?.browserGuestCapabilities?.isGuest === true && await showCachedGuestRecovery(normalizeCaughtError(error))) return false;
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
    showCachedGuestRecovery,
  ]);

  const runResumeAttempt = useCallback(async function runResumeAttempt(): Promise<void> {
    const isSessionValid = await revalidateActiveSession();
    if (!isSessionValid) return;
    await runSyncSilently();

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
