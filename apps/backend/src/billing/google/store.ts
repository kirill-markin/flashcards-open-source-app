import { randomUUID } from "node:crypto";
import { applyUserDatabaseScopeInExecutor, type DatabaseExecutor } from "../../database";
import type { AccountKind } from "../limits";
import type { PurchaseStatus } from "../resolver";
import { GoogleBillingError, type GoogleEnvironment, type GooglePurchaseState } from "./contracts";

export type GoogleAccount = Readonly<{ userId: string; accountKind: AccountKind }>;
export type StoredGooglePurchase = Readonly<{
  purchase_id: string;
  provider_purchase_id: string;
  user_id: string | null;
  status: PurchaseStatus;
  is_trial: boolean;
  will_renew: boolean;
  linked_from_purchase_id: string | null;
  invalidated_at: Date | null;
  account_deleted_at: Date | null;
}>;
export type GooglePurchaseLink = Readonly<{
  purchaseToken: string;
  predecessorToken: string | null;
  // Only unknown ancestors need provider data; stored links already establish their lineage.
  state: GooglePurchaseState | null;
}>;
export type LockedGooglePurchase = Readonly<{
  previous: StoredGooglePurchase | null;
  ancestors: ReadonlyArray<StoredGooglePurchase | null>;
  accounts: ReadonlyArray<GoogleAccount>;
  ownerUserId: string | null;
}>;
const purchaseColumns = `purchase_id, provider_purchase_id, user_id, status, is_trial, will_renew,
  linked_from_purchase_id, invalidated_at, account_deleted_at`;

export async function lockGoogleAccount(executor: DatabaseExecutor, userId: string): Promise<GoogleAccount | null> {
  await applyUserDatabaseScopeInExecutor(executor, { userId });
  const result = await executor.query<{ email: string | null }>(
    "SELECT email FROM org.user_settings WHERE user_id = $1 FOR UPDATE", [userId],
  );
  const row = result.rows[0];
  return row === undefined ? null : { userId, accountKind: row.email === null ? "guest" : "account" };
}

export async function googleAccountId(executor: DatabaseExecutor, userId: string): Promise<string> {
  if (await lockGoogleAccount(executor, userId) === null) {
    throw new GoogleBillingError("GOOGLE_ACCOUNT_RETIRED", false, null,
      "The purchasing account no longer exists. Authenticate again.");
  }
  const result = await executor.query<{ account_id: string }>(`
    INSERT INTO billing.user_billing_state (user_id, google_obfuscated_account_id)
    VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET
      google_obfuscated_account_id = COALESCE(billing.user_billing_state.google_obfuscated_account_id,
        EXCLUDED.google_obfuscated_account_id), updated_at = now()
    RETURNING google_obfuscated_account_id AS account_id`, [userId, randomUUID()]);
  return result.rows[0].account_id;
}

export async function readGooglePurchase(
  executor: DatabaseExecutor, purchaseToken: string, environment: GoogleEnvironment,
): Promise<StoredGooglePurchase | null> {
  const result = await executor.query<StoredGooglePurchase>(`SELECT ${purchaseColumns}
    FROM billing.purchases WHERE provider = 'google' AND provider_purchase_id = $1 AND environment = $2`,
  [purchaseToken, environment]);
  return result.rows[0] ?? null;
}

export function googlePredecessorToken(state: GooglePurchaseState): string | null {
  const linked = state.linkedPurchaseToken;
  const expired = state.outOfAppPurchaseContext?.expiredPurchaseToken ?? null;
  if (linked !== null && expired !== null && linked !== expired) {
    throw new GoogleBillingError("GOOGLE_LINEAGE_INVALID", false, null,
      "Google purchase names conflicting predecessors. Contact support to reconcile this purchase.");
  }
  return linked ?? expired;
}

async function mappedGoogleOwner(executor: DatabaseExecutor, state: GooglePurchaseState): Promise<string | null> {
  const accountId = state.obfuscatedExternalAccountId
    ?? state.outOfAppPurchaseContext?.expiredObfuscatedExternalAccountId ?? null;
  if (accountId === null) return null;
  // A merged guest can retain its handle when the destination already has a different one.
  const result = await executor.query<{ user_id: string }>(`
    SELECT COALESCE(upgrade.target_user_id, state.user_id) AS user_id
    FROM billing.user_billing_state AS state
    LEFT JOIN LATERAL (SELECT target_user_id FROM auth.guest_upgrade_history
      WHERE source_guest_user_id = state.user_id ORDER BY merged_at DESC LIMIT 1) AS upgrade ON true
    WHERE state.google_obfuscated_account_id = $1`, [accountId]);
  return result.rows[0]?.user_id ?? null;
}

