import { useCallback, useEffect, useRef } from "react";
import { loadPaywallState, recordPaywallShown } from "../../api/endpoints/paywallState";
import type { PaywallShownInput, PaywallState } from "../../apiContracts/paywallState";
import { useAppData } from "../../appData";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import { isStripeBillingInvalidated, subscribeToStripeBillingInvalidation } from "../stripeIntent";
import { acknowledgePaywallShown, readEffectivePaywallState, readPendingPaywallShown, storeFetchedPaywallState, storePaywallShown } from "./storage";

type PaywallStateAccess = Readonly<{
  readState: () => PaywallState | null;
  recordVisible: (input: PaywallShownInput) => void;
}>;

export function useReviewPaywallState(): PaywallStateAccess {
  const { session, isSessionVerified } = useAppData();
  const userId = session?.userId ?? null;
  const linkedIds = isSessionVerified && session?.canonicalAccountId !== undefined
    && session.linkedAccountIds?.includes(session.canonicalAccountId) === true
    && session.linkedAccountIds.includes(session.userId) ? session.linkedAccountIds : [];
  const userIds = [...new Set([...(userId === null ? [] : [userId]), ...linkedIds])].sort();
  const identityKey = userIds.join(":");
  const idsRef = useRef<ReadonlyArray<string>>(userIds);
  idsRef.current = userIds;
  const syncRef = useRef<(() => Promise<void>) | null>(null);

  const reportFailure = useCallback((error: unknown): void => {
    console.error("Paywall display state operation failed", { userId, error });
    captureAppOperationError(error, {
      feature: "settings", operation: "paywall_state_sync", userId,
      workspaceId: null, installationId: null, entityId: null,
    });
  }, [userId]);

  const readState = useCallback((): PaywallState | null => {
    return userId === null || isStripeBillingInvalidated() ? null : readEffectivePaywallState(idsRef.current);
  }, [userId]);

  const recordVisible = useCallback((input: PaywallShownInput): void => {
    if (userId === null || isStripeBillingInvalidated()) return;
    try {
      storePaywallShown(userId, input);
      void syncRef.current?.();
    } catch (error) {
      reportFailure(error);
    }
  }, [reportFailure, userId]);

  useEffect(() => {
    if (!isSessionVerified || userId === null) return;
    const controller = new AbortController();
    const userIds = idsRef.current;
    const identity = { userId, signal: controller.signal };
    let inFlight: Promise<void> | null = null;
    const isCurrent = (): boolean => !controller.signal.aborted && !isStripeBillingInvalidated();

    async function runSync(): Promise<void> {
      let hasLoadedState = false;
      while (isCurrent()) {
        const input = readPendingPaywallShown(userIds)[0];
        if (input === undefined) {
          if (hasLoadedState) return;
          const state = await loadPaywallState(identity);
          if (!isCurrent()) return;
          await storeFetchedPaywallState(identity.userId, state, controller.signal);
        } else {
          const state = await recordPaywallShown(identity, input);
          if (!isCurrent()) return;
          await acknowledgePaywallShown(userIds, input, state, controller.signal);
        }
        hasLoadedState = true;
      }
    }

    function sync(): Promise<void> {
      if (!isCurrent()) return Promise.resolve();
      if (inFlight !== null) return inFlight;
      const next = runSync().catch((error: unknown): void => {
        if (isCurrent()) reportFailure(error);
      }).finally((): void => {
        if (inFlight === next) inFlight = null;
      });
      inFlight = next;
      return next;
    }

    function onReconnect(): void { void sync(); }
    function onVisibilityChange(): void { if (document.visibilityState === "visible") void sync(); }
    const unsubscribe = subscribeToStripeBillingInvalidation(() => controller.abort());
    syncRef.current = sync;
    void sync();
    window.addEventListener("online", onReconnect);
    window.addEventListener("focus", onReconnect);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return (): void => {
      controller.abort();
      unsubscribe();
      if (syncRef.current === sync) syncRef.current = null;
      window.removeEventListener("online", onReconnect);
      window.removeEventListener("focus", onReconnect);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [identityKey, isSessionVerified, reportFailure, session?.csrfToken, userId]);

  return { readState, recordVisible };
}
