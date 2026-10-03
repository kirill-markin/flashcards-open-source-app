import type Stripe from "stripe";
import { dispatchStripeLifecycleEmails } from "./email";
import { z } from "zod";
import type { DatabaseExecutor } from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import {
  StripeBillingError, type StripeCustomerIdentity, type StripeEnvironment, type StripeLifecycleResult,
} from "./contracts";
import { loadStripeProvider, type StripeProvider } from "./provider";
import {
  loadStripeCheckoutAttemptInExecutor, recordStripeCheckoutSessionInExecutor,
} from "./identityStore";
import {
  normalizeStripePurchase, stripeEventReference, stripeTimestamp, type StripeEventReference,
} from "./state";
import {
  failStripeEventInExecutor, finishStripeEventInExecutor, lockStripeEventInExecutor,
  lockStripeIdentityForLifecycleInExecutor, lockStripePurchasesInExecutor,
  persistStripePurchaseInExecutor, retainStripeEventInExecutor,
} from "./store";
import { publishStripeTransitions, type StripeCommittedTransition } from "./facts";

type StripeEventTarget = Readonly<{
  subscriptionIds: ReadonlyArray<string>;
  checkout: Stripe.Checkout.Session | null;
}>;

function objectId(value: string | Readonly<{ id: string }> | null): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function requireCustomerId(identity: StripeCustomerIdentity): string {
  if (identity.customerId === null || identity.accountDeletedAt !== null) {
    throw new StripeBillingError("STRIPE_ACCOUNT_RETIRED", false,
      "Stripe lifecycle reconciliation requires an existing customer identity.");
  }
  return identity.customerId;
}

async function resolveStripeEventTarget(
  executor: DatabaseExecutor, provider: StripeProvider,
  identity: StripeCustomerIdentity, reference: StripeEventReference,
): Promise<StripeEventTarget | null> {
  const customerId = requireCustomerId(identity);
  try {
    if (reference.kind === "checkout") {
      const checkout = await provider.retrieveCheckout(reference.objectId, customerId);
      if (checkout.client_reference_id === null || !z.uuid().safeParse(checkout.client_reference_id).success) return null;
      const attempt = await loadStripeCheckoutAttemptInExecutor(executor, checkout.client_reference_id, provider.environment);
      if (attempt === null || attempt.identityId !== identity.identityId || attempt.userId !== identity.userId
        || attempt.accountDeletedAt !== null || (attempt.sessionId !== null && attempt.sessionId !== checkout.id)) return null;
      const subscriptionId = objectId(checkout.subscription);
      if (subscriptionId !== null) await provider.retrieveSubscription(subscriptionId, customerId);
      return { checkout, subscriptionIds: subscriptionId === null ? [] : [subscriptionId] };
    }
    if (reference.kind === "invoice") {
      const invoice = await provider.retrieveInvoice(reference.objectId, customerId);
      const subscriptionId = objectId(invoice.parent?.subscription_details?.subscription ?? null);
      return subscriptionId === null ? null : { checkout: null, subscriptionIds: [subscriptionId] };
    }
    const candidates = reference.kind === "charge"
      ? await provider.retrieveChargeSubscriptionIds(reference.objectId, customerId) : [reference.objectId];
    const subscriptionIds: Array<string> = [];
    for (const id of candidates) {
      try {
        await provider.retrieveSubscription(id, customerId);
        subscriptionIds.push(id);
      } catch (error) {
        // A shared-account charge may fund another product. It must never retain its personal payload.
        if (!(error instanceof StripeBillingError) || error.code !== "STRIPE_IDENTITY_MISMATCH") throw error;
      }
    }
    return subscriptionIds.length === 0 ? null : { checkout: null, subscriptionIds: [...new Set(subscriptionIds)].sort() };
  } catch (error) {
    if (error instanceof StripeBillingError && error.code === "STRIPE_IDENTITY_MISMATCH") return null;
    throw error;
  }
}

async function recordCheckoutTarget(
  executor: DatabaseExecutor, provider: StripeProvider, target: StripeEventTarget,
): Promise<void> {
  if (target.checkout === null || target.checkout.client_reference_id === null) return;
  const attempt = await loadStripeCheckoutAttemptInExecutor(
    executor, target.checkout.client_reference_id, provider.environment);
  if (attempt === null) throw new StripeBillingError("STRIPE_STORAGE_CONFLICT", true,
    "Stripe Checkout reservation disappeared during lifecycle reconciliation.");
  await recordStripeCheckoutSessionInExecutor(executor, attempt, target.checkout);
}

