import { randomUUID } from "node:crypto";
import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../../database";
import type { AccountKind } from "../limits";
import type { PurchaseStatus } from "../resolver";
import { AppleBillingError, type ApplePurchaseIdentity, type ApplePurchaseState, type AppleNotification } from "./contracts";

export type StoredApplePurchase = Readonly<{
  purchase_id: string;
  user_id: string | null;
  status: PurchaseStatus;
  is_trial: boolean;
  will_renew: boolean;
  account_deleted_at: Date | null;
}>;
export type AppleAccount = Readonly<{ userId: string; accountKind: AccountKind }>;

export async function lockAppleAccount(executor: DatabaseExecutor, userId: string): Promise<AppleAccount | null> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const result = await executor.query<{ email: string | null }>(
    "SELECT email FROM org.user_settings WHERE user_id = $1 FOR UPDATE", [userId],
  );
  const row = result.rows[0];
  return row === undefined ? null : { userId, accountKind: row.email === null ? "guest" : "account" };
}

export async function accountToken(executor: DatabaseExecutor, userId: string): Promise<string> {
  if (await lockAppleAccount(executor, userId) === null) {
    throw new AppleBillingError("APPLE_ACCOUNT_RETIRED", false, "The purchasing account no longer exists. Authenticate again.");
  }
  const result = await executor.query<{ token: string }>(`
    INSERT INTO billing.user_billing_state (user_id, apple_app_account_token)
    VALUES ($1, $2::uuid)
    ON CONFLICT (user_id) DO UPDATE SET
      apple_app_account_token = COALESCE(billing.user_billing_state.apple_app_account_token, EXCLUDED.apple_app_account_token),
      updated_at = now()
    RETURNING apple_app_account_token::text AS token`, [userId, randomUUID()]);
  return result.rows[0].token;
}

async function readPurchase(executor: DatabaseExecutor, identity: ApplePurchaseIdentity): Promise<StoredApplePurchase | null> {
  const result = await executor.query<StoredApplePurchase>(`
    SELECT purchase_id, user_id, status, is_trial, will_renew, account_deleted_at
    FROM billing.purchases WHERE provider = 'apple' AND provider_purchase_id = $1 AND environment = $2`,
  [identity.originalTransactionId, identity.environment]);
  return result.rows[0] ?? null;
}

export async function lockPurchase(
  executor: DatabaseExecutor, identity: ApplePurchaseIdentity, presentingUserId: string | null,
): Promise<Readonly<{ previous: StoredApplePurchase | null; accounts: ReadonlyArray<AppleAccount>; ownerUserId: string | null }>> {
  await executor.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`apple:${identity.environment}:${identity.originalTransactionId}`]);
  const observed = await readPurchase(executor, identity);
  // A token may attribute an unowned purchase, but can never reclaim an attached one.
  const tokenOwner = observed?.user_id == null && identity.appAccountToken !== null
    ? (await executor.query<{ user_id: string }>(
      "SELECT user_id FROM billing.user_billing_state WHERE apple_app_account_token = $1::uuid",
      [identity.appAccountToken])).rows[0]?.user_id ?? null : null;
  const userIds = [...new Set([observed?.user_id ?? null, presentingUserId, tokenOwner]
    .filter((id): id is string => id !== null))].sort((left, right) => left.localeCompare(right));
  const accounts: Array<AppleAccount> = [];
  // Account lifecycle writers lock profiles before billing rows; retain that ordering.
  for (const userId of userIds) {
    const account = await lockAppleAccount(executor, userId);
    if (account !== null) accounts.push(account);
    else if (userId === presentingUserId) {
      throw new AppleBillingError("APPLE_ACCOUNT_RETIRED", false, "The purchasing account no longer exists. Authenticate again.");
    }
  }
  await executor.query(`SELECT purchase_id FROM billing.purchases
    WHERE provider = 'apple' AND provider_purchase_id = $1 AND environment = $2 FOR UPDATE`,
  [identity.originalTransactionId, identity.environment]);
  const previous = await readPurchase(executor, identity);
  if (previous?.user_id !== observed?.user_id) {
    throw new AppleBillingError("APPLE_OWNER_CHANGED", true, "Purchase ownership changed during account upgrade or deletion. Retry.");
  }
  const liveTokenOwner = accounts.some((account) => account.userId === tokenOwner) ? tokenOwner : null;
  return { previous, accounts, ownerUserId: previous?.user_id ?? liveTokenOwner };
}

