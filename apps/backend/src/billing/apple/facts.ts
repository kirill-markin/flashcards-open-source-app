import { z } from "zod";
import {
  recordTrialStartedAnalytics, recordPurchaseCompletedAnalytics,
  recordSubscriptionRevokedAnalytics, recordAutorenewDisabledAnalytics,
} from "../../productAnalytics/serverFacts/billingFacts";
import { unsafeTransaction } from "../../database/unsafe";
import { getDatabaseErrorFields } from "../../database/transient";
import { resolveEntitlementSnapshotForUser } from "../snapshot";
import { lockAppleAccount, type StoredApplePurchase } from "./store";
import type { ApplePurchaseState } from "./contracts";

export type AppleCommittedTransition = Readonly<{
  previous: StoredApplePurchase | null;
  purchase: StoredApplePurchase;
  state: ApplePurchaseState;
  eventId: string;
  receivedAt: Date;
  affectedUserIds: ReadonlyArray<string>;
}>;

export async function publishCommittedTransition(transition: AppleCommittedTransition): Promise<void> {
  // Hold live profiles during post-commit facts so the deletion sweep cannot precede them.
  await unsafeTransaction(async (executor) => {
    for (const userId of [...transition.affectedUserIds].sort((left, right) => left.localeCompare(right))) {
      const account = await lockAppleAccount(executor, userId);
      if (account === null) continue;
      try {
        await resolveEntitlementSnapshotForUser(userId, account.accountKind, new Date());
      } catch (error) {
        const databaseCode = z.string().regex(/^[A-Z0-9_]{1,64}$/).safeParse(getDatabaseErrorFields(error).errorCode);
        console.warn(JSON.stringify({
          event: "apple_post_commit_snapshot_refresh_failed",
          userId,
          purchaseId: transition.purchase.purchase_id,
          providerEventId: transition.eventId,
          environment: transition.state.environment,
          errorCode: databaseCode.success ? databaseCode.data : null,
        }));
      }
      if (userId !== transition.purchase.user_id || transition.purchase.account_deleted_at !== null) continue;
      // Existing provider fact producers have no environment field: sandbox must not enter them.
      if (transition.state.environment === "sandbox") continue;
      const { state, previous, purchase, receivedAt } = transition;
      const fact = { userId, purchaseId: purchase.purchase_id, tier: "premium" as const,
        provider: "apple" as const, occurredAt: state.purchasedAt, receivedAt };
      if (state.isTrial && (previous === null || !previous.is_trial || previous.user_id === null || previous.account_deleted_at !== null)) {
        await recordTrialStartedAnalytics(fact);
      }
      const purchaseFact = { ...fact, kind: "subscription" as const, period: "monthly" as const,
        productId: state.productId, price: state.price };
      if (state.paid && (previous === null || previous.is_trial || previous.user_id === null || previous.account_deleted_at !== null)) {
        await recordPurchaseCompletedAnalytics({ ...purchaseFact, resubscribeTransactionId: null });
      } else if (state.paid && state.status === "active" && state.transactionReason === "PURCHASE"
        && state.transactionId !== state.originalTransactionId
        && previous !== null && previous.user_id === userId && (previous.status === "expired" || previous.status === "revoked")) {
        // A customer's own purchase after a lapse; a renewal, billing-retry recovery included, never is.
        // The first transaction reactivated by a refund reversal keeps the original id, so it never is either.
        // A renewal processed before this transaction hides it, which is accepted.
        await recordPurchaseCompletedAnalytics({ ...purchaseFact, resubscribeTransactionId: state.transactionId });
      }
      if (state.status === "revoked" && previous?.status !== "revoked") {
        await recordSubscriptionRevokedAnalytics({ ...fact, occurredAt: state.revokedAt ?? state.signedAt, reason: "unknown" });
      }
      if (previous?.will_renew === true && !state.willRenew) {
        await recordAutorenewDisabledAnalytics({ ...fact, occurredAt: state.signedAt, providerEventId: transition.eventId });
      }
    }
  });
}
