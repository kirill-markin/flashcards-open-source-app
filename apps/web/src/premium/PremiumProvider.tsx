import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useAppData } from "../appData";
import type { AiUsageStatus } from "../types";
import type { EntitlementSnapshot } from "../types/entitlement";
import { useEntitlementSnapshot } from "./entitlementStore";
import { PremiumOffer } from "./PremiumOffer";
import { StripeBillingContext, useAccountStripeBilling } from "./useStripeBilling";
import { isStripeBillingInvalidated, readStripeBillingGeneration, subscribeToStripeBillingInvalidation, type PremiumContinuation } from "./stripeIntent";

export type PremiumRequest =
  | Readonly<{ reason: "offer" }>
  | Readonly<{ reason: "ai-limit"; aiUsage: AiUsageStatus | null }>
  | Readonly<{
    reason: "feature";
    requiredRank: number;
    continuation: PremiumContinuation;
    onResult: (result: "granted" | "dismissed") => void;
  }>;

type Presentation = Readonly<{ userId: string; billingGeneration: number; request: PremiumRequest }>;
type PremiumPresenter = (request: PremiumRequest) => "granted" | "presented" | "unavailable";
const PremiumContext = createContext<PremiumPresenter | null>(null);

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
  const userId = useAppData().session?.userId ?? null;
  const billing = useAccountStripeBilling();
  const billingGeneration = readStripeBillingGeneration();
  const entitlement = useEntitlementSnapshot(userId);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const pendingRef = useRef<Presentation | null>(null);
  const currentUserIdRef = useRef(userId);
  currentUserIdRef.current = userId;

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
    if (request.reason === "offer" && hasPremiumAccess(entitlement, 20)) {
      return "unavailable";
    }
    dismiss();
    if (request.reason === "feature" && hasPremiumAccess(entitlement, request.requiredRank)) {
      request.onResult("granted");
      return "granted";
    }
    const next = { userId, billingGeneration, request };
    pendingRef.current = next;
    setPresentation(next);
    return "presented";
  }, [billingGeneration, dismiss, entitlement, userId]);

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
    if (pending?.request.reason === "offer" && hasPremiumAccess(entitlement, 20)) {
      pendingRef.current = null;
      setPresentation(null);
      return;
    }
    if (pending?.request.reason === "feature" && hasPremiumAccess(entitlement, pending.request.requiredRank)) {
      // Consume before invoking the continuation, including when effects replay in StrictMode.
      pendingRef.current = null;
      setPresentation(null);
      pending.request.onResult("granted");
    }
  }, [entitlement, userId]);

  return (
    <StripeBillingContext.Provider value={billing}>
      <PremiumContext.Provider value={present}>
        {props.children}
        {presentation !== null && presentation.userId === userId
          && (presentation.request.reason !== "offer" || !hasPremiumAccess(entitlement, 20)) ? (
          <PremiumOffer request={presentation.request} entitlement={entitlement} onDismiss={dismiss} />
        ) : null}
      </PremiumContext.Provider>
    </StripeBillingContext.Provider>
  );
}
