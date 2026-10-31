import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { isDeletedSubjectInExecutor } from "../../auth/deletedSubjects";
import { loadCognitoIdentityMappingInExecutor, lockCognitoIdentityLifecycleInExecutor, lockAccountLifecyclesInExecutor } from "../../auth/userIdentities";
import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import { requireStripeOfferAvailable, resolveStripeOffer, type StripeResolvedOffer,
  type RegionalPricingBand, type StripeOfferSelection } from "../regionalPricing/offers";
import { stripeCatalog } from "./catalog";
import { StripeBillingError, type StripeCheckoutAttempt, type StripeCheckoutStatus,
  type StripeCustomerIdentity, type StripeEnvironment } from "./contracts";
import type { StripeProvider } from "./provider";

type IdentityRow = Readonly<{
  identity_id: string; environment: StripeEnvironment; user_id: string; customer_id: string | null;
  is_primary: boolean; created_at: Date; account_deleted_at: Date | null;
}>;
type CheckoutRow = Readonly<{
  attempt_id: string; identity_id: string; environment: StripeEnvironment; user_id: string;
  customer_id: string; session_id: string | null; status: StripeCheckoutStatus;
  selected_country: string | null; pricing_band: RegionalPricingBand; price_id: string; checkout_mode: "legacy" | "managed";
  trial_days: 0 | 7; locale: Stripe.Checkout.SessionCreateParams.Locale;
  expires_at: Date; created_at: Date; account_deleted_at: Date | null;
}>;

function toIdentity(row: IdentityRow): StripeCustomerIdentity {
  return { identityId: row.identity_id, environment: row.environment, userId: row.user_id,
    customerId: row.customer_id, isPrimary: row.is_primary, createdAt: row.created_at,
    accountDeletedAt: row.account_deleted_at };
}

function toCheckout(row: CheckoutRow): StripeCheckoutAttempt {
  return { attemptId: row.attempt_id, identityId: row.identity_id, environment: row.environment,
    userId: row.user_id, customerId: row.customer_id, sessionId: row.session_id, status: row.status,
    selectedCountry: row.selected_country, pricingBand: row.pricing_band, priceId: row.price_id, checkoutMode: row.checkout_mode,
    trialDays: row.trial_days, locale: row.locale, expiresAt: row.expires_at, createdAt: row.created_at,
    accountDeletedAt: row.account_deleted_at };
}

function storageConflict(): never {
  throw new StripeBillingError("STRIPE_STORAGE_CONFLICT", true,
    "Stripe billing ownership or operation state changed. Reconcile the stored identity and retry.");
}

// Order for creation/deletion/merge: Cognito subject lock, account locks, user_settings rows (sorted
// for multi-person work), customer identities, Checkout rows, billing purchases/snapshot rows.
// Hold the transaction across the external creation/cancellation call. A reservation must have
// committed in an earlier transaction. Never acquire the lifecycle lock after locking billing rows.
export async function lockStripeAccountInExecutor(
  executor: DatabaseExecutor, subject: string, userId: string,
): Promise<void> {
  await lockCognitoIdentityLifecycleInExecutor(executor, subject);
  const mapping = await loadCognitoIdentityMappingInExecutor(executor, subject);
  await lockAccountLifecyclesInExecutor(executor, [userId]);
  if (await isDeletedSubjectInExecutor(executor, subject) || mapping?.userId !== userId) {
    throw new StripeBillingError("STRIPE_ACCOUNT_RETIRED", false,
      "Stripe billing requires a current authenticated account. Sign in again.");
  }
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const result = await executor.query<{ email: string | null }>(
    "SELECT email FROM org.user_settings WHERE user_id = $1 FOR UPDATE", [userId]);
  if (result.rows[0] === undefined) throw new StripeBillingError("STRIPE_ACCOUNT_RETIRED", false,
    "The billing account no longer exists. Sign in again.");
  if (result.rows[0].email === null || result.rows[0].email.trim() === "") {
    throw new StripeBillingError("STRIPE_EMAIL_REQUIRED", false, "Link an email before purchasing through Stripe.");
  }
}

