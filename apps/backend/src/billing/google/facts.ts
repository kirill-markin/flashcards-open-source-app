import { z } from "zod";
import {
  recordTrialStartedAnalytics, recordPurchaseCompletedAnalytics,
  recordSubscriptionRevokedAnalytics, recordAutorenewDisabledAnalytics,
} from "../../productAnalytics/serverFacts/billingFacts";
import { unsafeTransaction } from "../../database/unsafe";
import { getDatabaseErrorFields } from "../../database/transient";
import { resolveEntitlementSnapshotForUser } from "../snapshot";
import { lockGoogleAccount, readGooglePurchase, type StoredGooglePurchase } from "./store";
import type { GooglePurchaseState } from "./contracts";

export type GoogleCommittedTransition = Readonly<{
  previous: StoredGooglePurchase | null;
  purchase: StoredGooglePurchase;
  state: GooglePurchaseState;
  eventId: string;
  receivedAt: Date;
  affectedUserIds: ReadonlyArray<string>;
}>;

export async function publishGoogleTransition(transition: GoogleCommittedTransition): Promise<void> {
  // Profile locks keep a concurrent erasure from finishing before these post-commit facts.
  await unsafeTransaction(async (executor) => {
    for (const userId of [...transition.affectedUserIds].sort((left, right) => left.localeCompare(right))) {
      const account = await lockGoogleAccount(executor, userId);
      if (account === null) continue;
      try {
        await resolveEntitlementSnapshotForUser(userId, account.accountKind, new Date());
      } catch (error) {
        const diagnostic = z.string().regex(/^[A-Z0-9_]{1,64}$/).safeParse(getDatabaseErrorFields(error).errorCode);
        console.warn(JSON.stringify({ event: "google_post_commit_snapshot_refresh_failed", userId,
          purchaseId: transition.purchase.purchase_id, environment: transition.state.environment,
          errorCode: diagnostic.success ? diagnostic.data : null }));
      }
      if (userId !== transition.purchase.user_id || transition.state.environment !== "production") continue;
      const current = await readGooglePurchase(executor, transition.state.purchaseToken, transition.state.environment);
      if (current === null || current.user_id !== userId || current.account_deleted_at !== null
        || current.invalidated_at !== null) continue;
      const { state, previous, purchase, receivedAt } = transition;
      const fact = { userId, purchaseId: purchase.purchase_id, tier: "premium" as const,
        provider: "google" as const, occurredAt: state.verifiedAt, receivedAt };
      if (state.completed && current.status !== "revoked") {
        // Producers deduplicate by purchase id. Retrying after a failed post-commit emission can
        // safely emit again; paid time is first observation, never original subscription signup.
        if (state.isTrial) await recordTrialStartedAnalytics({ ...fact, occurredAt: state.startedAt ?? state.verifiedAt });
        if (state.paid) {
          await recordPurchaseCompletedAnalytics({ ...fact, kind: "subscription", period: "monthly",
            productId: state.productId, price: state.price, resubscribeTransactionId: null });
        }
      }
      if (purchase.status === "revoked") {
        await recordSubscriptionRevokedAnalytics({ ...fact, reason: "unknown" });
      }
      if (previous?.will_renew === true && !purchase.will_renew && state.completed && current.status !== "revoked") {
        await recordAutorenewDisabledAnalytics({ ...fact, providerEventId: transition.eventId });
      }
    }
  });
}
