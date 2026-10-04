import { unsafeTransaction } from "../../database/unsafe";
import {
  recordTrialStartedAnalytics, recordPurchaseCompletedAnalytics,
  recordSubscriptionRevokedAnalytics, recordAutorenewDisabledAnalytics, recordAutorenewEnabledAnalytics,
  recordBillingIssueStartedAnalytics, recordSubscriptionRenewedAnalytics,
} from "../../productAnalytics/serverFacts/billingFacts";
import { resolveEntitlementSnapshotForUser } from "../snapshot";
import type { StripePurchaseState } from "./contracts";
import {
  lockStripeIdentityForLifecycleInExecutor, readStripePurchaseInExecutor, type StoredStripePurchase,
} from "./store";

export type StripeCommittedTransition = Readonly<{
  // The stored row read under the purchase lock before this write, null for a new row.
  previous: StoredStripePurchase | null;
  purchase: StoredStripePurchase;
  state: StripePurchaseState;
  receivedAt: Date;
}>;

function inBillingIssue(providerStatus: string | null): boolean {
  return providerStatus === "past_due" || providerStatus === "unpaid";
}

// The caller must commit all purchase writes before calling this function.
export async function publishStripeTransitions(transitions: ReadonlyArray<StripeCommittedTransition>): Promise<void> {
  await unsafeTransaction(async (executor) => {
    const refreshed = new Set<string>();
    const ordered = [...transitions].sort((left, right) =>
      (left.purchase.user_id ?? "").localeCompare(right.purchase.user_id ?? "")
      || left.state.customerId.localeCompare(right.state.customerId));
    for (const transition of ordered) {
      const { state, purchase, previous, receivedAt } = transition;
      const userId = purchase.user_id;
      if (userId === null) continue;
      const locked = await lockStripeIdentityForLifecycleInExecutor(executor, state.environment, state.customerId);
      if (locked === null || locked.identity.userId !== userId) continue;
      const current = await readStripePurchaseInExecutor(executor, state.environment, state.subscriptionId);
      if (current === null || current.user_id !== userId
        || current.invalidated_at !== null || current.account_deleted_at !== null) continue;
      // This profile lock prevents erasure from completing before the post-commit facts.
      if (!refreshed.has(userId)) {
        await resolveEntitlementSnapshotForUser(userId, locked.accountKind, new Date());
        refreshed.add(userId);
      }
      if (state.environment !== "production") continue;
      const fact = { userId, purchaseId: purchase.purchase_id,
        tier: "premium" as const, provider: "stripe" as const, receivedAt };
      // Existing producers deduplicate by purchase. Historical trial/payment observations survive
      // a refund, retry or missing delivery without turning renewals into additional first purchases.
      if (state.trialStartedAt !== null) {
        await recordTrialStartedAnalytics({ ...fact, occurredAt: state.trialStartedAt });
      }
      if (state.firstPaidAt !== null) {
        // A later current invoice never carries the first price, and the writer normally stored this fact already.
        if (state.firstPaidInvoiceIsCurrent && state.firstPaidPrice === null) {
          console.warn(JSON.stringify({ event: "stripe_purchase_completed_price_unavailable",
            purchaseId: purchase.purchase_id }));
        }
        await recordPurchaseCompletedAnalytics({ ...fact, occurredAt: state.firstPaidAt,
          kind: "subscription", period: "monthly", productId: state.productId, price: state.firstPaidPrice,
          resubscribeTransactionId: null });
      }
      // Read off the current invoice on every reconcile; its id collapses the repeats.
      if (state.renewal !== null) {
        await recordSubscriptionRenewedAnalytics({ ...fact, occurredAt: state.renewal.paidAt,
          kind: "subscription", period: "monthly", productId: state.productId, price: state.renewal.price,
          renewalTransactionId: state.renewal.invoiceId });
      }
      if (state.revokedReason !== null) {
        await recordSubscriptionRevokedAnalytics({ ...fact, occurredAt: state.verifiedAt, reason: state.revokedReason });
      }
      if (!state.willRenew && state.canceledAt !== null
        && (state.trialStartedAt !== null || state.firstPaidAt !== null)) {
        await recordAutorenewDisabledAnalytics({ ...fact, occurredAt: state.canceledAt,
          providerEventId: `stripe:${state.environment}:${state.subscriptionId}:cancel:${state.canceledAt.toISOString()}`,
          reason: state.autorenewDisabledReason, periodType: state.isTrial ? "trial" : "paid" });
      }
      // A redelivery reads `will_renew` already true under the lock and emits nothing. Previous access
      // is required: `incomplete`, `unpaid` and `paused` also store `will_renew = false`.
      if (previous?.will_renew === false && state.willRenew && state.revokedReason === null
        && (previous.status === "active" || previous.status === "in_grace")
        && (state.trialStartedAt !== null || state.firstPaidAt !== null)) {
        await recordAutorenewEnabledAnalytics({ ...fact, occurredAt: state.verifiedAt,
          providerEventId: `stripe:${state.environment}:${state.subscriptionId}:uncancel:${state.verifiedAt.toISOString()}` });
      }
      // Stripe advances the period before charging, so its end names the failing period: retries within
      // it collide and a later failure is a new row. No paid invoice yet means the trial failed to convert.
      if (previous !== null && !inBillingIssue(previous.provider_status_raw) && inBillingIssue(state.providerStatus)) {
        await recordBillingIssueStartedAnalytics({ ...fact, occurredAt: state.verifiedAt,
          providerEventId: `stripe:${state.environment}:${state.subscriptionId}:billing_issue:${state.until.toISOString()}`,
          periodType: state.trialStartedAt !== null && state.firstPaidAt === null ? "trial" : "paid" });
      }
    }
  });
}
