import type Stripe from "stripe";
import { z } from "zod";
import { isConfiguredDemoEmail } from "../../auth/demoEmailAccess";
import type { DatabaseExecutor } from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import { StripeBillingError, type StripeCheckoutAttempt, type StripeCustomerIdentity,
  type StripeEnvironment } from "./contracts";
import { stripeHostedLocale } from "./checkoutPresentation";
import { resolveStripeCopyLocale } from "./copy/catalog";
import { publishStripeTransitions, type StripeCommittedTransition } from "./facts";
import { abandonStripeCheckoutAttemptInExecutor, getOrCreateStripeCustomer,
  hasStripeTrialConsumptionInExecutor, listStripeCheckoutAttemptsInExecutor, loadStripeCheckoutAttemptInExecutor,
  lockStripeAccountInExecutor, lockStripePersonIdentitiesInExecutor,
  recordStripeCheckoutSessionInExecutor, recordStripeTrialConsumptionInExecutor, reserveStripeCheckoutAttemptInExecutor } from "./identityStore";
import { loadStripeProvider, type StripeProvider } from "./provider";
import { reconcileStripeSubscriptionsInExecutor } from "./service";

// Construct only from verified human authentication; never spread a request body into this value.
export type StripeHumanActor = Readonly<{ subject: string; userId: string }>;
export type StripeAccountContext = Readonly<{
  environment: StripeEnvironment;
  locale: string;
  checkoutEnabled: boolean;
  identities: ReadonlyArray<StripeCustomerIdentity>;
}>;
export type StripeCheckoutResult =
  | Readonly<{ outcome: "checkout"; attemptId: string; sessionId: string; url: string;
      expiresAt: string; trialDays: 0 | 7 }>
  | Readonly<{ outcome: "existing_subscription"; identityId: string }>
  | Readonly<{ outcome: "complete"; attemptId: string; sessionId: string }>;
export type StripeCheckoutReturn = Readonly<{ attemptId: string; sessionId: string }>;
export type StripeCheckoutReturnResult = Readonly<{
  attemptId: string; sessionId: string; status: "open" | "complete" | "expired";
}>;
export type StripeCustomerObservation = Readonly<{
  identity: StripeCustomerIdentity;
  provider: StripeProvider;
  subscriptions: ReadonlyArray<Stripe.Subscription>;
  pending: ReadonlyArray<StripeCheckoutAttempt>;
  transitions: ReadonlyArray<StripeCommittedTransition>;
}>;

export async function lockStripeHumanAccountInExecutor(
  executor: DatabaseExecutor, actor: StripeHumanActor,
): Promise<StripeAccountContext> {
  await lockStripeAccountInExecutor(executor, actor.subject, actor.userId);
  const result = await executor.query<{ email: string; locale: string }>(
    "SELECT email, locale FROM org.user_settings WHERE user_id = $1", [actor.userId]);
  const profile = result.rows[0];
  const environment = isConfiguredDemoEmail(profile.email) ? "sandbox" : "production";
  return { environment, locale: resolveStripeCopyLocale(profile.locale),
    checkoutEnabled: environment === "sandbox" || process.env.STRIPE_CHECKOUT_LIVE_ENABLED === "true",
    identities: await lockStripePersonIdentitiesInExecutor(executor, [actor.userId]) };
}

export function stripeSubscriptionCanBill(subscription: Stripe.Subscription): boolean {
  // Even paused/unpaid/incomplete subscriptions can resume or complete. Manage those in the Portal.
  return subscription.status !== "canceled" && subscription.status !== "incomplete_expired";
}

export function requireOwnedStripeCheckout(
  attempt: StripeCheckoutAttempt, session: Stripe.Checkout.Session,
): void {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (attempt.accountDeletedAt !== null || session.client_reference_id !== attempt.attemptId
    || session.metadata?.nibomo_checkout_attempt_id !== attempt.attemptId
    || session.metadata?.application !== "nibomo" || session.mode !== "subscription"
    || customerId !== attempt.customerId || session.livemode !== (attempt.environment === "production")
    || (attempt.sessionId !== null && attempt.sessionId !== session.id)) {
    throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
      "Checkout does not belong to this account and operation. Open Subscription settings for the current account.");
  }
}