export async function recordNotification(
  executor: DatabaseExecutor, notification: AppleNotification, previous: StoredApplePurchase | null,
  accounts: ReadonlyArray<AppleAccount>, userId: string | null,
): Promise<boolean> {
  const retainPayload = userId !== null && accounts.some((account) => account.userId === userId)
    && (previous === null || previous.account_deleted_at === null);
  // Unattached/deleted owners have no future erasure reach; retain only accounting metadata.
  await executor.query(`INSERT INTO billing.provider_events
    (provider, event_id, event_type, occurred_at, payload_raw, user_id, provider_purchase_id, environment)
    VALUES ('apple', $1, $2, $3, $4, $5, $6, $7) ON CONFLICT (provider, event_id) DO NOTHING`,
  [notification.eventId, notification.eventType, notification.occurredAt,
    retainPayload ? notification.signedPayload : "", userId,
    notification.identity?.originalTransactionId ?? null, notification.environment]);
  const result = await executor.query<{ processed_at: Date | null; provider_purchase_id: string | null; environment: string }>(`
    SELECT processed_at, provider_purchase_id, environment FROM billing.provider_events
    WHERE provider = 'apple' AND event_id = $1 FOR UPDATE`, [notification.eventId]);
  const event = result.rows[0];
  if (event.environment !== notification.environment || event.provider_purchase_id !== (notification.identity?.originalTransactionId ?? null)) {
    throw new AppleBillingError("APPLE_EVENT_IDENTITY_MISMATCH", false, "Apple notification UUID already identifies another purchase.");
  }
  // A retry may follow a transfer or erasure; never restore its scrubbed payload.
  await executor.query(`UPDATE billing.provider_events SET user_id = $2
    WHERE provider = 'apple' AND event_id = $1 AND processed_at IS NULL`, [notification.eventId, userId]);
  return event.processed_at !== null;
}

export async function persistPurchase(
  executor: DatabaseExecutor, state: ApplePurchaseState, presentingUserId: string | null,
  previous: StoredApplePurchase | null, accounts: ReadonlyArray<AppleAccount>,
): Promise<StoredApplePurchase> {
  const userId = presentingUserId ?? previous?.user_id ?? null;
  const result = await executor.query<StoredApplePurchase>(`
    INSERT INTO billing.purchases
      (provider, provider_purchase_id, environment, kind, tier, user_id, status, is_trial,
       will_renew, until, grace_until, provider_status_raw)
    VALUES ('apple', $1, $2, 'subscription', 'premium', $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (provider, provider_purchase_id, environment) DO UPDATE SET
      previous_user_id = CASE WHEN billing.purchases.user_id IS DISTINCT FROM EXCLUDED.user_id
        THEN billing.purchases.user_id ELSE billing.purchases.previous_user_id END,
      user_id = EXCLUDED.user_id, status = EXCLUDED.status, is_trial = EXCLUDED.is_trial,
      will_renew = EXCLUDED.will_renew, until = EXCLUDED.until, grace_until = EXCLUDED.grace_until,
      provider_status_raw = EXCLUDED.provider_status_raw,
      account_deleted_at = CASE WHEN $10::text IS NOT NULL THEN NULL ELSE billing.purchases.account_deleted_at END,
      updated_at = now()
    RETURNING purchase_id, user_id, status, is_trial, will_renew, account_deleted_at`,
  [state.originalTransactionId, state.environment, userId, state.status, state.isTrial, state.willRenew,
    state.until, state.graceUntil, state.providerStatus, presentingUserId]);
  if (userId !== null && accounts.some((account) => account.userId === userId)) {
    await executor.query(`INSERT INTO billing.user_billing_state
      (user_id, trial_consumed_at, trial_provider, ever_purchased_at)
      VALUES ($1, $2, CASE WHEN $2::timestamptz IS NULL THEN NULL ELSE 'apple' END, $3)
      ON CONFLICT (user_id) DO UPDATE SET
        trial_provider = CASE WHEN EXCLUDED.trial_consumed_at < billing.user_billing_state.trial_consumed_at
          OR billing.user_billing_state.trial_consumed_at IS NULL THEN EXCLUDED.trial_provider
          ELSE billing.user_billing_state.trial_provider END,
        trial_consumed_at = LEAST(billing.user_billing_state.trial_consumed_at, EXCLUDED.trial_consumed_at),
        ever_purchased_at = LEAST(billing.user_billing_state.ever_purchased_at, EXCLUDED.ever_purchased_at),
        updated_at = now()`, [userId, state.isTrial ? state.purchasedAt : null, state.paid ? state.purchasedAt : null]);
  }
  return result.rows[0];
}

export async function finishNotification(executor: DatabaseExecutor, eventId: string): Promise<void> {
  await executor.query(`UPDATE billing.provider_events SET processed_at = now(), processing_error = NULL
    WHERE provider = 'apple' AND event_id = $1`, [eventId]);
}
