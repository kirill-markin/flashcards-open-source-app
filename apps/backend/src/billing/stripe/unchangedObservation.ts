import { isDeletedSubjectInExecutor } from "../../auth/deletedSubjects";
import { loadCognitoIdentityMappingInExecutor } from "../../auth/userIdentities";
import { applyUserDatabaseScopeInExecutor } from "../../database";
import { unsafeRepeatableReadReadOnlyTransaction } from "../../database/core";
import { requireOwnedStripeCheckout, requireOwnedStripeCustomer, toStripeAccountContext,
  type StripeAccountContext, type StripeCustomerView, type StripeHumanActor } from "./checkout";
import type { StripeCheckoutAttempt, StripeCustomerIdentity, StripeEnvironment, StripePurchaseState } from "./contracts";
import { getStripeAccountTrialEligibilityInExecutor, hasStripeTrialConsumptionInExecutor,
  listStripeCheckoutAttemptsInExecutor, listStripePersonIdentitiesInExecutor } from "./identityStore";
import { loadStripeProvider, type StripeProvider } from "./provider";
import { retrieveStableStripePurchaseState } from "./service";
import { listEverPurchasedAtInExecutor, listStripePurchasesOfUsersInExecutor,
  type ComparableStripePurchase } from "./store";

export type StripeUnchangedAccount = Readonly<{
  context: StripeAccountContext;
  trialEligible: boolean | null;
  customers: ReadonlyArray<StripeCustomerView>;
}>;
type StoredStripeCustomer = Readonly<{
  identity: StripeCustomerIdentity;
  customerId: string;
  attempts: ReadonlyArray<StripeCheckoutAttempt>;
  trialConsumed: boolean;
}>;
type StoredStripeAccount = Readonly<{
  context: StripeAccountContext;
  trialEligible: boolean | null;
  customers: ReadonlyArray<StoredStripeCustomer>;
  purchases: ReadonlyArray<ComparableStripePurchase>;
  everPurchasedAt: ReadonlyMap<string, Date>;
}>;

function isLiveCheckout(attempt: StripeCheckoutAttempt): boolean {
  return attempt.status === "pending" || attempt.status === "open";
}

// Null wherever lockStripeAccountInExecutor would refuse, so the locked path raises its error.
async function readStoredStripeAccount(actor: StripeHumanActor): Promise<StoredStripeAccount | null> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => {
    const mapping = await loadCognitoIdentityMappingInExecutor(executor, actor.subject);
    if (await isDeletedSubjectInExecutor(executor, actor.subject) || mapping?.userId !== actor.userId) return null;
    await applyUserDatabaseScopeInExecutor(executor, { userId: actor.userId });
    const profile = (await executor.query<{ email: string | null; locale: string }>(
      "SELECT email, locale FROM org.user_settings WHERE user_id = $1", [actor.userId])).rows[0];
    if (profile === undefined || profile.email === null || profile.email.trim() === "") return null;
    const identities = await listStripePersonIdentitiesInExecutor(executor, actor.userId);
    const context = toStripeAccountContext({ email: profile.email, locale: profile.locale }, identities);
    const customers: Array<StoredStripeCustomer> = [];
    for (const identity of identities) {
      if (identity.customerId === null) continue;
      customers.push({ identity, customerId: identity.customerId,
        attempts: await listStripeCheckoutAttemptsInExecutor(executor, identity),
        trialConsumed: await hasStripeTrialConsumptionInExecutor(executor, identity.identityId, identity.environment) });
    }
    const userIds = [...new Set(identities.map((identity) => identity.userId))];
    return { context, customers,
      trialEligible: await getStripeAccountTrialEligibilityInExecutor(executor, actor.userId, context.environment),
      purchases: await listStripePurchasesOfUsersInExecutor(executor, userIds),
      everPurchasedAt: await listEverPurchasedAtInExecutor(executor, userIds) };
  });
}

