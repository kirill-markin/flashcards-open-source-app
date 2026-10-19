import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { combineAbortSignals } from "../abortSignals";
import { isAwaitingAnalyticsConsentDecision, track, type AnalyticsPurchaseErrorCode, type AnalyticsPurchaseOutcome } from "../analytics";
import { ApiError, buildLoginUrl, isAuthRedirectError, updateAccountPreferences } from "../api";
import {
  createStripeCheckout, createStripePortal, loadStripeOffer, loadStripeSubscriptions,
  reconcileStripeCheckoutReturn, type StripeRequestIdentity,
} from "../api/endpoints/stripeBilling";
import { parseStripeSessionId, parseStripeUuid, type StripeCheckout, type StripeDetails, type StripeOffer } from "../apiContracts/stripeBilling";
import { useAppData } from "../appData";
import { beginGuestSignIn } from "../appData/session/guest/browserGuestConversion";
import { readPendingGuestConversion } from "../appData/session/guest/browserGuestStorage";
import { useI18n } from "../i18n";
import { queueAccentColorWrite } from "../appData/session/accentColorWrite";
import { readEntitlementIdentityGeneration, readEntitlementSnapshot, subscribeToEntitlement } from "./entitlementStore";
import { activateVerifiedStripeBillingSession, cancelGuestStripeCheckout, consumeStripeContinuation, consumeStripeIntent, isCurrentStripeIntent, isStripeBillingInvalidated,
  guestStripeCheckoutReturnUrl, readStripeBillingGeneration, readStripeIntent, storeGuestStripeCheckout, storeStripeIntent,
  subscribeToStripeBillingInvalidation, type PaywallPresentation, type PremiumContinuation, type StripeIntent } from "./stripeIntent";

type BillingIdentity = StripeRequestIdentity & Readonly<{ entitlementGeneration: number; billingGeneration: number }>;

// The collector rejects the whole event when the code breaks the catalog pattern, so every branch
// passes a non-empty value and the result is sanitized and capped to `[A-Za-z0-9_.-]{1,96}`.
function toPurchaseErrorCode(caught: unknown): AnalyticsPurchaseErrorCode {
  const code = caught instanceof ApiError && caught.code !== null && caught.code !== "" ? caught.code
    : caught instanceof ApiError ? `http_${caught.statusCode}`
      : caught instanceof Error && caught.name !== "" ? caught.name : typeof caught;
  return `app:${code.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 96)}`;
}

type BillingStatus = "idle" | "loading" | "opening" | "confirming" | "confirmed" | "delayed" | "interrupted";
export type StripeBilling = Readonly<{
  offer: StripeOffer | null; details: StripeDetails | null; error: unknown;
  status: BillingStatus; busy: boolean;
  refresh: () => Promise<void>;
  resumePremiumContinuation: (continuation: PremiumContinuation) => void;
  purchase: (continuation: PremiumContinuation | null, presentation: PaywallPresentation | null) => Promise<void>;
  manage: (identityId: string) => Promise<void>;
}>;
export const StripeBillingContext = createContext<StripeBilling | null>(null);

export function useStripeBilling(): StripeBilling {
  const billing = useContext(StripeBillingContext);
  if (billing === null) throw new Error("Stripe billing requires PremiumProvider");
  return billing;
}