export async function listStripeCustomerIdentitiesInExecutor(
  executor: DatabaseExecutor, userId: string, environment: StripeEnvironment,
): Promise<ReadonlyArray<StripeCustomerIdentity>> {
  const result = await executor.query<IdentityRow>(`SELECT identity_id, environment, auth.canonical_account_id(user_id) AS user_id, customer_id,
    is_primary, created_at, account_deleted_at FROM billing.stripe_customer_identities
    WHERE user_id = $1 AND environment = $2 ORDER BY identity_id`, [userId, environment]);
  return result.rows.map(toIdentity);
}

export async function findStripeCustomerIdentityInExecutor(
  executor: DatabaseExecutor, environment: StripeEnvironment, customerId: string,
): Promise<StripeCustomerIdentity | null> {
  const result = await executor.query<IdentityRow>(`SELECT identity_id, environment, auth.canonical_account_id(user_id) AS user_id, customer_id,
    is_primary, created_at, account_deleted_at FROM billing.stripe_customer_identities
    WHERE environment = $1 AND customer_id = $2`, [environment, customerId]);
  return result.rows[0] === undefined ? null : toIdentity(result.rows[0]);
}

export async function getOrCreateStripeCustomer(
  subject: string, userId: string, provider: StripeProvider,
): Promise<StripeCustomerIdentity> {
  const identity = await unsafeTransaction(async (executor) => {
    await lockStripeAccountInExecutor(executor, subject, userId);
    await executor.query(`INSERT INTO billing.stripe_customer_identities (identity_id, environment, user_id)
      VALUES ($1, $2, $3) ON CONFLICT (user_id, environment)
      WHERE is_primary AND account_deleted_at IS NULL DO NOTHING`, [randomUUID(), provider.environment, userId]);
    const rows = await listStripeCustomerIdentitiesInExecutor(executor, userId, provider.environment);
    const primary = rows.find((row) => row.isPrimary && row.accountDeletedAt === null);
    if (primary === undefined) return storageConflict();
    return primary;
  });
  return unsafeTransaction(async (executor) => {
    await lockStripeAccountInExecutor(executor, subject, userId);
    const result = await executor.query<IdentityRow>(`SELECT identity_id, environment, auth.canonical_account_id(user_id) AS user_id, customer_id,
      is_primary, created_at, account_deleted_at FROM billing.stripe_customer_identities
      WHERE identity_id = $1 AND environment = $2 FOR UPDATE`, [identity.identityId, provider.environment]);
    const row = result.rows[0];
    if (row === undefined || row.user_id !== userId || row.account_deleted_at !== null || !row.is_primary) {
      return storageConflict();
    }
    const current = toIdentity(row);
    const customer = await provider.createOrRecoverCustomer(current);
    await executor.query(`UPDATE billing.stripe_customer_identities SET customer_id = $2, updated_at = now()
      WHERE identity_id = $1`, [identity.identityId, customer.id]);
    return { ...current, customerId: customer.id };
  });
}

export async function hasStripeTrialConsumptionInExecutor(
  executor: DatabaseExecutor, identityId: string, environment: StripeEnvironment,
): Promise<boolean> {
  const result = await executor.query(`SELECT identity_id FROM billing.stripe_trial_consumptions
    WHERE identity_id = $1 AND environment = $2`, [identityId, environment]);
  return result.rows.length > 0;
}

// Only future offers use the combined account history. Existing frozen offers keep customer semantics.
export async function getStripeAccountTrialEligibilityInExecutor(
  executor: DatabaseExecutor, userId: string, environment: StripeEnvironment,
): Promise<boolean | null> {
  const result = await executor.query<{
    customer_id: string | null; is_primary: boolean; trial_consumed: boolean;
  }>(`SELECT owned.customer_id, owned.is_primary AND owned.account_deleted_at IS NULL AS is_primary,
    consumed.identity_id IS NOT NULL AS trial_consumed
    FROM billing.stripe_customer_identities AS owned
    LEFT JOIN billing.stripe_trial_consumptions AS consumed
      ON consumed.identity_id = owned.identity_id AND consumed.environment = owned.environment
    WHERE auth.canonical_account_id(owned.user_id) = auth.canonical_account_id($1)
      AND owned.environment = $2`, [userId, environment]);
  if (result.rows.some((identity) => identity.trial_consumed)) return false;
  const primary = result.rows.find((identity) => identity.is_primary);
  return primary === undefined ? true : primary.customer_id === null ? null : true;
}