export async function observeStripeCustomerInExecutor(
  executor: DatabaseExecutor, identity: StripeCustomerIdentity, provider: StripeProvider,
): Promise<StripeCustomerObservation> {
  if (identity.customerId === null) throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
    "The Stripe customer reservation has not finished. Retry its original operation.");
  const customer = await provider.retrieveCustomer(identity.customerId);
  if (customer.metadata.nibomo_identity_id !== identity.identityId) {
    throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false, "Stripe customer ownership could not be confirmed.");
  }
  const attempts = await listStripeCheckoutAttemptsInExecutor(executor, identity);
  const sessions = await provider.listCheckouts(identity.customerId);
  for (const session of sessions) {
    const attempt = attempts.find((candidate) => candidate.attemptId === session.client_reference_id);
    if (attempt === undefined) throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", false,
      "A Nibomo Checkout has no owned reservation. Contact support before starting another purchase.");
    requireOwnedStripeCheckout(attempt, session);
    await recordStripeCheckoutSessionInExecutor(executor, attempt, session);
  }
  for (const attempt of attempts) {
    if (sessions.some((session) => session.client_reference_id === attempt.attemptId)) continue;
    if (attempt.status === "open") throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
      "An open Checkout could not be found at Stripe. Retry reconciliation before purchasing.");
    if (attempt.status === "pending" && attempt.expiresAt.getTime() <= Date.now()) {
      await abandonStripeCheckoutAttemptInExecutor(executor, attempt);
    }
  }
  const trial = await provider.retrieveFirstCustomerTrial(identity.customerId);
  if (trial !== null) await recordStripeTrialConsumptionInExecutor(executor, identity.identityId, identity.environment,
    trial.subscriptionId, trial.consumedAt);
  const subscriptions = await provider.listSubscriptions(identity.customerId);
  const transitions = await reconcileStripeSubscriptionsInExecutor(executor, provider, identity,
    subscriptions.map((subscription) => subscription.id), new Date());
  const current = await listStripeCheckoutAttemptsInExecutor(executor, identity);
  if (await hasStripeTrialConsumptionInExecutor(executor, identity.identityId, identity.environment)) {
    for (const attempt of current) {
      if (attempt.trialDays !== 7 || (attempt.status !== "pending" && attempt.status !== "open")) continue;
      if (attempt.sessionId === null) throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
        "Trial eligibility changed during Checkout creation. Wait for its reservation to expire before retrying.");
      const session = await provider.expireCheckout(attempt.sessionId, attempt.customerId);
      requireOwnedStripeCheckout(attempt, session);
      await recordStripeCheckoutSessionInExecutor(executor, attempt, session);
      if (session.status !== "expired") throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
        "Checkout completed during trial reconciliation. Refresh Subscription settings.");
    }
  }
  const reconciledAttempts = await listStripeCheckoutAttemptsInExecutor(executor, identity);
  return { identity, provider, subscriptions, transitions,
    pending: reconciledAttempts.filter((attempt) => attempt.status === "pending" || attempt.status === "open") };
}

export async function observeStripeAccountInExecutor(
  executor: DatabaseExecutor, context: StripeAccountContext,
): Promise<ReadonlyArray<StripeCustomerObservation>> {
  const providers = new Map<StripeEnvironment, StripeProvider>();
  const observations: Array<StripeCustomerObservation> = [];
  for (const identity of context.identities) {
    if (identity.customerId === null) continue;
    let provider = providers.get(identity.environment);
    if (provider === undefined) {
      provider = await loadStripeProvider(identity.environment);
      providers.set(identity.environment, provider);
    }
    observations.push(await observeStripeCustomerInExecutor(executor, identity, provider));
  }
  return observations;
}

