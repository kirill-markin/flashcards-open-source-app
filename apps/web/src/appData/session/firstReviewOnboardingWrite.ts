import { useCallback, useEffect, useRef, useState } from "react";
import { updateAccountPreferences } from "../../api";
import { track } from "../../analytics";
import {
  acknowledgeFirstReviewOnboarding,
  loadFirstReviewOnboarding,
  initializeFirstReviewOnboarding,
  persistFirstReviewOnboardingTransition,
  reconcileFirstReviewOnboarding,
  type FirstReviewOnboardingRecord,
} from "../../localDb/sync/firstReviewOnboarding";
import { loadCloudSettings } from "../../localDb/sync/cloudSettings";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import { readEntitlementIdentityGeneration, subscribeToEntitlement } from "../../premium/entitlementStore";
import type { SessionInfo } from "../../types";
import { beginAccountPreferenceWrite, finishAccountPreferenceWrite, isCurrentAccountPreferenceWrite } from "./accentColorWrite";
import { requireBrowserGuestSyncReady, requireBrowserGuestWritesReady, runWithBrowserGuestLock, runWithBrowserGuestWorkLock } from "./guest/browserGuestStorage";
import { readBrowserGuestVerificationGeneration, requireBrowserGuestVerificationGeneration } from "./guest/browserGuestSession";

const deliveries = new Map<string, Promise<void>>();

function reportError(error: unknown, userId: string): void {
  console.error("First review onboarding preference could not be saved", { userId, error });
  captureAppOperationError(error, { feature: "settings", operation: "account_preferences_update",
    userId, workspaceId: null, installationId: null, entityId: null });
}

export async function deliverFirstReviewOnboarding(session: SessionInfo, signal: AbortSignal): Promise<void> {
  while (deliveries.has(session.userId)) {
    await deliveries.get(session.userId);
    if (signal.aborted) return;
  }
  const pending = await loadFirstReviewOnboarding(session.userId);
  if (pending === undefined || pending.pendingGeneration === null || signal.aborted) return;
  const identityGeneration = readEntitlementIdentityGeneration();
  const guestGeneration = session.browserGuestCapabilities?.isGuest === true
    ? readBrowserGuestVerificationGeneration(session.userId) : null;
  if (session.browserGuestCapabilities?.isGuest === true && guestGeneration === null) {
    throw new Error("Browser guest verification is required to deliver onboarding preferences.");
  }
  const deliver = async (): Promise<void> => {
    while (!signal.aborted && identityGeneration === readEntitlementIdentityGeneration()) {
      const record = await loadFirstReviewOnboarding(session.userId);
      if (record?.pendingGeneration === null || record === undefined) return;
      if (signal.aborted || identityGeneration !== readEntitlementIdentityGeneration()) return;
      if (session.browserGuestCapabilities?.isGuest === true) {
        requireBrowserGuestSyncReady(session.userId);
        if (guestGeneration !== null) requireBrowserGuestVerificationGeneration(session.userId, guestGeneration);
      }
      const write = beginAccountPreferenceWrite(session.userId, "firstReviewOnboardingCompleted");
      try {
        await updateAccountPreferences({ firstReviewOnboardingCompleted: record.completed }, { userId: session.userId, signal });
        if (signal.aborted || !isCurrentAccountPreferenceWrite(write)) return;
        if (guestGeneration !== null) requireBrowserGuestVerificationGeneration(session.userId, guestGeneration);
        await acknowledgeFirstReviewOnboarding(session.userId, record.pendingGeneration);
      } finally {
        finishAccountPreferenceWrite(write);
      }
    }
  };
  const serialize = (): Promise<void> => navigator.locks.request(
    "first-review-onboarding-delivery:" + session.userId, { signal }, deliver,
  );
  const task = session.browserGuestCapabilities?.isGuest === true
    ? runWithBrowserGuestWorkLock(signal, serialize) : serialize();
  deliveries.set(session.userId, task);
  try {
    await task;
  } finally {
    if (deliveries.get(session.userId) === task) deliveries.delete(session.userId);
  }
}

type Options = Readonly<{
  session: SessionInfo | null;
  verified: boolean;
  writable: boolean;
  cachedPreferenceKnown: boolean;
  syncInProgress: boolean;
  applyCompleted: (userId: string, completed: boolean) => void;
}>;