export async function lockGooglePurchaseTokens(
  executor: DatabaseExecutor, lineage: ReadonlyArray<GooglePurchaseLink>, environment: GoogleEnvironment,
): Promise<void> {
  for (const token of lineage.map((link) => link.purchaseToken).sort()) {
    await executor.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`google:${environment}:${token}`]);
  }
}

export async function lockGooglePurchaseOwners(
  executor: DatabaseExecutor, state: GooglePurchaseState, lineage: ReadonlyArray<GooglePurchaseLink>,
  presentingUserId: string | null,
): Promise<LockedGooglePurchase> {
  const observed: Array<StoredGooglePurchase | null> = [];
  for (const link of lineage) {
    const row = await readGooglePurchase(executor, link.purchaseToken, state.environment);
    if (row?.linked_from_purchase_id != null && row.linked_from_purchase_id !== link.predecessorToken) {
      throw new GoogleBillingError("GOOGLE_LINEAGE_CHANGED", true, null,
        "Google purchase lineage changed during verification. Retry the same purchase.");
    }
    observed.push(row);
  }
  const mappedOwner = await mappedGoogleOwner(executor, state);
  const userIds = [...new Set([...observed.map((row) => row?.user_id ?? null), presentingUserId, mappedOwner]
    .filter((id): id is string => id !== null))].sort((left, right) => left.localeCompare(right));
  const accounts: Array<GoogleAccount> = [];
  // Account deletion and guest upgrade lock profiles before any billing rows.
  for (const userId of userIds) {
    const account = await lockGoogleAccount(executor, userId);
    if (account !== null) accounts.push(account);
    else if (userId === presentingUserId) {
      throw new GoogleBillingError("GOOGLE_ACCOUNT_RETIRED", false, null,
        "The purchasing account no longer exists. Authenticate again.");
    }
  }
  await executor.query(`SELECT purchase_id FROM billing.purchases
    WHERE provider = 'google' AND environment = $1 AND provider_purchase_id = ANY($2::text[])
    ORDER BY provider_purchase_id FOR UPDATE`, [state.environment, lineage.map((link) => link.purchaseToken)]);
  const rows: Array<StoredGooglePurchase | null> = [];
  for (let index = 0; index < lineage.length; index += 1) {
    const row = await readGooglePurchase(executor, lineage[index].purchaseToken, state.environment);
    if (row?.user_id !== observed[index]?.user_id) {
      throw new GoogleBillingError("GOOGLE_OWNER_CHANGED", true, null,
        "Purchase ownership changed during account upgrade or deletion. Retry the same purchase.");
    }
    rows.push(row);
  }
  if (mappedOwner !== await mappedGoogleOwner(executor, state)) {
    throw new GoogleBillingError("GOOGLE_OWNER_CHANGED", true, null,
      "Purchase attribution changed during account upgrade or deletion. Retry the same purchase.");
  }
  const previous = rows[0];
  const ancestors = rows.slice(1);
  const live = (userId: string | null): boolean => accounts.some((account) => account.userId === userId);
  const predecessor = ancestors.find((row) => row !== null
    && (row.account_deleted_at !== null || live(row.user_id)));
  // Erased ownership stops passive inheritance from older owners and the original store mapping.
  const inheritedOwner = predecessor?.account_deleted_at != null ? null
    : predecessor?.user_id ?? (live(mappedOwner) ? mappedOwner : null);
  // Attached purchases, including erased ownership, are never reclaimed by passive attribution.
  const ownerUserId = presentingUserId ?? previous?.user_id
    ?? inheritedOwner;
  return { previous, ancestors, accounts, ownerUserId };
}