// Mirrors persistStripePurchaseInExecutor: true only when its upsert and first-paid write change nothing.
function stripePurchaseUnchanged(
  stored: ComparableStripePurchase, state: StripePurchaseState, identity: StripeCustomerIdentity,
  trialConsumed: boolean, everPurchasedAt: Date | undefined,
): boolean {
  if (stored.user_id !== identity.userId || (state.trialStartedAt !== null && !trialConsumed)) return false;
  if (stored.invalidated_at !== null || stored.account_deleted_at !== null) return true;
  return stored.status === state.status && stored.is_trial === state.isTrial && stored.will_renew === state.willRenew
    && stored.until?.getTime() === state.until.getTime() && stored.grace_until === null
    && stored.provider_status_raw === state.providerStatus
    && (state.firstPaidAt === null
      || (everPurchasedAt !== undefined && everPurchasedAt.getTime() <= state.firstPaidAt.getTime()));
}

// The reads of observeStripeCustomerInExecutor; null as soon as one of its writes would change a row.
async function observeUnchangedStripeCustomer(
  provider: StripeProvider, stored: StoredStripeCustomer, account: StoredStripeAccount,
): Promise<StripeCustomerView | null> {
  const { identity, customerId, attempts, trialConsumed } = stored;
  if (trialConsumed && attempts.some((attempt) => attempt.trialDays === 7 && isLiveCheckout(attempt))) return null;
  requireOwnedStripeCustomer(identity, await provider.retrieveCustomer(customerId));
  const sessions = await provider.listCheckouts(customerId);
  for (const session of sessions) {
    const attempt = attempts.find((candidate) => candidate.attemptId === session.client_reference_id);
    if (attempt === undefined) return null;
    requireOwnedStripeCheckout(attempt, session);
    if (attempt.sessionId !== session.id || attempt.status !== session.status) return null;
  }
  for (const attempt of attempts) {
    if (sessions.some((session) => session.client_reference_id === attempt.attemptId)) continue;
    if (attempt.status === "open" || (attempt.status === "pending" && attempt.expiresAt.getTime() <= Date.now())) return null;
  }
  if (await provider.retrieveFirstCustomerTrial(customerId) !== null && !trialConsumed) return null;
  const subscriptions = await provider.listSubscriptions(customerId);
  const transitions: Array<StripeCustomerView["transitions"][number]> = [];
  for (const subscriptionId of [...new Set(subscriptions.map((subscription) => subscription.id))].sort()) {
    const state = await retrieveStableStripePurchaseState(provider, customerId, subscriptionId);
    const purchase = account.purchases.find((candidate) => candidate.environment === identity.environment
      && candidate.provider_purchase_id === subscriptionId);
    if (purchase === undefined || !stripePurchaseUnchanged(purchase, state, identity, trialConsumed,
      account.everPurchasedAt.get(identity.userId))) return null;
    transitions.push({ purchase, state });
  }
  return { identity, subscriptions, transitions, pending: attempts.filter(isLiveCheckout) };
}

// Holds no lock and writes nothing: no transaction is open during the Stripe calls. Null means the
// locked reconciliation must run, because Stripe differs from the stored rows or the account check failed.
export async function observeUnchangedStripeAccount(actor: StripeHumanActor): Promise<StripeUnchangedAccount | null> {
  const stored = await readStoredStripeAccount(actor);
  if (stored === null) return null;
  const providers = new Map<StripeEnvironment, StripeProvider>();
  const customers: Array<StripeCustomerView> = [];
  for (const customer of stored.customers) {
    let provider = providers.get(customer.identity.environment);
    if (provider === undefined) {
      provider = await loadStripeProvider(customer.identity.environment);
      providers.set(customer.identity.environment, provider);
    }
    const observed = await observeUnchangedStripeCustomer(provider, customer, stored);
    if (observed === null) return null;
    customers.push(observed);
  }
  return { context: stored.context, trialEligible: stored.trialEligible, customers };
}
