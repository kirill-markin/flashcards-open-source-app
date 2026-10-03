import type Stripe from "stripe";
import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../../database";
import type { AccountKind } from "../limits";
import type { PurchaseStatus } from "../resolver";
import {
  StripeBillingError, type StripeCustomerIdentity, type StripeEnvironment, type StripePurchaseState,
} from "./contracts";
import { findStripeCustomerIdentityInExecutor, recordStripeTrialConsumptionInExecutor } from "./identityStore";

export type LockedStripeIdentity = Readonly<{
  identity: StripeCustomerIdentity;
  accountKind: AccountKind;
}>;
export type StoredStripePurchase = Readonly<{
  purchase_id: string;
  user_id: string | null;
  status: PurchaseStatus;
  will_renew: boolean;
  invalidated_at: Date | null;
  account_deleted_at: Date | null;
}>;
export type StoredStripeEvent = Readonly<{
  event_id: string;
  environment: StripeEnvironment;
  provider_purchase_id: string | null;
  received_at: Date;
  processed_at: Date | null;
}>;
const purchaseColumns = "purchase_id, user_id, status, will_renew, invalidated_at, account_deleted_at";

function storageConflict(): never {
  throw new StripeBillingError("STRIPE_STORAGE_CONFLICT", true,
    "Stripe lifecycle ownership changed. Retry the same delivery or reconciliation.");
}

// Passive reconciliation never creates an identity. The profile lock alone serializes it with
// deletion/merge; an authenticated caller may already hold the preceding Cognito lifecycle lock.
export async function lockStripeIdentityForLifecycleInExecutor(
  executor: DatabaseExecutor, environment: StripeEnvironment, customerId: string,
): Promise<LockedStripeIdentity | null> {
  const observed = await findStripeCustomerIdentityInExecutor(executor, environment, customerId);
  if (observed === null || observed.accountDeletedAt !== null) return null;
  await applyUserDatabaseScopeInExecutor(executor, { userId: observed.userId });
  const profile = await executor.query<{ email: string | null }>(
    "SELECT email FROM org.user_settings WHERE user_id = $1 FOR UPDATE", [observed.userId]);
  await executor.query(`SELECT identity_id FROM billing.stripe_customer_identities
    WHERE identity_id = $1 AND environment = $2 FOR UPDATE`, [observed.identityId, environment]);
  const identity = await findStripeCustomerIdentityInExecutor(executor, environment, customerId);
  if (identity === null || identity.userId !== observed.userId || identity.accountDeletedAt !== null) {
    return storageConflict();
  }
  if (profile.rows[0] === undefined) return storageConflict();
  await executor.query(`SELECT attempt_id FROM billing.stripe_checkout_attempts
    WHERE identity_id = $1 AND environment = $2 ORDER BY attempt_id FOR UPDATE`, [identity.identityId, environment]);
  return { identity, accountKind: profile.rows[0].email === null ? "guest" : "account" };
}

export async function lockStripePurchasesInExecutor(
  executor: DatabaseExecutor, environment: StripeEnvironment, subscriptionIds: ReadonlyArray<string>,
): Promise<void> {
  for (const id of [...new Set(subscriptionIds)].sort()) {
    await executor.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`stripe:${environment}:${id}`]);
  }
  await executor.query(`SELECT purchase_id FROM billing.purchases WHERE provider = 'stripe'
    AND environment = $1 AND provider_purchase_id = ANY($2::text[])
    ORDER BY provider_purchase_id FOR UPDATE`, [environment, subscriptionIds]);
}

export async function readStripePurchaseInExecutor(
  executor: DatabaseExecutor, environment: StripeEnvironment, subscriptionId: string,
): Promise<StoredStripePurchase | null> {
  const result = await executor.query<StoredStripePurchase>(`SELECT ${purchaseColumns}
    FROM billing.purchases WHERE provider = 'stripe' AND environment = $1 AND provider_purchase_id = $2`,
  [environment, subscriptionId]);
  return result.rows[0] ?? null;
}

