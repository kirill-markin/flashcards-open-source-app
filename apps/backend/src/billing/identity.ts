import type { DatabaseExecutor } from "../database";

/**
 * The statements that rewrite which person a billing row belongs to: one for account deletion, one for
 * a guest upgrade. Nothing here decides anything about entitlement, and nothing here is derived.
 *
 * Four of the five tables carry no `DELETE` for this role by design, because their rows are stamped
 * rather than removed (`db/migrations/0151_billing_schema.sql`), so erasure is an `UPDATE` throughout.
 * `billing.entitlement_snapshots` is the exception in both directions: it is the one table with `DELETE`,
 * and it is a cache, so neither flow carries a row of it anywhere. Dropping the retired person's row is
 * enough - the next resolution recomputes the destination's from the purchases and grants that just
 * moved, behind its own row lock (`snapshot.ts`), which is also why nothing here has to invalidate that
 * row or emit an entitlement fact.
 *
 * No database scope is applied, for the reason `store.ts` gives: these rows are keyed by person but their
 * row-level security policies are unrestricted, because the rest of the billing layer is written by
 * provider callbacks, reconciliation and operator actions that run outside any request.
 */

type BillingStateRow = Readonly<{
  trial_consumed_at: Date | null;
  trial_provider: string | null;
  ever_purchased_at: Date | null;
  stripe_customer_id: string | null;
  apple_app_account_token: string | null;
  google_obfuscated_account_id: string | null;
}>;

/** A consumed trial and the provider that granted it, which move together or not at all. */
type ConsumedTrial = Readonly<{
  consumedAt: Date | null;
  provider: string | null;
}>;

/**
 * Where one provider handle ends up: on the destination account, on the retired guest row, or nowhere.
 */
type HandleTransfer = Readonly<{
  heldByTarget: string | null;
  retainedByGuest: string | null;
}>;

/** What the destination account's row holds once the guest's facts have been folded into it. */
type MergedBillingState = Readonly<{
  trial: ConsumedTrial;
  everPurchasedAt: Date | null;
  stripeCustomerId: HandleTransfer;
  appleAppAccountToken: HandleTransfer;
  googleObfuscatedAccountId: HandleTransfer;
}>;

const billingStateColumns = [
  "trial_consumed_at, trial_provider, ever_purchased_at, stripe_customer_id,",
  "apple_app_account_token::text AS apple_app_account_token, google_obfuscated_account_id",
].join(" ");

function toIsoStringOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function earliestTimestamp(left: Date | null, right: Date | null): Date | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }

  return left.getTime() <= right.getTime() ? left : right;
}

/**
 * The trial the merged person has consumed: the earlier of the two, with the provider that granted that
 * one. Picked as a pair rather than column by column because `user_billing_state_trial_shape` requires
 * both to be set or neither, and because naming the provider of a different trial than the one recorded
 * makes the row unreconcilable against the store that granted it.
 */
function mergeConsumedTrial(guest: BillingStateRow, target: BillingStateRow): ConsumedTrial {
  const guestTrial: ConsumedTrial = {
    consumedAt: guest.trial_consumed_at,
    provider: guest.trial_provider,
  };
  const targetTrial: ConsumedTrial = {
    consumedAt: target.trial_consumed_at,
    provider: target.trial_provider,
  };
  if (target.trial_consumed_at === null) {
    return guestTrial;
  }
  if (guest.trial_consumed_at === null) {
    return targetTrial;
  }

  return guest.trial_consumed_at.getTime() < target.trial_consumed_at.getTime()
    ? guestTrial
    : targetTrial;
}

/**
 * A provider handle moves into a NULL and never over a value.
 *
 * Each of the three is uniquely indexed (`db/migrations/0151_billing_schema.sql`), so two rows can never
 * hold one handle, and the retired row is not deletable - which is why the move is two statements below,
 * clearing the guest row before writing the destination one. Overwriting a handle the destination already
 * holds would be worse than leaving the guest's behind: the handle is what a provider notification is
 * attributed by, so the dropped one makes that provider's notifications unattributable, while a handle
 * left on a retired row still resolves the purchases it paid for.
 */