function existingSubscription(
  observations: ReadonlyArray<StripeCustomerObservation>,
): StripeCheckoutResult | null {
  const customer = observations.find((observation) => observation.subscriptions.some(stripeSubscriptionCanBill));
  return customer === undefined ? null : { outcome: "existing_subscription", identityId: customer.identity.identityId };
}

function requireCheckoutEnabled(context: StripeAccountContext): void {
  if (!context.checkoutEnabled) throw new StripeBillingError("STRIPE_BILLING_UNAVAILABLE", false,
    "New Stripe purchases are unavailable. Existing subscriptions can still be managed in Subscription settings.");
}

function checkoutResult(attempt: StripeCheckoutAttempt, session: Stripe.Checkout.Session): StripeCheckoutResult {
  if (session.status === "complete") return { outcome: "complete", attemptId: attempt.attemptId, sessionId: session.id };
  if (session.status !== "open" || session.url === null) throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
    "Checkout is no longer open. Refresh Subscription settings before starting another purchase.");
  return { outcome: "checkout", attemptId: attempt.attemptId, sessionId: session.id, url: session.url,
    expiresAt: new Date(session.expires_at * 1000).toISOString(), trialDays: attempt.trialDays };
}

async function prepareStripeCheckoutInExecutor(
  executor: DatabaseExecutor, actor: StripeHumanActor,
): Promise<Readonly<{
  context: StripeAccountContext;
  existing: StripeCheckoutResult | null;
  attempt: StripeCheckoutAttempt | null;
  transitions: ReadonlyArray<StripeCommittedTransition>;
}>> {
  const context = await lockStripeHumanAccountInExecutor(executor, actor);
  const observations = await observeStripeAccountInExecutor(executor, context);
  const existing = existingSubscription(observations);
  const transitions = observations.flatMap((observation) => observation.transitions);
  const pending = observations.flatMap((observation) => observation.pending);
  if (existing !== null) {
    for (const observation of observations) {
      for (const attempt of observation.pending) {
        if (attempt.sessionId === null) throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", true,
          "A prior Checkout is still being confirmed. Refresh its status before purchasing again.");
        const session = await observation.provider.expireCheckout(attempt.sessionId, attempt.customerId);
        requireOwnedStripeCheckout(attempt, session);
        await recordStripeCheckoutSessionInExecutor(executor, attempt, session);
      }
    }
    return { context, existing, attempt: null, transitions };
  }
  if (pending.length > 1) throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", false,
    "Multiple historical Checkout operations need reconciliation. Contact support before another purchase.");
  return { context, existing: null, attempt: pending[0] ?? null, transitions };
}