export async function persistStripePurchaseInExecutor(
  executor: DatabaseExecutor, identity: StripeCustomerIdentity, state: StripePurchaseState,
): Promise<StoredStripePurchase> {
  if (identity.accountDeletedAt !== null || identity.environment !== state.environment
    || identity.customerId !== state.customerId) return storageConflict();
  if (state.trialStartedAt !== null) {
    await recordStripeTrialConsumptionInExecutor(executor, identity.identityId, state.environment,
      state.subscriptionId, state.trialStartedAt);
  }
  const result = await executor.query<StoredStripePurchase>(`INSERT INTO billing.purchases
    (provider, provider_purchase_id, environment, kind, tier, user_id, status, is_trial, will_renew,
     until, grace_until, provider_status_raw)
    VALUES ('stripe', $1, $2, 'subscription', 'premium', $3, $4, $5, $6, $7, NULL, $8)
    ON CONFLICT (provider, provider_purchase_id, environment) DO UPDATE SET
      status = EXCLUDED.status, is_trial = EXCLUDED.is_trial, will_renew = EXCLUDED.will_renew,
      until = EXCLUDED.until, grace_until = EXCLUDED.grace_until,
      provider_status_raw = EXCLUDED.provider_status_raw, updated_at = now()
    WHERE billing.purchases.user_id = EXCLUDED.user_id
      AND billing.purchases.account_deleted_at IS NULL AND billing.purchases.invalidated_at IS NULL
    RETURNING ${purchaseColumns}`,
  [state.subscriptionId, state.environment, identity.userId, state.status, state.isTrial,
    state.willRenew, state.until, state.providerStatus]);
  const purchase = result.rows[0];
  if (purchase === undefined) {
    const existing = await readStripePurchaseInExecutor(executor, state.environment, state.subscriptionId);
    if (existing === null || existing.user_id !== identity.userId) return storageConflict();
    return existing;
  }
  if (state.firstPaidAt !== null) {
    await executor.query(`INSERT INTO billing.user_billing_state (user_id, ever_purchased_at)
      VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET
      ever_purchased_at = LEAST(billing.user_billing_state.ever_purchased_at, EXCLUDED.ever_purchased_at),
      updated_at = now()`, [identity.userId, state.firstPaidAt]);
  }
  return purchase;
}

export async function retainStripeEventInExecutor(
  executor: DatabaseExecutor, identity: StripeCustomerIdentity, event: Stripe.Event,
  rawBody: Buffer, subscriptionId: string | null,
): Promise<StoredStripeEvent> {
  if (identity.accountDeletedAt !== null) return storageConflict();
  await executor.query(`INSERT INTO billing.provider_events
    (provider, event_id, event_type, occurred_at, payload_raw, payload, user_id, provider_purchase_id, environment)
    VALUES ('stripe', $1, $2, $3, $4, $5::jsonb, $6, $7, $8)
    ON CONFLICT (provider, event_id) DO NOTHING`,
  [event.id, event.type, new Date(event.created * 1000), rawBody.toString("utf8"),
    JSON.stringify(event), identity.userId, subscriptionId, identity.environment]);
  const result = await executor.query<StoredStripeEvent>(`SELECT event_id, environment,
    provider_purchase_id, received_at, processed_at FROM billing.provider_events
    WHERE provider = 'stripe' AND event_id = $1`, [event.id]);
  const row = result.rows[0];
  if (row === undefined || row.environment !== identity.environment || row.provider_purchase_id !== subscriptionId) {
    return storageConflict();
  }
  return row;
}

export async function lockStripeEventInExecutor(
  executor: DatabaseExecutor, eventId: string, environment: StripeEnvironment,
): Promise<StoredStripeEvent> {
  const result = await executor.query<StoredStripeEvent>(`SELECT event_id, environment,
    provider_purchase_id, received_at, processed_at FROM billing.provider_events
    WHERE provider = 'stripe' AND event_id = $1 AND environment = $2 FOR UPDATE`, [eventId, environment]);
  return result.rows[0] ?? storageConflict();
}

export async function finishStripeEventInExecutor(
  executor: DatabaseExecutor, eventId: string, environment: StripeEnvironment,
): Promise<void> {
  await executor.query(`UPDATE billing.provider_events SET processed_at = now(), processing_error = NULL
    WHERE provider = 'stripe' AND event_id = $1 AND environment = $2`, [eventId, environment]);
}

export async function failStripeEventInExecutor(
  executor: DatabaseExecutor, eventId: string, environment: StripeEnvironment, errorCode: string,
): Promise<void> {
  await executor.query(`UPDATE billing.provider_events SET processing_error = $3
    WHERE provider = 'stripe' AND event_id = $1 AND environment = $2 AND processed_at IS NULL`,
  [eventId, environment, errorCode]);
}