export function useFirstReviewOnboarding(options: Options): Readonly<{
  completed: boolean | null;
  setCompleted: (completed: boolean, source: "review" | "settings") => Promise<void>;
  completeAfterReview: (userId: string) => Promise<void>;
}> {
  const { session, verified, cachedPreferenceKnown, syncInProgress } = options;
  const [local, setLocal] = useState<Readonly<{ userId: string; record: FirstReviewOnboardingRecord | undefined }> | null>(null);
  const current = useRef(options);
  current.current = options;
  const deliveryAbort = useRef<AbortController | null>(null);
  const publishVersion = useRef(0);
  const sessionUserId = session?.userId ?? null;
  const remoteCompleted = session?.preferences.firstReviewOnboardingCompleted ?? null;

  const refresh = useCallback(async (): Promise<void> => {
    const owner = current.current.session;
    if (owner === null) return;
    const version = publishVersion.current;
    const generation = readEntitlementIdentityGeneration();
    const record = await loadFirstReviewOnboarding(owner.userId);
    if (current.current.session?.userId === owner.userId && version === publishVersion.current
      && generation === readEntitlementIdentityGeneration()) {
      setLocal({ userId: owner.userId, record });
    }
  }, []);

  const retry = useCallback(async (): Promise<void> => {
    const state = current.current;
    const controller = deliveryAbort.current;
    if (!state.verified || state.session === null || controller === null || controller.signal.aborted || !navigator.onLine) return;
    try {
      await deliverFirstReviewOnboarding(state.session, controller.signal);
      if (!controller.signal.aborted) await refresh();
    } catch (error) {
      if (!controller.signal.aborted) reportError(error, state.session.userId);
    }
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    deliveryAbort.current = controller;
    const generation = readEntitlementIdentityGeneration();
    const unsubscribe = subscribeToEntitlement(() => {
      if (readEntitlementIdentityGeneration() !== generation) controller.abort();
    });
    return (): void => { controller.abort(); unsubscribe(); };
  }, [sessionUserId, verified]);

  useEffect(() => {
    if (sessionUserId === null) return;
    let cancelled = false;
    const version = ++publishVersion.current;
    const generation = readEntitlementIdentityGeneration();
    const reconcile = verified
      ? reconcileFirstReviewOnboarding(sessionUserId, remoteCompleted)
      : initializeFirstReviewOnboarding(sessionUserId, cachedPreferenceKnown ? remoteCompleted : null);
    void reconcile.then((record) => {
      if (!cancelled && version === publishVersion.current && generation === readEntitlementIdentityGeneration()) {
        publishVersion.current += 1;
        setLocal({ userId: sessionUserId, record });
        if (record !== undefined && record.pendingGeneration !== null
          && current.current.session?.preferences.firstReviewOnboardingCompleted !== record.completed) {
          current.current.applyCompleted(sessionUserId, record.completed);
        }
        void retry();
      }
    }).catch((error: unknown) => { if (!cancelled) reportError(error, sessionUserId); });
    return (): void => { cancelled = true; };
  }, [cachedPreferenceKnown, remoteCompleted, retry, sessionUserId, verified]);

  useEffect(() => {
    if (!syncInProgress) void retry();
    const onOnline = (): void => { void retry(); };
    window.addEventListener("online", onOnline);
    return (): void => { window.removeEventListener("online", onOnline); };
  }, [retry, syncInProgress]);

  const persistCompleted = useCallback(async (completed: boolean, source: "review" | "settings"): Promise<void> => {
    const state = current.current;
    const owner = state.session;
    if (owner === null || !state.writable) throw new Error("First review onboarding requires the current writable session.");
    publishVersion.current += 1;
    const identityGeneration = readEntitlementIdentityGeneration();
    const guestGeneration = owner.browserGuestCapabilities?.isGuest === true
      ? readBrowserGuestVerificationGeneration(owner.userId) : null;
    const persist = async (): Promise<void> => {
      if (current.current.session?.userId !== owner.userId || identityGeneration !== readEntitlementIdentityGeneration()) return;
      if (owner.browserGuestCapabilities?.isGuest === true) {
        if (guestGeneration === null) throw new Error("Browser guest is unverified; onboarding changes are paused.");
        requireBrowserGuestVerificationGeneration(owner.userId, guestGeneration);
        if (source === "review") requireBrowserGuestSyncReady(owner.userId);
        else requireBrowserGuestWritesReady(owner.userId);
      }
      const cloud = await loadCloudSettings();
      if (cloud?.linkedUserId !== owner.userId) throw new Error("Onboarding preference owner differs from the local workspace owner.");
      if (current.current.session?.userId !== owner.userId || identityGeneration !== readEntitlementIdentityGeneration()) return;
      const result = await persistFirstReviewOnboardingTransition(owner.userId, completed,
        () => current.current.session?.userId === owner.userId && identityGeneration === readEntitlementIdentityGeneration());
      if (current.current.session?.userId !== owner.userId || identityGeneration !== readEntitlementIdentityGeneration()) return;
      publishVersion.current += 1;
      setLocal({ userId: owner.userId, record: result.record });
      if (result.record !== undefined) current.current.applyCompleted(owner.userId, result.record.completed);
      if (result.changed) track(completed ? { name: "first_review_onboarding_completed", source } : { name: "first_review_onboarding_reset" });
    };
    if (owner.browserGuestCapabilities?.isGuest === true && source === "settings") {
      await runWithBrowserGuestLock("shared", persist);
    } else {
      await persist();
    }
    void retry();
  }, [retry]);

  const completeAfterReview = useCallback(async (userId: string): Promise<void> => {
    if (current.current.session?.userId !== userId) return;
    try {
      await persistCompleted(true, "review");
    } catch (error) {
      const userId = current.current.session?.userId;
      if (userId !== undefined) reportError(error, userId);
    }
  }, [persistCompleted]);

  return { completed: local?.userId === sessionUserId ? local?.record?.completed ?? null : null,
    setCompleted: persistCompleted, completeAfterReview };
}
