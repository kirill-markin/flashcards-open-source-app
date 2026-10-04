import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { combineAbortSignals } from "../abortSignals";
import { isAwaitingAnalyticsConsentDecision, track, type AnalyticsPurchaseOutcome } from "../analytics";
import { ApiError, isAuthRedirectError, updateAccountPreferences } from "../api";
import {
  createStripeCheckout, createStripePortal, loadStripeOffer, loadStripeSubscriptions,
  reconcileStripeCheckoutReturn, type StripeRequestIdentity,
} from "../api/endpoints/stripeBilling";
import { parseStripeSessionId, parseStripeUuid, type StripeCheckout, type StripeDetails, type StripeOffer } from "../apiContracts/stripeBilling";
import { useAppData } from "../appData";
import { queueAccentColorWrite } from "../appData/session/accentColorWrite";
import { readEntitlementIdentityGeneration, readEntitlementSnapshot, subscribeToEntitlement } from "./entitlementStore";
import { activateVerifiedStripeBillingSession, consumeStripeIntent, isCurrentStripeIntent, isStripeBillingInvalidated,
  readStripeBillingGeneration, readStripeIntent, storeStripeIntent,
  subscribeToStripeBillingInvalidation, type PremiumContinuation, type StripeIntent } from "./stripeIntent";

type BillingIdentity = StripeRequestIdentity & Readonly<{ entitlementGeneration: number; billingGeneration: number }>;

type BillingStatus = "idle" | "loading" | "opening" | "confirming" | "confirmed" | "delayed" | "interrupted";
export type StripeBilling = Readonly<{
  offer: StripeOffer | null; details: StripeDetails | null; error: unknown;
  status: BillingStatus; busy: boolean;
  refresh: () => Promise<void>;
  purchase: (continuation: PremiumContinuation | null) => Promise<void>;
  manage: (identityId: string) => Promise<void>;
}>;
export const StripeBillingContext = createContext<StripeBilling | null>(null);

export function useStripeBilling(): StripeBilling {
  const billing = useContext(StripeBillingContext);
  if (billing === null) throw new Error("Stripe billing requires PremiumProvider");
  return billing;
}