// Only a verified provider trial start consumes the trial; an abandoned Checkout never does.
export async function recordStripeTrialConsumptionInExecutor(
  executor: DatabaseExecutor, identityId: string, environment: StripeEnvironment,
  subscriptionId: string, consumedAt: Date,
): Promise<void> {
  await executor.query(`INSERT INTO billing.stripe_trial_consumptions
    (identity_id, environment, subscription_id, consumed_at) VALUES ($1, $2, $3, $4)
    ON CONFLICT (identity_id, environment) DO NOTHING`, [identityId, environment, subscriptionId, consumedAt]);
}

const checkoutColumns = `attempt.attempt_id, attempt.identity_id, attempt.environment,
  auth.canonical_account_id(attempt.user_id) AS user_id,
  identity.customer_id, attempt.session_id, attempt.status, attempt.trial_days, attempt.locale,
  attempt.expires_at, attempt.created_at, attempt.account_deleted_at,
  attempt.selected_country, attempt.pricing_band, attempt.price_id, attempt.checkout_mode`;

export async function loadStripeCheckoutAttemptInExecutor(
  executor: DatabaseExecutor, attemptId: string, environment: StripeEnvironment,
): Promise<StripeCheckoutAttempt | null> {
  const result = await executor.query<CheckoutRow>(`SELECT ${checkoutColumns}
    FROM billing.stripe_checkout_attempts AS attempt JOIN billing.stripe_customer_identities AS identity
      USING (identity_id, environment)
    WHERE attempt.attempt_id = $1 AND attempt.environment = $2`, [attemptId, environment]);
  return result.rows[0] === undefined ? null : toCheckout(result.rows[0]);
}

export function requireStripeCheckoutReservationOfferAvailable(offer: StripeResolvedOffer): void {
  requireStripeOfferAvailable(offer);
  // Keep writes compatible until every pre-regional Checkout invocation has drained.
  if (offer.selectedCountry !== null) throw new StripeBillingError("STRIPE_COUNTRY_UNAVAILABLE", false,
    "Country-selected Checkout is unavailable during the regional pricing rollout. Retry after activation.");
}

// Caller holds lockStripeAccountInExecutor and commits this reservation before calling Stripe.
// Reconciliation must close the prior attempt and record any consumed trial before reserving again.
export async function reserveStripeCheckoutAttemptInExecutor(
  executor: DatabaseExecutor, identity: StripeCustomerIdentity, locale: Stripe.Checkout.SessionCreateParams.Locale,
  selectedOffer?: StripeResolvedOffer,
): Promise<StripeCheckoutAttempt> {
  const identities = await executor.query<IdentityRow>(`SELECT identity_id, environment, auth.canonical_account_id(user_id) AS user_id, customer_id,
    is_primary, created_at, account_deleted_at FROM billing.stripe_customer_identities
    WHERE identity_id = $1 AND environment = $2 FOR UPDATE`, [identity.identityId, identity.environment]);
  const row = identities.rows[0];
  if (row === undefined || row.customer_id === null || row.user_id !== identity.userId
    || row.account_deleted_at !== null || !row.is_primary) return storageConflict();
  const pending = await executor.query<{ attempt_id: string }>(`SELECT attempt_id FROM billing.stripe_checkout_attempts
    WHERE identity_id = $1 AND environment = $2 AND status IN ('pending', 'open')
      AND account_deleted_at IS NULL FOR UPDATE`, [identity.identityId, identity.environment]);
  if (pending.rows[0] !== undefined) {
    const attempt = await loadStripeCheckoutAttemptInExecutor(executor, pending.rows[0].attempt_id, identity.environment);
    return attempt ?? storageConflict();
  }
  const trialDays = await getStripeAccountTrialEligibilityInExecutor(executor, identity.userId, identity.environment) ? 7 : 0;
  const attemptId = randomUUID();
  const resolvedOffer = selectedOffer ?? resolveStripeOffer(identity.environment, null);
  requireStripeCheckoutReservationOfferAvailable(resolvedOffer);
  const offer: StripeOfferSelection = { selectedCountry: null, pricingBand: "full",
    priceId: stripeCatalog[identity.environment].priceId, checkoutMode: "legacy" };
  await executor.query(`INSERT INTO billing.stripe_checkout_attempts
    (attempt_id, identity_id, environment, user_id, trial_days, locale, expires_at,
      selected_country, pricing_band, price_id, checkout_mode)
    VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 hour', $7, $8, $9, $10)`,
  [attemptId, identity.identityId, identity.environment, identity.userId, trialDays, locale,
    offer.selectedCountry, offer.pricingBand, offer.priceId, offer.checkoutMode]);
  return await loadStripeCheckoutAttemptInExecutor(executor, attemptId, identity.environment) ?? storageConflict();
}