// Caller holds profile -> identity -> Checkout locks. Returned facts must be published only after
// its transaction commits. This lets Checkout/deletion orchestration share the same purchase writer.
export async function reconcileStripeSubscriptionsInExecutor(
  executor: DatabaseExecutor, provider: StripeProvider, identity: StripeCustomerIdentity,
  subscriptionIds: ReadonlyArray<string>, receivedAt: Date,
): Promise<ReadonlyArray<StripeCommittedTransition>> {
  const customerId = requireCustomerId(identity);
  if (identity.environment !== provider.environment) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
    "Stripe reconciliation environment differs from the stored customer identity.");
  await lockStripePurchasesInExecutor(executor, provider.environment, subscriptionIds);
  const transitions: Array<StripeCommittedTransition> = [];
  for (const subscriptionId of [...new Set(subscriptionIds)].sort()) {
    // No event payload status, invoice id or event.created participates in the access decision.
    const subscription = await provider.retrieveSubscription(subscriptionId, customerId);
    const financial = await provider.retrieveSubscriptionFinancialState(subscription, customerId);
    const confirmed = await provider.retrieveSubscription(subscriptionId, customerId);
    const item = subscription.items.data[0];
    const confirmedItem = confirmed.items.data[0];
    if (confirmed.status !== subscription.status || objectId(confirmed.latest_invoice) !== objectId(subscription.latest_invoice)
      || confirmedItem.current_period_start !== item.current_period_start
      || confirmedItem.current_period_end !== item.current_period_end
      || confirmed.trial_start !== subscription.trial_start || confirmed.trial_end !== subscription.trial_end
      || confirmed.cancel_at !== subscription.cancel_at || confirmed.cancel_at_period_end !== subscription.cancel_at_period_end
      || confirmed.canceled_at !== subscription.canceled_at) {
      throw new StripeBillingError("STRIPE_STORAGE_CONFLICT", true,
        "Stripe subscription changed while reading its financial state. Retry authoritative reconciliation.");
    }
    const state = normalizeStripePurchase(subscription, customerId, provider.environment, financial, new Date());
    const purchase = await persistStripePurchaseInExecutor(executor, identity, state);
    transitions.push({ purchase, state, receivedAt });
  }
  return transitions;
}

export async function reconcileStripeCustomer(
  provider: StripeProvider, customerId: string,
): Promise<ReadonlyArray<StripeCommittedTransition>> {
  const transitions = await unsafeTransaction(async (executor) => {
    const locked = await lockStripeIdentityForLifecycleInExecutor(executor, provider.environment, customerId);
    if (locked === null) throw new StripeBillingError("STRIPE_ACCOUNT_RETIRED", false,
      "Stripe customer is unowned or retired. Reconcile the account identity before refreshing.");
    const subscriptions = await provider.listSubscriptions(customerId);
    return reconcileStripeSubscriptionsInExecutor(executor, provider, locked.identity,
      subscriptions.map((subscription) => subscription.id), new Date());
  });
  await publishStripeTransitions(transitions);
  return transitions;
}

export async function handleStripeWebhook(
  environment: StripeEnvironment, rawBody: Buffer, signature: string,
): Promise<StripeLifecycleResult> {
  const provider = await loadStripeProvider(environment);
  const event = provider.verifyWebhook(rawBody, signature);
  stripeTimestamp(event.created);
  const reference = stripeEventReference(event);
  if (reference === null) return { outcome: "ignored", subscriptionIds: [] };
  const customerId = reference.kind === "charge"
    ? await provider.retrieveChargeCustomerId(reference.objectId) : reference.customerId;
  if (customerId === null) return { outcome: "ignored", subscriptionIds: [] };
  const receipt = await unsafeTransaction(async (executor) => {
    const locked = await lockStripeIdentityForLifecycleInExecutor(executor, environment, customerId);
    if (locked === null) return null;
    const target = await resolveStripeEventTarget(executor, provider, locked.identity, reference);
    if (target === null) return null;
    const stored = await retainStripeEventInExecutor(executor, locked.identity, event, rawBody,
      target.subscriptionIds[0] ?? null);
    return { stored, target };
  });
  if (receipt === null) return { outcome: "ignored", subscriptionIds: [] };
  try {
    const transitions = await unsafeTransaction(async (executor) => {
      const locked = await lockStripeIdentityForLifecycleInExecutor(executor, environment, customerId);
      if (locked === null) {
        await finishStripeEventInExecutor(executor, event.id, environment);
        return [];
      }
      await lockStripeEventInExecutor(executor, event.id, environment);
      // Repeat Checkout retrieval after the durable receipt; it may have completed in the meantime.
      const target = await resolveStripeEventTarget(executor, provider, locked.identity, reference);
      if (target === null) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
        "Stripe lifecycle target no longer matches the retained delivery.");
      await recordCheckoutTarget(executor, provider, target);
      const result = await reconcileStripeSubscriptionsInExecutor(executor, provider, locked.identity,
        target.subscriptionIds, receipt.stored.received_at);
      await finishStripeEventInExecutor(executor, event.id, environment);
      return result;
    });
    await publishStripeTransitions(transitions);
    try {
      await dispatchStripeLifecycleEmails(provider, customerId, event.type, reference,
        transitions.map((transition) => transition.state.subscriptionId));
    } catch (error) {
      const errorCode = error instanceof StripeBillingError ? error.code : "STRIPE_EMAIL_FAILED";
      await unsafeTransaction((executor) => executor.query(`UPDATE billing.provider_events SET processing_error = $3
        WHERE provider = 'stripe' AND event_id = $1 AND environment = $2`, [event.id, environment, errorCode]));
      throw error;
    }
    return { outcome: receipt.stored.processed_at === null ? "processed" : "duplicate",
      subscriptionIds: transitions.map((transition) => transition.state.subscriptionId) };
  } catch (error) {
    const errorCode = error instanceof StripeBillingError ? error.code : "STRIPE_LIFECYCLE_FAILED";
    console.warn(JSON.stringify({ event: "stripe_lifecycle_failed", environment, errorCode }));
    await unsafeTransaction((executor) => failStripeEventInExecutor(executor, event.id, environment, errorCode));
    if (error instanceof StripeBillingError) throw error;
    throw new StripeBillingError("STRIPE_PROVIDER_FAILED", true,
      "Stripe lifecycle persistence or snapshot refresh failed. Retry the same delivery.");
  }
}