export async function createStripeCheckout(actor: StripeHumanActor): Promise<StripeCheckoutResult> {
  const prepared = await unsafeTransaction((executor) => prepareStripeCheckoutInExecutor(executor, actor));
  await publishStripeTransitions(prepared.transitions);
  if (prepared.existing !== null) return prepared.existing;
  let reservedAttempt = prepared.attempt;
  if (reservedAttempt === null) {
    requireCheckoutEnabled(prepared.context);
    const provider = await loadStripeProvider(prepared.context.environment);
    const identity = await getOrCreateStripeCustomer(actor.subject, actor.userId, provider);
    const reserved = await unsafeTransaction(async (executor) => {
      const current = await prepareStripeCheckoutInExecutor(executor, actor);
      if (current.existing !== null || current.attempt !== null) return current;
      requireCheckoutEnabled(current.context);
      if (current.context.environment !== identity.environment) throw new StripeBillingError("STRIPE_STORAGE_CONFLICT", true,
        "Billing account eligibility changed. Refresh Subscription settings.");
      return { ...current, attempt: await reserveStripeCheckoutAttemptInExecutor(executor, identity,
        stripeHostedLocale(current.context.locale)) };
    });
    await publishStripeTransitions(reserved.transitions);
    if (reserved.existing !== null) return reserved.existing;
    reservedAttempt = reserved.attempt;
  }
  if (reservedAttempt === null) throw new StripeBillingError("STRIPE_STORAGE_CONFLICT", true,
    "Checkout reservation did not commit. Retry the purchase request.");
  const { attemptId, environment } = reservedAttempt;
  // The reservation has committed. Keep lifecycle/profile/identity locks across the provider request.
  const created = await unsafeTransaction(async (executor) => {
    const current = await prepareStripeCheckoutInExecutor(executor, actor);
    if (current.existing !== null) return { result: current.existing, transitions: current.transitions };
    const attempt = await loadStripeCheckoutAttemptInExecutor(executor, attemptId, environment);
    if (attempt === null || attempt.userId !== actor.userId || attempt.accountDeletedAt !== null
      || !current.context.identities.some((candidate) => candidate.identityId === attempt.identityId)) {
      throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false, "Checkout ownership changed. Sign in again.");
    }
    if (attempt.sessionId === null) {
      requireCheckoutEnabled(current.context);
      if (current.context.environment !== attempt.environment) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
        "The pending Checkout environment is no longer eligible for new purchases.");
    }
    const provider = await loadStripeProvider(environment);
    const session = await provider.createCheckout(attempt);
    requireOwnedStripeCheckout(attempt, session);
    await recordStripeCheckoutSessionInExecutor(executor, attempt, session);
    const identity = current.context.identities.find((candidate) => candidate.identityId === attempt.identityId);
    if (identity === undefined) throw new StripeBillingError("STRIPE_STORAGE_CONFLICT", true,
      "Checkout identity changed during completion. Refresh Subscription settings.");
    const completed = session.status === "complete"
      ? await observeStripeCustomerInExecutor(executor, identity, provider) : null;
    return { result: checkoutResult(attempt, session),
      transitions: [...current.transitions, ...(completed?.transitions ?? [])] };
  });
  await publishStripeTransitions(created.transitions);
  return created.result;
}

export async function reconcileStripeCheckoutReturn(
  actor: StripeHumanActor, input: StripeCheckoutReturn,
): Promise<StripeCheckoutReturnResult> {
  if (!z.uuid().safeParse(input.attemptId).success || !/^cs_[A-Za-z0-9_]+$/.test(input.sessionId)) {
    throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false, "Checkout return identifiers are invalid.");
  }
  const reconciled = await unsafeTransaction(async (executor) => {
    const context = await lockStripeHumanAccountInExecutor(executor, actor);
    for (const identity of context.identities) {
      const attempt = await loadStripeCheckoutAttemptInExecutor(executor, input.attemptId, identity.environment);
      if (attempt === null || attempt.identityId !== identity.identityId || attempt.userId !== actor.userId) continue;
      const provider = await loadStripeProvider(identity.environment);
      const session = await provider.retrieveCheckout(input.sessionId, attempt.customerId);
      requireOwnedStripeCheckout(attempt, session);
      await recordStripeCheckoutSessionInExecutor(executor, attempt, session);
      const observation = await observeStripeCustomerInExecutor(executor, identity, provider);
      const confirmed = await loadStripeCheckoutAttemptInExecutor(executor, attempt.attemptId, identity.environment);
      if (confirmed === null || (confirmed.status !== "open" && confirmed.status !== "complete"
        && confirmed.status !== "expired")) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", true,
        "Stripe returned no confirmed Checkout status. Retry confirmation.");
      const result: StripeCheckoutReturnResult = {
        attemptId: attempt.attemptId, sessionId: session.id, status: confirmed.status,
      };
      return { result, transitions: observation.transitions };
    }
    throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
      "Checkout does not belong to the current account. Open its Subscription settings.");
  });
  await publishStripeTransitions(reconciled.transitions);
  return reconciled.result;
}