// Caller holds the account/identity locks and passes the provider-validated session for this attempt.
export async function recordStripeCheckoutSessionInExecutor(
  executor: DatabaseExecutor, attempt: StripeCheckoutAttempt, session: Stripe.Checkout.Session,
): Promise<void> {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (customerId !== attempt.customerId || session.client_reference_id !== attempt.attemptId
    || session.livemode !== (attempt.environment === "production")
    || (session.managed_payments?.enabled === true) !== (attempt.checkoutMode === "managed")
    || session.line_items?.data[0]?.price?.id !== attempt.priceId
    || (session.status !== "open" && session.status !== "complete" && session.status !== "expired")) {
    return storageConflict();
  }
  const result = await executor.query(`UPDATE billing.stripe_checkout_attempts
    SET session_id = $3, status = $4, updated_at = now()
    WHERE attempt_id = $1 AND environment = $2 AND user_id = $5 AND identity_id = $6
      AND account_deleted_at IS NULL
      AND (session_id IS NULL OR session_id = $3)
      AND (status IN ('pending', 'open') OR status = $4)`,
  [attempt.attemptId, attempt.environment, session.id, session.status, attempt.userId, attempt.identityId]);
  if (result.rowCount !== 1) storageConflict();
}

// Under the account/identity locks, the caller must first list every provider session for this
// customer and prove none names the attempt. Only then may a never-created reservation retire.
export async function abandonStripeCheckoutAttemptInExecutor(
  executor: DatabaseExecutor, attempt: StripeCheckoutAttempt,
): Promise<void> {
  const result = await executor.query(`UPDATE billing.stripe_checkout_attempts
    SET status = 'abandoned', updated_at = now()
    WHERE attempt_id = $1 AND environment = $2 AND user_id = $3 AND account_deleted_at IS NULL
      AND status = 'pending' AND session_id IS NULL AND expires_at <= now()`,
  [attempt.attemptId, attempt.environment, attempt.userId]);
  if (result.rowCount !== 1) storageConflict();
}

// Caller has locked every live profile before entering the identity/Checkout portion of the order.
export async function lockStripePersonIdentitiesInExecutor(
  executor: DatabaseExecutor, userIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<StripeCustomerIdentity>> {
  const identities = await executor.query<IdentityRow>(`SELECT identity_id, environment, auth.canonical_account_id(user_id) AS user_id, customer_id,
    is_primary, created_at, account_deleted_at FROM billing.stripe_customer_identities
    WHERE user_id = ANY($1::text[]) AND account_deleted_at IS NULL
    ORDER BY identity_id FOR UPDATE`, [userIds]);
  if (identities.rows.length === 0) return [];
  await executor.query(`SELECT attempt_id FROM billing.stripe_checkout_attempts
    WHERE identity_id = ANY($1::uuid[]) ORDER BY attempt_id FOR UPDATE`,
  [identities.rows.map((identity) => identity.identity_id)]);
  return identities.rows.map(toIdentity);
}

export async function listStripeCheckoutAttemptsInExecutor(
  executor: DatabaseExecutor, identity: StripeCustomerIdentity,
): Promise<ReadonlyArray<StripeCheckoutAttempt>> {
  const result = await executor.query<CheckoutRow>(`SELECT ${checkoutColumns}
    FROM billing.stripe_checkout_attempts AS attempt JOIN billing.stripe_customer_identities AS identity
      USING (identity_id, environment)
    WHERE attempt.identity_id = $1 AND attempt.environment = $2 AND attempt.account_deleted_at IS NULL
    ORDER BY attempt.created_at, attempt.attempt_id`, [identity.identityId, identity.environment]);
  return result.rows.map(toCheckout);
}