async function invalidateGoogleAncestors(
  executor: DatabaseExecutor, state: GooglePurchaseState, lineage: ReadonlyArray<GooglePurchaseLink>,
): Promise<void> {
  for (const link of lineage.slice(1)) {
    const ancestor = link.state;
    // A predecessor beyond Play's lookup window still needs a durable invalidation marker.
    await executor.query(`INSERT INTO billing.purchases
        (provider, provider_purchase_id, environment, kind, tier, status, is_trial, will_renew,
         until, grace_until, provider_status_raw, linked_from_purchase_id, invalidated_at)
        VALUES ('google', $1, $2, 'subscription', 'premium', $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (provider, provider_purchase_id, environment) DO NOTHING`,
    [link.purchaseToken, state.environment, ancestor?.status ?? "expired", ancestor?.isTrial ?? false,
      ancestor?.willRenew ?? false, ancestor?.until ?? null, ancestor?.graceUntil ?? null,
      ancestor?.providerStatus ?? null, link.predecessorToken, state.verifiedAt]);
    await executor.query(`UPDATE billing.purchases SET invalidated_at = COALESCE(invalidated_at, $3), updated_at = now()
      WHERE provider = 'google' AND provider_purchase_id = $1 AND environment = $2`,
    [link.purchaseToken, state.environment, state.verifiedAt]);
  }
}

export async function persistGooglePurchase(
  executor: DatabaseExecutor, state: GooglePurchaseState, lineage: ReadonlyArray<GooglePurchaseLink>,
  locked: LockedGooglePurchase, presentingUserId: string | null,
): Promise<StoredGooglePurchase> {
  if (state.completed) await invalidateGoogleAncestors(executor, state, lineage);
  const result = await executor.query<StoredGooglePurchase>(`
    INSERT INTO billing.purchases
      (provider, provider_purchase_id, environment, kind, tier, user_id, status, is_trial,
       will_renew, until, grace_until, provider_status_raw, linked_from_purchase_id)
    VALUES ('google', $1, $2, 'subscription', 'premium', $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (provider, provider_purchase_id, environment) DO UPDATE SET
      previous_user_id = CASE WHEN billing.purchases.user_id IS DISTINCT FROM EXCLUDED.user_id
        THEN billing.purchases.user_id ELSE billing.purchases.previous_user_id END,
      user_id = EXCLUDED.user_id,
      status = CASE WHEN billing.purchases.status = 'revoked' THEN 'revoked' ELSE EXCLUDED.status END,
      is_trial = EXCLUDED.is_trial, will_renew = EXCLUDED.will_renew,
      until = EXCLUDED.until, grace_until = EXCLUDED.grace_until,
      provider_status_raw = EXCLUDED.provider_status_raw,
      linked_from_purchase_id = EXCLUDED.linked_from_purchase_id,
      account_deleted_at = CASE WHEN $11::text IS NOT NULL THEN NULL ELSE billing.purchases.account_deleted_at END,
      updated_at = now()
    RETURNING ${purchaseColumns}`,
  [state.purchaseToken, state.environment, locked.ownerUserId, state.status, state.isTrial, state.willRenew,
    state.until, state.graceUntil, state.providerStatus, lineage[0].predecessorToken, presentingUserId]);
  const purchase = result.rows[0];
  if (state.completed && purchase.invalidated_at === null && purchase.status !== "revoked"
    && purchase.account_deleted_at === null && locked.accounts.some((account) => account.userId === purchase.user_id)) {
    await executor.query(`INSERT INTO billing.user_billing_state
      (user_id, trial_consumed_at, trial_provider, ever_purchased_at)
      VALUES ($1, $2, CASE WHEN $2::timestamptz IS NULL THEN NULL ELSE 'google' END, $3)
      ON CONFLICT (user_id) DO UPDATE SET
        trial_provider = CASE WHEN EXCLUDED.trial_consumed_at < billing.user_billing_state.trial_consumed_at
          OR billing.user_billing_state.trial_consumed_at IS NULL THEN EXCLUDED.trial_provider
          ELSE billing.user_billing_state.trial_provider END,
        trial_consumed_at = LEAST(billing.user_billing_state.trial_consumed_at, EXCLUDED.trial_consumed_at),
        ever_purchased_at = LEAST(billing.user_billing_state.ever_purchased_at, EXCLUDED.ever_purchased_at),
        updated_at = now()`,
    [purchase.user_id, state.isTrial ? state.startedAt ?? state.verifiedAt : null, state.paid ? state.verifiedAt : null]);
  }
  return purchase;
}
