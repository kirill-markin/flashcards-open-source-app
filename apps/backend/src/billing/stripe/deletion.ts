import type { DatabaseExecutor } from "../../database";
import { HttpError } from "../../shared/errors";
import { StripeBillingError } from "./contracts";
import type { StripeCommittedTransition } from "./facts";
import { stripeSubscriptionCanBill, requireOwnedStripeCheckout } from "./checkout";
import { abandonStripeCheckoutAttemptInExecutor, listStripeCheckoutAttemptsInExecutor,
  lockStripePersonIdentitiesInExecutor, recordStripeCheckoutSessionInExecutor } from "./identityStore";
import { loadStripeProvider } from "./provider";
import { reconcileStripeSubscriptionsInExecutor } from "./service";

// Caller holds the Cognito lifecycle lock. This precedes deletion of any profile or personal links.
// Provider side effects survive a rollback; each retry confirms the current provider state again.
export async function cancelStripeBeforeAccountDeletionInExecutor(
  executor: DatabaseExecutor, personUserIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<StripeCommittedTransition>> {
  await executor.query(`SELECT user_id FROM org.user_settings WHERE user_id = ANY($1::text[])
    ORDER BY user_id FOR UPDATE`, [personUserIds]);
  const identities = await lockStripePersonIdentitiesInExecutor(executor, personUserIds);
  if (identities.length === 0) return [];
  const transitions: Array<StripeCommittedTransition> = [];
  try {
    for (const identity of identities) {
      // A Checkout cannot be reserved until the customer id has committed locally.
      if (identity.customerId === null) continue;
      const provider = await loadStripeProvider(identity.environment);
      const customer = await provider.retrieveCustomer(identity.customerId);
      if (customer.metadata.nibomo_identity_id !== identity.identityId) {
        throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
          "Stripe customer ownership could not be confirmed before deletion.");
      }
      const attempts = await listStripeCheckoutAttemptsInExecutor(executor, identity);
      const sessions = await provider.listCheckouts(identity.customerId);
      for (const session of sessions) {
        const confirmed = session.status === "open"
          ? await provider.expireCheckout(session.id, identity.customerId) : session;
        if (confirmed.status !== "expired" && confirmed.status !== "complete") {
          throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
            "Stripe has not confirmed the Checkout expiration. Retry account deletion.");
        }
        const attempt = attempts.find((candidate) => candidate.attemptId === confirmed.client_reference_id);
        if (attempt !== undefined) {
          requireOwnedStripeCheckout(attempt, confirmed);
          await recordStripeCheckoutSessionInExecutor(executor, attempt, confirmed);
        }
      }
      for (const attempt of attempts) {
        if (sessions.some((session) => session.client_reference_id === attempt.attemptId)) continue;
        if (attempt.status === "open") throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
          "An open Checkout is missing from Stripe. Contact support before deleting the account.");
        if (attempt.status !== "pending") continue;
        // A timed-out provider request can still finish. Wait past its absolute session expiry
        // before treating an empty provider listing as proof no payable session can emerge.
        if (attempt.expiresAt.getTime() > Date.now()) throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
          "A Checkout creation is still being confirmed. Retry deletion after its one-hour reservation expires.");
        await abandonStripeCheckoutAttemptInExecutor(executor, attempt);
      }
      const subscriptions = await provider.listSubscriptions(identity.customerId);
      for (const subscription of subscriptions) {
        if (!stripeSubscriptionCanBill(subscription)) continue;
        const canceled = await provider.cancelSubscription(subscription.id, identity.customerId);
        if (canceled.status !== "canceled") throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
          "Stripe has not confirmed subscription cancellation. Retry account deletion.");
      }
      const confirmedSessions = await provider.listCheckouts(identity.customerId);
      const confirmedSubscriptions = await provider.listSubscriptions(identity.customerId);
      const completedWithoutConfirmedSubscription = confirmedSessions.some((session) => {
        if (session.status !== "complete") return false;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        return subscriptionId === undefined
          || !confirmedSubscriptions.some((subscription) => subscription.id === subscriptionId);
      });
      if (completedWithoutConfirmedSubscription || confirmedSessions.some((session) => session.status === "open")
        || confirmedSubscriptions.some(stripeSubscriptionCanBill)) {
        throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
          "Stripe billing changed during cancellation. Retry deletion to confirm all future charges have stopped.");
      }
      transitions.push(...await reconcileStripeSubscriptionsInExecutor(executor, provider, identity,
        confirmedSubscriptions.map((subscription) => subscription.id), new Date()));
    }
    return transitions;
  } catch (error) {
    const code = error instanceof StripeBillingError ? error.code : "STRIPE_DELETION_FAILED";
    console.warn(JSON.stringify({ event: "stripe_deletion_failed", code }));
    const detail = error instanceof StripeBillingError ? ` ${error.message}` : " Retry or contact support.";
    throw new HttpError(503,
      `Your account has not been deleted because Stripe cancellation could not be confirmed.${detail}`,
      "ACCOUNT_DELETE_STRIPE_CANCELLATION_FAILED");
  }
}