function resolveHandleTransfer(guestHandle: string | null, targetHandle: string | null): HandleTransfer {
  if (targetHandle !== null) {
    return { heldByTarget: targetHandle, retainedByGuest: guestHandle };
  }

  return { heldByTarget: guestHandle, retainedByGuest: null };
}

function mergeBillingState(guest: BillingStateRow, target: BillingStateRow): MergedBillingState {
  return {
    trial: mergeConsumedTrial(guest, target),
    // Earliest rather than the destination's, because this is one person: the fact is when they first
    // paid for anything, and the column is never recomputed from the purchases that just moved.
    everPurchasedAt: earliestTimestamp(guest.ever_purchased_at, target.ever_purchased_at),
    stripeCustomerId: resolveHandleTransfer(guest.stripe_customer_id, target.stripe_customer_id),
    appleAppAccountToken: resolveHandleTransfer(
      guest.apple_app_account_token,
      target.apple_app_account_token,
    ),
    googleObfuscatedAccountId: resolveHandleTransfer(
      guest.google_obfuscated_account_id,
      target.google_obfuscated_account_id,
    ),
  };
}

const emptyBillingStateRow: BillingStateRow = {
  trial_consumed_at: null,
  trial_provider: null,
  ever_purchased_at: null,
  stripe_customer_id: null,
  apple_app_account_token: null,
  google_obfuscated_account_id: null,
};

async function lockBillingStateInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<BillingStateRow | null> {
  const result = await executor.query<BillingStateRow>(
    [
      "SELECT",
      billingStateColumns,
      "FROM billing.user_billing_state",
      "WHERE user_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Clears from the retired guest row exactly the handles that are moving, and nothing else.
 *
 * It runs before the destination row is written, which is the whole reason it is its own statement: the
 * partial unique indexes are checked per statement and cannot be deferred, so writing the handle on the
 * destination while the guest row still held it would fail with `23505`.
 *
 * `trial_consumed_at` and `ever_purchased_at` stay on this row. They are copies rather than a move: the
 * column comments make them facts that are never cleared, and the row outlives the guest identity by
 * design.
 */
async function retireGuestBillingHandlesInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  merged: MergedBillingState,
): Promise<void> {
  await executor.query(
    [
      "UPDATE billing.user_billing_state SET",
      "stripe_customer_id = $2,",
      "apple_app_account_token = $3::uuid,",
      "google_obfuscated_account_id = $4,",
      "updated_at = now()",
      "WHERE user_id = $1",
    ].join(" "),
    [
      guestUserId,
      merged.stripeCustomerId.retainedByGuest,
      merged.appleAppAccountToken.retainedByGuest,
      merged.googleObfuscatedAccountId.retainedByGuest,
    ],
  );
}

/**
 * Writes the merged facts onto the destination account, inserting the row when that account has none.
 *
 * The conflict target is the `user_id` primary key. None of the three partial unique indexes on this
 * table can arbitrate an upsert unless the statement repeats its predicate, and none of them is what this
 * write collides on anyway.
 */
async function upsertMergedBillingStateInExecutor(
  executor: DatabaseExecutor,
  targetUserId: string,
  merged: MergedBillingState,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO billing.user_billing_state (",
      "user_id, trial_consumed_at, trial_provider, ever_purchased_at,",
      "stripe_customer_id, apple_app_account_token, google_obfuscated_account_id",
      ") VALUES ($1, $2, $3, $4, $5, $6::uuid, $7)",
      "ON CONFLICT (user_id) DO UPDATE SET",
      "trial_consumed_at = EXCLUDED.trial_consumed_at,",
      "trial_provider = EXCLUDED.trial_provider,",
      "ever_purchased_at = EXCLUDED.ever_purchased_at,",
      "stripe_customer_id = EXCLUDED.stripe_customer_id,",
      "apple_app_account_token = EXCLUDED.apple_app_account_token,",
      "google_obfuscated_account_id = EXCLUDED.google_obfuscated_account_id,",
      "updated_at = now()",
    ].join(" "),
    [
      targetUserId,
      toIsoStringOrNull(merged.trial.consumedAt),
      merged.trial.provider,
      toIsoStringOrNull(merged.everPurchasedAt),
      merged.stripeCustomerId.heldByTarget,
      merged.appleAppAccountToken.heldByTarget,
      merged.googleObfuscatedAccountId.heldByTarget,
    ],
  );
}

/**
 * Moves one guest's billing rows to the account they upgraded into.
 *
 * Both sides may already hold an active purchase, and both rows survive: two active purchases on one
 * person is a supported state and the resolver decides which one wins, so nothing here refunds, cancels
 * or refuses the merge.
 *
 * `billing.provider_events` deliberately does not move. Its rows are the audit trail of what a provider
 * said and to whom it referred at the time, and rewriting that would make the trail describe a
 * notification nobody received; the purchase the event names is what connects it to the destination from
 * here on, and a later erasure reaches it through exactly that.
 *
 * Runs before the guest's `org.user_settings` row is deleted. Ordering is not a style question: after the
 * cleanup step there is no guest identity left to move rows away from, and every statement here would
 * match nothing while still returning successfully.
 */
export async function transferBillingToUpgradedAccountInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  targetUserId: string,
): Promise<void> {
  await executor.query(
    [
      "UPDATE billing.purchases SET",
      "user_id = $2,",
      "previous_user_id = $1",
      "WHERE user_id = $1",
    ].join(" "),
    [guestUserId, targetUserId],
  );
  await executor.query(
    "UPDATE billing.grants SET user_id = $2 WHERE user_id = $1",
    [guestUserId, targetUserId],
  );

  const guestBillingState = await lockBillingStateInExecutor(executor, guestUserId);
  if (guestBillingState !== null) {
    const targetBillingState = await lockBillingStateInExecutor(executor, targetUserId);
    const merged = mergeBillingState(guestBillingState, targetBillingState ?? emptyBillingStateRow);
    await retireGuestBillingHandlesInExecutor(executor, guestUserId, merged);
    await upsertMergedBillingStateInExecutor(executor, targetUserId, merged);
  }

  await executor.query(
    "DELETE FROM billing.entitlement_snapshots WHERE user_id = $1",
    [guestUserId],
  );
}