export function useAccountStripeBilling(consumePendingOfferContinuation: (continuation: PremiumContinuation) => void): StripeBilling {
  const { session, activeWorkspace, isSessionVerified, runSync, drainGuestWorkspace, setAccountPreferences, setErrorMessage } = useAppData();
  const { locale } = useI18n();
  const guestSignInRef = useRef({ activeWorkspace, drainGuestWorkspace, locale, setErrorMessage });
  guestSignInRef.current = { activeWorkspace, drainGuestWorkspace, locale, setErrorMessage };
  const userId = session?.userId ?? null;
  const csrfToken = session?.csrfToken ?? null;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const canLoad = isSessionVerified && session !== null;
  const isRegistered = session !== null && session.profile.email !== null;
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

  const applyPremiumContinuation = useCallback((identity: BillingIdentity, continuation: PremiumContinuation): void => {
    const entitlement = readEntitlementSnapshot(identity.userId);
    const currentSession = sessionRef.current;
    if (!isCurrent(identity) || entitlement === null || entitlement.status === "none"
      || entitlement.tierRank < continuation.requiredRank || currentSession?.userId !== identity.userId) return;
    const intent = readStripeIntent(identity.userId);
    if (intent?.continuation?.accentColor === continuation.accentColor
      && intent.continuation.requiredRank === continuation.requiredRank) consumeStripeContinuation(intent);
    consumePendingOfferContinuation(continuation);
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
  }, [consumePendingOfferContinuation, isCurrent, setAccountPreferences]);

  const resumePremiumContinuation = useCallback((continuation: PremiumContinuation): void => {
    if (userId === null || generationRef.current !== readEntitlementIdentityGeneration()) return;
    applyPremiumContinuation({ userId, signal: new AbortController().signal,
      entitlementGeneration: readEntitlementIdentityGeneration(), billingGeneration: readStripeBillingGeneration() }, continuation);
  }, [applyPremiumContinuation, userId]);

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
    const reportReturn = (outcome: Exclude<AnalyticsPurchaseOutcome, "failed">): void => {
      if (!returned || reportedReturnRef.current === returnKey) return;
      reportedReturnRef.current = returnKey;
      if (intent === null || intent.attemptId !== query.get("checkout_attempt_id") || intent.reportedReturn === returnKey) return;
      // The mark is analytics state: while the consent question is open nothing may be written to the device,
      // so a reload then may report again rather than lose the still-unsent event for good.
      const currentIntent = readStripeIntent(identity.userId);
      if (!isAwaitingAnalyticsConsentDecision() && currentIntent !== null
        && currentIntent.attemptId === intent.attemptId && currentIntent.sessionId === intent.sessionId) {
        storeStripeIntent({ ...currentIntent, reportedReturn: returnKey });
      }
      track({ name: "purchase_finished", outcome, ...intent.presentation });
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
    const currentIntent = readStripeIntent(identity.userId);
    const matchingIntent = intent !== null && intent.attemptId === attemptId && intent.sessionId === sessionId
      && currentIntent?.attemptId === attemptId && currentIntent.sessionId === sessionId ? currentIntent : null;
    if (complete && hasAccess && entitlement !== null) {
      // A copied return link cannot acquire the continuation of a different attempt.
      const consumed = matchingIntent === null ? null : consumeStripeIntent(matchingIntent);
      const continuation = consumed?.continuation ?? null;
      if (continuation !== null) applyPremiumContinuation(identity, continuation);
      setStatus("confirmed");
    } else if ((cancelled || expired) && returnError === null) {
      if (matchingIntent !== null) consumeStripeIntent(matchingIntent);
      setStatus("interrupted");
    } else {
      setStatus(attemptId !== null || next.pendingCheckouts.length > 0 ? "delayed" : "idle");
    }
    // What Stripe said about the session, whether or not access has arrived yet.
    reportReturn(cancelled || expired ? "cancelled" : complete ? "completed" : "pending");
    // Keep incomplete success identifiers available for explicit retry, including receipt links.
    if (returnError !== null) throw returnError;
    if (onSubscription && ((complete && hasAccess) || cancelled || expired || query.get("portal") === "returned")) {
      for (const key of ["checkout", "checkout_attempt_id", "checkout_session_id", "portal"]) query.delete(key);
      const search = query.toString();
      void navigateRef.current({ pathname: window.location.pathname, search: search === "" ? "" : `?${search}`, hash: window.location.hash }, { replace: true });
    }
  }, [applyPremiumContinuation, isCurrent]);

  const refresh = useCallback((): Promise<void> => runOperation("confirming", async (identity) => {
    if (sessionRef.current?.profile.email != null) {
      await refreshOwned(identity);
    } else {
      const next = await loadStripeOffer(identity);
      if (isCurrent(identity)) { setOffer(next); setStatus("idle"); }
    }
  }), [isCurrent, refreshOwned, runOperation]);

  const purchase = useCallback((continuation: PremiumContinuation | null, presentation: PaywallPresentation | null): Promise<void> => runOperation("opening", async (identity) => {
    const currentSession = sessionRef.current;
    if (currentSession === null) throw new Error("A verified session is required to start Premium.");
    if (currentSession.profile.email === null) {
      const guest = guestSignInRef.current;
      if (currentSession.browserGuestCapabilities?.isGuest !== true || guest.activeWorkspace === null) {
        throw new Error("A verified browser guest workspace is required to start Premium sign-in.");
      }
      const token = storeGuestStripeCheckout(identity.userId, continuation, presentation);
      try {
        const returnUrl = guestStripeCheckoutReturnUrl(identity.userId);
        if (returnUrl === null) throw new Error("The Premium sign-in choice could not be saved. Retry sign-in.");
        await beginGuestSignIn(identity.userId, guest.activeWorkspace.workspaceId, guest.drainGuestWorkspace);
        const conversion = readPendingGuestConversion();
        // The conversion gate replaces this provider after draining; its owned intent authorizes the handoff.
        if (isStripeBillingInvalidated() || identity.billingGeneration !== readStripeBillingGeneration()
          || conversion?.sourceUserId !== identity.userId || conversion.phase !== "awaiting_auth"
          || readStripeIntent(identity.userId)?.checkoutAfterSignIn !== token) {
          throw new Error("The Premium sign-in owner changed. Resume the current guest conversion.");
        }
        window.location.assign(buildLoginUrl(returnUrl, guest.locale));
      } catch (caught) {
        guest.setErrorMessage(caught instanceof Error ? caught.message : String(caught));
        cancelGuestStripeCheckout(identity.userId);
        throw caught;
      }
      return;
    }
    await syncRef.current();
    if (!isCurrent(identity)) return;
    const access = readEntitlementSnapshot(identity.userId);
    if (access === null) throw new Error("Refresh the account entitlement before opening Stripe Checkout.");
    if (access.status !== "none" && access.tierRank >= 20) {
      const stored = readStripeIntent(identity.userId);
      const pendingContinuation = continuation ?? stored?.continuation ?? null;
      if (stored !== null) consumeStripeIntent(stored);
      if (pendingContinuation !== null) applyPremiumContinuation(identity, pendingContinuation);
      setStatus("confirmed");
      return;
    }
    const previous = readStripeIntent(identity.userId);
    const pending: StripeIntent = { userId: identity.userId, presentation: presentation ?? previous?.presentation ?? null, attemptId: previous?.attemptId ?? null, sessionId: previous?.sessionId ?? null, continuation: continuation ?? previous?.continuation ?? null, reportedReturn: previous?.reportedReturn ?? null };
    storeStripeIntent(pending);
    let result: StripeCheckout;
    try {
      track({ name: "purchase_started", ...pending.presentation,
        ...(offer?.trialEligible === null || offer?.trialEligible === undefined ? {}
          : { offerType: offer.trialEligible ? "free_trial" : "standard" }) });
      result = await createStripeCheckout(identity);
    } catch (caught) {
      if (isCurrent(identity) && !isAuthRedirectError(caught)) track({ name: "purchase_finished", outcome: "failed", errorCode: toPurchaseErrorCode(caught), ...pending.presentation });
      throw caught;
    }
    if (!isCurrent(identity)) return;
    const currentPending = readStripeIntent(identity.userId);
    if (currentPending === null || (!isCurrentStripeIntent(pending)
      && !(currentPending.continuation === null && isCurrentStripeIntent({ ...pending, continuation: null })))) return;
    if (result.outcome === "existing_subscription") {
      if (consumeStripeIntent(currentPending) === null) return;
      await refreshOwned(identity);
      if (pending.continuation !== null) applyPremiumContinuation(identity, pending.continuation);
      return;
    }
    const pendingContinuation = continuation !== null || previous?.attemptId === result.attemptId ? currentPending.continuation : null;
    storeStripeIntent({ userId: identity.userId, presentation: pending.presentation ?? null, attemptId: result.attemptId, sessionId: result.sessionId, continuation: pendingContinuation, reportedReturn: null });
    if (result.outcome === "checkout") {
      window.location.assign(result.url);
    } else {
      track({ name: "purchase_finished", outcome: "completed", ...pending.presentation });
      const query = new URLSearchParams(window.location.search);
      for (const key of ["checkout", "checkout_attempt_id", "checkout_session_id", "portal"]) query.delete(key);
      void navigateRef.current({ pathname: window.location.pathname, search: query.toString(), hash: window.location.hash }, { replace: true });
      await refreshOwned(identity);
    }
  }), [applyPremiumContinuation, isCurrent, offer, refreshOwned, runOperation]);

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
        if (isRegistered && window.location.pathname.endsWith("/settings/subscription")) {
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
  }, [canLoad, csrfToken, isCurrent, isRegistered, isSessionVerified, refreshOwned, runOperation, userId]);

  return { offer, details, error, status, busy, refresh, resumePremiumContinuation, purchase, manage };
}
