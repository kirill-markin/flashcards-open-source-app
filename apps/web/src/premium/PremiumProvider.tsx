import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { reviewPromptConfig } from "../../../backend/src/reviewPrompts/reviewPromptConfig";
import { track, type AnalyticsPaywallEntryPoint } from "../analytics";
import { useAppData } from "../appData";
import type { PaywallState, ReviewPaywallTrigger } from "../apiContracts/paywallState";
import { buildProgressDateContext } from "../progress/progressDates";
import { isKnownFreeEntitlement } from "./reviewPaywall/schedule";
import { useReviewPaywallState } from "./reviewPaywall/useReviewPaywallState";
import type { AiUsageStatus } from "../types";
import type { EntitlementSnapshot } from "../types/entitlement";
import { readEntitlementSnapshot, useEntitlementSnapshot } from "./entitlementStore";
import { PremiumOffer } from "./PremiumOffer";
import { StripeBillingContext, useAccountStripeBilling } from "./useStripeBilling";
import { canCollectPaywallAnalytics, isStripeBillingInvalidated, readStripeBillingGeneration, subscribeToStripeBillingInvalidation, type PaywallPresentation, type PremiumContinuation } from "./stripeIntent";

export type PremiumRequest =
  | Readonly<{ reason: "offer"; isTestPreview?: true; entryPoint: AnalyticsPaywallEntryPoint | null; presentation?: PaywallPresentation | null; reviewTrigger?: ReviewPaywallTrigger; continuation?: PremiumContinuation | null }>
  | Readonly<{ reason: "ai-limit"; isTestPreview?: true; entryPoint: AnalyticsPaywallEntryPoint | null; aiUsage: AiUsageStatus | null }>
  | Readonly<{
    reason: "feature";
    entryPoint: AnalyticsPaywallEntryPoint;
    requiredRank: number;
    /** Null when the pending change does not survive a Stripe Checkout redirect. */
    continuation: PremiumContinuation | null;
    onResult: (result: "granted" | "dismissed") => void;
  }>;

type Presentation = Readonly<{ userId: string; billingGeneration: number; request: PremiumRequest; analytics: PaywallPresentation | null; functionalPresentationId: string; revision: number }>;
type PremiumPresenter = (request: PremiumRequest) => "granted" | "presented" | "unavailable";
const PremiumContext = createContext<PremiumPresenter | null>(null);
type ReviewPaywallPresenter = Readonly<{
  readState: () => PaywallState | null;
  isPresented: boolean;
  isBusy: () => boolean;
  present: (trigger: ReviewPaywallTrigger) => boolean;
}>;
const ReviewPaywallContext = createContext<ReviewPaywallPresenter | null>(null);

export function useReviewPaywallPresenter(): ReviewPaywallPresenter | null {
  return useContext(ReviewPaywallContext);
}

export function hasPremiumAccess(entitlement: EntitlementSnapshot | null, requiredRank: number): boolean {
  return entitlement !== null && entitlement.status !== "none" && entitlement.tierRank >= requiredRank;
}

export function usePremiumPresenter(): PremiumPresenter | null {
  return useContext(PremiumContext);
}

export function PremiumProvider(props: Readonly<{ children: ReactNode }>): ReactElement {
  const userId = useAppData().session?.userId ?? null;
  return <PremiumSession key={userId} {...props} />;
}