/**
 * Rewrites one deleted person's billing history onto the pseudonym their analytics history is collapsed
 * to, in the same transaction as that rewrite.
 *
 * The rows outlive the account on purpose: the purchase still exists on the provider, can still renew, be
 * refunded or be transferred, and none of that could be handled from a row that was deleted - which is
 * also why every table here except the snapshot cache carries no `DELETE` for this role. What erasure can
 * do is stop them naming a person, and that is what this does.
 *
 * Provider identifiers stay throughout, the stored handles included. They are retained on accounting and
 * claim-defence grounds, and they are re-identifiable only by the provider that already holds them.
 *
 * `personUserIds` is every id the person ever produced rows under, guest phase included.
 */
export async function anonymizeBillingForDeletedPersonInExecutor(
  executor: DatabaseExecutor,
  personUserIds: ReadonlyArray<string>,
  anonymizedUserId: string,
): Promise<void> {
  // First, and while billing.purchases still carries the real ids the second half of this predicate
  // reads. An event usually names no person at all - most providers identify the purchase and not the
  // buyer - so the person's events are reached through their purchases as well as through user_id.
  //
  // Only an event that actually names one of this person's ids is renamed, which is why user_id is a CASE
  // and not a plain assignment: a matched event can carry a third party's id or none at all, and writing
  // the pseudonym there would both misattribute their notification and erase their own attribution.
  //
  // Both payload columns go. payload_raw exists to verify a signature at ingestion and has no use after
  // that, and the decoded payload is the provider's own copy of who bought what. Neither can be reduced
  // to the personal fields inside it, because the shape belongs to the provider. What survives is the
  // accounting trail: which provider sent what kind of notification, when, about which purchase, and
  // whether it was processed. payload_raw is NOT NULL, so it is emptied rather than nulled.
  //
  // The reach is current ownership, and nothing finer is available: an event is attributable to a
  // purchase rather than to a person, and no column records when a transfer happened, so the two sides of
  // one cannot be told apart. That cuts both ways and is one rule, not two. A purchase this person
  // transferred away is not followed, so a renewal notification that arrived afterwards keeps the new
  // holder's details, because erasing a third party's data from their own live audit trail is not
  // something this person's request may do. A purchase transferred in is followed in full, so events
  // produced while somebody else held it are cleared too and their user_id is left alone - the row is
  // this person's now, and the alternative would leave their own payloads behind. Where the rule cannot
  // reach at all is an event that never decoded, which docs/premium-entitlements.md states as a
  // requirement on the store rails rather than leaving to be discovered.
  await executor.query(
    [
      "UPDATE billing.provider_events SET",
      "user_id = CASE WHEN user_id = ANY($2::text[]) THEN $1 ELSE user_id END,",
      "payload = NULL,",
      "payload_raw = ''",
      "WHERE user_id = ANY($2::text[])",
      "OR (provider, provider_purchase_id, environment) IN (",
      "SELECT purchases.provider, purchases.provider_purchase_id, purchases.environment",
      "FROM billing.purchases AS purchases",
      "WHERE purchases.user_id = ANY($2::text[])",
      ")",
    ].join(" "),
    [anonymizedUserId, personUserIds],
  );
  // previous_user_id is rewritten wherever it names this person, including on a purchase that has since
  // been transferred to somebody else and is therefore not theirs any more. Leaving it would keep their
  // real id on a live row, and on their own rows it would sit beside the pseudonym in user_id and make it
  // trivially re-identifiable, which is the one property the rewrite exists to have.
  //
  // account_deleted_at is stamped only where the purchase is still theirs. Stamping it on a transferred
  // purchase would invalidate it for the person who now holds it: the resolver ignores a purchase that
  // carries it. It is also not overwritten, because the first deletion is when the account went.
  await executor.query(
    [
      "UPDATE billing.purchases SET",
      "user_id = CASE WHEN user_id = ANY($2::text[]) THEN $1 ELSE user_id END,",
      "previous_user_id = CASE WHEN previous_user_id = ANY($2::text[]) THEN $1 ELSE previous_user_id END,",
      "account_deleted_at = CASE",
      "WHEN user_id = ANY($2::text[]) THEN COALESCE(account_deleted_at, now())",
      "ELSE account_deleted_at",
      "END",
      "WHERE user_id = ANY($2::text[])",
      "OR previous_user_id = ANY($2::text[])",
    ].join(" "),
    [anonymizedUserId, personUserIds],
  );
  await executor.query(
    "UPDATE billing.grants SET user_id = $1 WHERE user_id = ANY($2::text[])",
    [anonymizedUserId, personUserIds],
  );
  // user_id is this table's primary key, so the person's rows cannot all become one value. A person holds
  // several rows after a guest upgrade that had any guest billing state to merge: the upsert writes the
  // destination's row and the guest's is not deletable, so one row becomes two whether or not the
  // destination already had one. The oldest takes the shared pseudonym and the rest take a fresh id
  // each. That is one degree more private than the rest of this erasure, not less: those rows
  // stop naming the person and stop being rejoinable with the history under the pseudonym, and what they
  // still hold - a consumed trial, a first purchase, provider handles - is why they may not be dropped.
  await executor.query(
    [
      "WITH person_billing_state AS (",
      "SELECT user_id, row_number() OVER (ORDER BY created_at, user_id) AS person_rank",
      "FROM billing.user_billing_state",
      "WHERE user_id = ANY($2::text[])",
      ")",
      "UPDATE billing.user_billing_state AS state SET",
      "user_id = CASE",
      "WHEN person_billing_state.person_rank = 1 THEN $1",
      "ELSE gen_random_uuid()::text",
      "END,",
      "updated_at = now()",
      "FROM person_billing_state",
      "WHERE state.user_id = person_billing_state.user_id",
    ].join(" "),
    [anonymizedUserId, personUserIds],
  );
  // Deleted rather than rewritten, unlike everything above it. This row is a cache of a resolution, it is
  // reproducible from the rows above whenever anybody asks, and nothing may count from it - so a copy of
  // it filed under a pseudonym is a row that no rebuild would ever produce again and that no reader wants.
  await executor.query(
    "DELETE FROM billing.entitlement_snapshots WHERE user_id = ANY($1::text[])",
    [personUserIds],
  );
}
