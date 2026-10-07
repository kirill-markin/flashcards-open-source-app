import { useAppData } from "../appData";
import type { SessionInfo } from "../types";
import { hasPremiumAccess } from "./PremiumProvider";
import { readEntitlementIdentityGeneration, useEntitlementSnapshot } from "./entitlementStore";
import { isStripeBillingInvalidated, readStripeBillingGeneration } from "./stripeIntent";

/** Style settings show their defaults to a known free account and keep the saved choice for Premium. */
export function useCanCustomizeStyle(): boolean {
  const entitlement = useEntitlementSnapshot(useAppData().session?.userId ?? null);
  // Unknown access follows the cosmetic fail-open policy; a known free snapshot always gates it.
  return entitlement === null || hasPremiumAccess(entitlement, 20);
}

export function useEffectiveReviewReactionAnimationsEnabled(): boolean {
  const session = useAppData().session;
  const canCustomize = useCanCustomizeStyle();
  return !canCustomize || session?.preferences.reviewReactionAnimationsEnabled !== false;
}

/** Binds a paywall result to the account and billing state that opened the paywall. */
export function createPremiumContinuationGuard(
  initiatingSession: SessionInfo,
  readCurrentSession: () => SessionInfo | null,
): () => boolean {
  const { userId, csrfToken } = initiatingSession;
  const generation = readEntitlementIdentityGeneration();
  const billingGeneration = readStripeBillingGeneration();
  return (): boolean => {
    const currentSession = readCurrentSession();
    return !isStripeBillingInvalidated()
      && generation === readEntitlementIdentityGeneration()
      && billingGeneration === readStripeBillingGeneration()
      && currentSession?.userId === userId && currentSession.csrfToken === csrfToken;
  };
}