function PremiumSession(props: Readonly<{ children: ReactNode }>): ReactElement {
  const { session } = useAppData();
  const userId = session?.userId ?? null;
  const billingGeneration = readStripeBillingGeneration();
  const entitlement = useEntitlementSnapshot(userId);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const pendingRef = useRef<Presentation | null>(null);
  const shownRef = useRef<Presentation | null>(null);
  const revisionRef = useRef(0);
  const currentUserIdRef = useRef(userId);
  currentUserIdRef.current = userId;

  const consumePendingOfferContinuation = useCallback((continuation: PremiumContinuation): void => {
    const pending = pendingRef.current;
    if (pending === null || pending.userId !== currentUserIdRef.current
      || pending.billingGeneration !== readStripeBillingGeneration()
      || pending.request.reason !== "offer" || pending.request.continuation?.accentColor !== continuation.accentColor
      || pending.request.continuation.requiredRank !== continuation.requiredRank) return;
    pendingRef.current = null;
    setPresentation(null);
  }, []);
  const billing = useAccountStripeBilling(consumePendingOfferContinuation);
  const displayedOfferType = billing.offer?.checkoutAvailable === true && billing.offer.basePrice !== null
    && entitlement !== null && !hasPremiumAccess(entitlement, 20)
    ? session?.profile.email === null || billing.offer.trialEligible === true ? "free_trial" : "standard" : undefined;
  const paywallState = useReviewPaywallState();
  const billingBusyRef = useRef(billing.busy);
  billingBusyRef.current = billing.busy;

  const dismiss = useCallback((): void => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setPresentation(null);
    if (pending?.userId === currentUserIdRef.current && pending.billingGeneration === readStripeBillingGeneration() && pending?.request.reason === "feature") {
      pending.request.onResult("dismissed");
    }
  }, []);

  const present = useCallback((request: PremiumRequest): "granted" | "presented" | "unavailable" => {
    if (isStripeBillingInvalidated() || billingGeneration !== readStripeBillingGeneration() || userId === null || userId !== currentUserIdRef.current) {
      return "unavailable";
    }
    dismiss();
    if (request.reason === "feature" && hasPremiumAccess(entitlement, request.requiredRank)) {
      request.onResult("granted");
      return "granted";
    }
    const isPreview = request.reason !== "feature" && request.isTestPreview === true;
    const functionalPresentationId = crypto.randomUUID();
    const analytics = isPreview || request.entryPoint === null || !canCollectPaywallAnalytics() ? null
      : request.reason === "offer" && request.presentation !== null && request.presentation !== undefined ? request.presentation
      : { presentationId: functionalPresentationId, entryPoint: request.entryPoint };
    revisionRef.current += 1;
    const next = { userId, billingGeneration, request, analytics, functionalPresentationId, revision: revisionRef.current };
    shownRef.current = null;
    pendingRef.current = next;
    setPresentation(next);
    return request.reason === "offer" && !isPreview && hasPremiumAccess(entitlement, 20) ? "granted" : "presented";
  }, [billingGeneration, dismiss, entitlement, userId]);

  function reportVisible(): void {
    const pending = pendingRef.current;
    if (pending === null || shownRef.current === pending || pending.userId !== currentUserIdRef.current
      || pending.billingGeneration !== readStripeBillingGeneration() || isStripeBillingInvalidated()) return;
    shownRef.current = pending;
    if (pending.request.reason !== "feature" && pending.request.isTestPreview === true) return;
    const now = new Date();
    const { today: localDate, timeZone } = buildProgressDateContext(now);
    const reviewTrigger = pending.request.reason === "offer" ? pending.request.reviewTrigger ?? null : null;
    if (pending.request.entryPoint !== null) {
      paywallState.recordVisible({ presentationId: pending.functionalPresentationId, shownAt: now.toISOString(),
        localDate, timeZone, reviewTrigger });
    }
    if (pending.analytics === null || !canCollectPaywallAnalytics()) return;
    // Email linking resumes the analytics exposure, but is another actual functional appearance.
    if (pending.request.reason === "offer" && pending.request.presentation !== null && pending.request.presentation !== undefined) return;
    track({ name: "paywall_shown", ...pending.analytics, localDate, timeZone,
      ...(reviewTrigger === null ? {} : { reviewTrigger, reviewPromptConfigVersion: reviewPromptConfig.version }), contentVersion: "union-v1",
      accountKind: session?.profile.email === null ? "guest" : "registered",
      ...(displayedOfferType === undefined ? {} : { offerType: displayedOfferType }) });
  }

  const isReviewPaywallBusy = useCallback((): boolean => pendingRef.current !== null || billingBusyRef.current
    || isStripeBillingInvalidated() || document.querySelector("dialog[open]") !== null, []);

  const presentReviewPaywall = useCallback((reviewTrigger: ReviewPaywallTrigger): boolean => {
    if (isReviewPaywallBusy() || !isKnownFreeEntitlement(readEntitlementSnapshot(userId))) return false;
    return present({ reason: "offer", entryPoint: "review", reviewTrigger }) === "presented";
  }, [isReviewPaywallBusy, present, userId]);

  function reportChoice(outcome: "free" | "premium" | "dismissed"): void {
    const pending = pendingRef.current;
    if (pending?.analytics !== null && pending?.analytics !== undefined && shownRef.current === pending
      && pending.userId === currentUserIdRef.current && pending.billingGeneration === readStripeBillingGeneration()
      && canCollectPaywallAnalytics()) {
      track({ name: "paywall_choice", ...pending.analytics, outcome,
        ...(displayedOfferType === undefined ? {} : { offerType: displayedOfferType }) });
    }
    if (outcome !== "premium") dismiss();
  }

  useEffect(() => subscribeToStripeBillingInvalidation(() => {
    pendingRef.current = null;
    setPresentation(null);
  }), []);

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending !== null && (pending.userId !== userId || isStripeBillingInvalidated() || pending.billingGeneration !== readStripeBillingGeneration())) {
      pendingRef.current = null;
      setPresentation(null);
      return;
    }
    if (pending?.request.reason === "offer" && pending.request.isTestPreview !== true && pending.request.reviewTrigger !== undefined && !isKnownFreeEntitlement(entitlement)) {
      pendingRef.current = null;
      setPresentation(null);
      return;
    }
    if (pending?.request.reason === "offer" && pending.request.isTestPreview !== true && hasPremiumAccess(entitlement, 20)) {
      pendingRef.current = null;
      setPresentation(null);
      if (pending.request.continuation !== null && pending.request.continuation !== undefined) {
        billing.resumePremiumContinuation(pending.request.continuation);
      }
      return;
    }
    if (pending?.request.reason === "feature" && hasPremiumAccess(entitlement, pending.request.requiredRank)) {
      // Consume before invoking the continuation, including when effects replay in StrictMode.
      pendingRef.current = null;
      setPresentation(null);
      pending.request.onResult("granted");
    }
  }, [billing.resumePremiumContinuation, entitlement, presentation, userId]);

  return (
    <StripeBillingContext.Provider value={billing}>
      <PremiumContext.Provider value={present}>
        <ReviewPaywallContext.Provider value={{ readState: paywallState.readState, isPresented: presentation !== null, isBusy: isReviewPaywallBusy, present: presentReviewPaywall }}>
          {props.children}
        </ReviewPaywallContext.Provider>
        {presentation !== null && presentation.userId === userId
          && (presentation.request.reason !== "offer" || presentation.request.isTestPreview === true || (!hasPremiumAccess(entitlement, 20)
            && (presentation.request.reviewTrigger === undefined || isKnownFreeEntitlement(entitlement)))) ? (
          <PremiumOffer key={presentation.revision} request={presentation.request} entitlement={entitlement}
            presentation={presentation.analytics} onVisible={reportVisible} onDismiss={() => reportChoice("dismissed")}
            onContinueFree={() => reportChoice("free")} onChoosePremium={() => reportChoice("premium")} />
        ) : null}
      </PremiumContext.Provider>
    </StripeBillingContext.Provider>
  );
}