export function useAccountStripeBilling(): StripeBilling {
  const { session, isSessionVerified, runSync, setAccountPreferences } = useAppData();
  const userId = session?.userId ?? null;
  const csrfToken = session?.csrfToken ?? null;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const canLoad = isSessionVerified && session !== null && session.profile.email !== null;
  const [offer, setOffer] = useState<StripeOffer | null>(null);
  const [details, setDetails] = useState<StripeDetails | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<BillingStatus>("idle");
  const [busy, setBusy] = useState(false);
  const operationRef = useRef<AbortController | null>(null);
  const generationRef = useRef(readEntitlementIdentityGeneration());
  const activeRef = useRef(false);
  const canLoadRef = useRef(canLoad);
  canLoadRef.current = canLoad;
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const syncRef = useRef(runSync);
  syncRef.current = runSync;
  // In-page fast path; the stored intent carries the same mark across reloads.
  const reportedReturnRef = useRef<string | null>(null);

  const isCurrent = useCallback((identity: BillingIdentity): boolean => activeRef.current && !isStripeBillingInvalidated() && canLoadRef.current
    && identity.userId === userId && !identity.signal.aborted
    && identity.entitlementGeneration === readEntitlementIdentityGeneration()
    && identity.billingGeneration === readStripeBillingGeneration(), [userId]);

  function report(errorValue: unknown): void {
    if (isAuthRedirectError(errorValue)) return;
    console.error("Stripe billing operation failed", {
      code: errorValue instanceof ApiError ? errorValue.code : "STRIPE_WEB_OPERATION_FAILED",
      requestId: errorValue instanceof ApiError ? errorValue.requestId : null,
    });
    setError(errorValue);
  }

  const runOperation = useCallback(async (
    nextStatus: BillingStatus, operation: (identity: BillingIdentity) => Promise<void>,
  ): Promise<void> => {
    if (isStripeBillingInvalidated() || !canLoadRef.current || userId === null || !activeRef.current || operationRef.current !== null
      || generationRef.current !== readEntitlementIdentityGeneration()) return;
    const controller = new AbortController();
    const identity = { userId, signal: controller.signal,
      entitlementGeneration: readEntitlementIdentityGeneration(), billingGeneration: readStripeBillingGeneration() };
    operationRef.current = controller;
    setBusy(true);
    setError(null);
    setStatus(nextStatus);
    try {
      await operation(identity);
    } catch (caught) {
      if (isCurrent(identity)) { report(caught); setStatus("idle"); }
    } finally {
      if (operationRef.current === controller) operationRef.current = null;
      if (isCurrent(identity)) setBusy(false);
    }
  }, [isCurrent, userId]);

  const refreshOwned = useCallback(async (identity: BillingIdentity): Promise<void> => {
    const query = new URLSearchParams(window.location.search);
    const onSubscription = window.location.pathname.endsWith("/settings/subscription");
    const intent = readStripeIntent(identity.userId);
    let attemptId = intent?.attemptId ?? null;
    let sessionId = intent?.sessionId ?? null;
    const cancelled = onSubscription && query.get("checkout") === "cancelled";
    const returned = onSubscription && (query.get("checkout") === "success" || cancelled);
    const returnKey = `${query.get("checkout")}:${query.get("checkout_attempt_id")}`;
    // Only the browser holding this attempt's intent reports its return, once: a reload finds the intent
    // marked, and a reopened link after completion or cancellation finds it consumed.
    const reportReturn = (outcome: AnalyticsPurchaseOutcome): void => {
      if (!returned || reportedReturnRef.current === returnKey) return;
      reportedReturnRef.current = returnKey;
      if (intent === null || intent.attemptId !== query.get("checkout_attempt_id") || intent.reportedReturn === returnKey) return;
      // The mark is analytics state: while the consent question is open nothing may be written to the device,
      // so a reload then may report again rather than lose the still-unsent event for good.
      if (!isAwaitingAnalyticsConsentDecision() && isCurrentStripeIntent(intent)) storeStripeIntent({ ...intent, reportedReturn: returnKey });
      track({ name: "purchase_finished", outcome });
    };
    let complete = false;
    let expired = false;
    let returnError: unknown = null;
    try {
      if (onSubscription && query.get("checkout") === "success") {
        attemptId = parseStripeUuid(query.get("checkout_attempt_id"), "Checkout return", "attemptId");
        sessionId = parseStripeSessionId(query.get("checkout_session_id"), "Checkout return", "sessionId");
      } else if (cancelled) {
        attemptId = parseStripeUuid(query.get("checkout_attempt_id"), "Checkout return", "attemptId");
        sessionId = intent?.attemptId === attemptId ? intent.sessionId : null;
      }
      if (attemptId !== null && sessionId !== null) {
        const result = await reconcileStripeCheckoutReturn(identity, attemptId, sessionId);
        if (!isCurrent(identity)) return;
        if (result.attemptId !== attemptId || result.sessionId !== sessionId) throw new Error("Checkout return identity mismatch");
        complete = result.status === "complete";
        expired = result.status === "expired";
      }
    } catch (caught) {
      if (!isCurrent(identity) || isAuthRedirectError(caught)) throw caught;
      returnError = caught;
    }
    const next = await loadStripeSubscriptions(identity);
    if (!isCurrent(identity)) return;
    setDetails(next);
    setOffer(next);
    await syncRef.current();
    if (!isCurrent(identity)) return;
    const entitlement = readEntitlementSnapshot(identity.userId);
    const hasAccess = entitlement !== null && entitlement.status !== "none" && entitlement.tierRank >= 20;
    if (complete && hasAccess && entitlement !== null) {
      // A copied return link cannot acquire the continuation of a different attempt.
      const consumed = intent !== null && intent.attemptId === attemptId && intent.sessionId === sessionId ? consumeStripeIntent(intent) : null;
      const continuation = consumed?.continuation ?? null;
      const currentSession = sessionRef.current;
      if (continuation !== null && entitlement.tierRank >= continuation.requiredRank && currentSession?.userId === identity.userId) {
        queueAccentColorWrite(identity.userId, continuation.accentColor, currentSession.preferences.accentColor, {
          apply: (accentColor): void => { if (isCurrent(identity)) setAccountPreferences(identity.userId, { accentColor }); },
          save: async (accentColor, signal): Promise<string> => {
            if (!isCurrent(identity)) throw new DOMException("Billing identity changed", "AbortError");
            const controller = new AbortController();
            const unsubscribe = subscribeToStripeBillingInvalidation(() => controller.abort());
            const combined = combineAbortSignals([signal, controller.signal]);
            try {
              const response = await updateAccountPreferences({ accentColor }, { userId: identity.userId, signal: combined.signal });
              if (!isCurrent(identity)) throw new DOMException("Billing identity changed", "AbortError");
              return response.preferences.accentColor;
            } finally {
              combined.dispose();
              unsubscribe();
            }
          },
          onError: (caught): void => { if (isCurrent(identity)) report(caught); },
        });
      }
      setStatus("confirmed");
      reportReturn(cancelled ? "cancelled" : "completed");
    } else if ((cancelled || expired) && returnError === null) {
      if (intent !== null && intent.attemptId === attemptId && intent.sessionId === sessionId) consumeStripeIntent(intent);
      setStatus("interrupted");
      reportReturn("cancelled");
    } else {
      setStatus(attemptId !== null || next.pendingCheckouts.length > 0 ? "delayed" : "idle");
      reportReturn(cancelled ? "cancelled" : "pending");
    }
    // Keep incomplete success identifiers available for explicit retry, including receipt links.
    if (returnError !== null) throw returnError;
    if (onSubscription && ((complete && hasAccess) || cancelled || expired || query.get("portal") === "returned")) {
      for (const key of ["checkout", "checkout_attempt_id", "checkout_session_id", "portal"]) query.delete(key);
      const search = query.toString();
      void navigateRef.current({ pathname: window.location.pathname, search: search === "" ? "" : `?${search}`, hash: window.location.hash }, { replace: true });
    }
  }, [isCurrent, setAccountPreferences]);

  const refresh = useCallback((): Promise<void> => runOperation("confirming", refreshOwned), [refreshOwned, runOperation]);

  const purchase = useCallback((continuation: PremiumContinuation | null): Promise<void> => runOperation("opening", async (identity) => {
    const previous = readStripeIntent(identity.userId);
    const pending: StripeIntent = { userId: identity.userId, attemptId: previous?.attemptId ?? null, sessionId: previous?.sessionId ?? null, continuation: continuation ?? previous?.continuation ?? null, reportedReturn: previous?.reportedReturn ?? null };
    storeStripeIntent(pending);
    let result: StripeCheckout;
    try {
      result = await createStripeCheckout(identity);
    } catch (caught) {
      if (isCurrent(identity) && !isAuthRedirectError(caught)) track({ name: "purchase_finished", outcome: "failed" });
      throw caught;
    }
    if (!isCurrent(identity)) return;
    if (result.outcome === "existing_subscription") {
      if (consumeStripeIntent(pending) === null) return;
      await refreshOwned(identity);
      return;
    }
    if (!isCurrentStripeIntent(pending)) return;
    const pendingContinuation = continuation ?? (previous?.attemptId === result.attemptId ? previous.continuation : null);
    storeStripeIntent({ userId: identity.userId, attemptId: result.attemptId, sessionId: result.sessionId, continuation: pendingContinuation, reportedReturn: null });
    if (result.outcome === "checkout") {
      track({ name: "purchase_started" });
      window.location.assign(result.url);
    } else {
      const query = new URLSearchParams(window.location.search);
      for (const key of ["checkout", "checkout_attempt_id", "checkout_session_id", "portal"]) query.delete(key);
      void navigateRef.current({ pathname: window.location.pathname, search: query.toString(), hash: window.location.hash }, { replace: true });
      await refreshOwned(identity);
    }
  }), [isCurrent, refreshOwned, runOperation]);

  const manage = useCallback((identityId: string): Promise<void> => runOperation("loading", async (identity) => {
    const result = await createStripePortal(identity, identityId);
    if (!isCurrent(identity)) return;
    track({ name: "subscription_management_opened", destination: "stripe_portal" });
    window.location.assign(result.url);
  }), [isCurrent, runOperation]);

  useEffect(() => {
    activeRef.current = true;
    generationRef.current = readEntitlementIdentityGeneration();
    if (isSessionVerified && userId !== null) activateVerifiedStripeBillingSession({ userId, csrfToken });
    const resetBilling = (): void => {
      operationRef.current?.abort();
      operationRef.current = null;
      setOffer(null);
      setDetails(null);
      setError(null);
      setStatus("idle");
      setBusy(false);
    };
    const unsubscribe = subscribeToEntitlement(() => {
      if (generationRef.current !== readEntitlementIdentityGeneration()) resetBilling();
    });
    const unsubscribeInvalidation = subscribeToStripeBillingInvalidation(resetBilling);
    if (canLoad) {
      void runOperation("loading", async (identity) => {
        readStripeIntent(identity.userId);
        if (window.location.pathname.endsWith("/settings/subscription")) {
          await refreshOwned(identity);
        } else {
          const next = await loadStripeOffer(identity);
          if (isCurrent(identity)) { setOffer(next); setStatus("idle"); }
        }
      });
    }
    return (): void => {
      activeRef.current = false;
      operationRef.current?.abort();
      operationRef.current = null;
      unsubscribe();
      unsubscribeInvalidation();
    };
  }, [canLoad, csrfToken, isCurrent, isSessionVerified, refreshOwned, runOperation, userId]);

  return { offer, details, error, status, busy, refresh, purchase, manage };
}
