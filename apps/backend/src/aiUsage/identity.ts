import type { DatabaseExecutor } from "../database";

/**
 * The two statements that rewrite which person and which workspace an `ai.usage_events` row belongs to.
 * Together with the append in `record.ts` they are the only writers of that table.
 *
 * Both are the callers `db/migrations/0154_ai_usage_identity_rewrites.sql` grants
 * `UPDATE (user_id, workspace_id, request_id)` for, and names: the three columns that name somebody, and
 * no counter. The counters stay immutable and no row can be removed, because neither privilege was
 * granted back, so nothing here can be extended into a statement
 * that changes what a provider call consumed. No database scope is applied: the policies on this table
 * are unscoped and the privilege boundary is the grant, as on the billing tables (`../billing/store.ts`).
 */

/**
 * Collapses one deleted person's usage history onto the pseudonym their analytics history is collapsed
 * to, in the same transaction as that rewrite.
 *
 * The rows are kept rather than deleted because what one AI call cost is a fact about the product, not
 * about the person: a cost report over last month has to keep answering after somebody leaves. Every
 * other column that could name the person again goes with the id, which is the same test
 * `anonymizeProductAnalyticsInExecutor` applies to `analytics.product_events` in this transaction.
 * `workspace_id` goes because the workspace outlives the row - these columns carry no foreign key - and a
 * surviving workspace id rejoins this history to the content and analytics of the very person the
 * pseudonym exists to hide. `request_id` goes because correlating a row with backend logs and error
 * reports is its whole documented purpose, and those still name the real user id for as long as they are
 * retained, so leaving it would bridge the pseudonym straight back to a log line or a Sentry event.
 *
 * `personUserIds` is every id the person ever produced rows under, guest phase included, so one call
 * covers a history that was written under several ids.
 */
export async function anonymizeAiUsageForDeletedPersonInExecutor(
  executor: DatabaseExecutor,
  personUserIds: ReadonlyArray<string>,
  anonymizedUserId: string,
): Promise<void> {
  await executor.query(
    [
      "UPDATE ai.usage_events SET",
      "user_id = $1,",
      "workspace_id = NULL,",
      "request_id = NULL",
      "WHERE user_id = ANY($2::text[])",
    ].join(" "),
    [anonymizedUserId, personUserIds],
  );
}

/**
 * Moves a guest's usage history to the account they upgraded into.
 *
 * Carrying it across is the point rather than tidiness: the monthly allowance is a sum over these rows
 * for one person (`cap.ts`), so rows left behind would hand somebody a fresh allowance for signing up.
 * The workspace id moves with them where it named the guest workspace, which the upgrade deletes
 * afterwards, so per-workspace spend stays attributable to the workspace the content ended up in - the
 * same rewrite `support.transfer_guest_feedback` performs on its own rows
 * (`db/migrations/0053_feedback_guest_upgrade_transfer.sql`).
 *
 * `request_id` is deliberately left alone, which is the one place these two statements differ. The guest
 * and the account they upgraded into are one person, so correlating the row with the logs of the call
 * that produced it stays legitimate; the erasure nulls it because there the person is gone and the
 * correlation is the leak. Do not align the two statements by nulling it here.
 *
 * There is no key to collide on. A row is keyed by `usage_event_id` and its counters are untouched, so
 * this is an `UPDATE` of two non-unique columns and one row per provider call still means one row; the
 * per-month collision a merged quota would face belonged to `auth.guest_ai_monthly_usage`, whose
 * primary key was `(user_id, usage_month)`; that table was dropped by
 * `db/migrations/0157_drop_guest_ai_monthly_usage.sql` and its rows were not carried over.
 */
export async function transferAiUsageToUpgradedAccountInExecutor(
  executor: DatabaseExecutor,
  guestUserId: string,
  guestWorkspaceId: string,
  targetUserId: string,
  targetWorkspaceId: string,
): Promise<void> {
  await executor.query(
    [
      "UPDATE ai.usage_events SET",
      "user_id = $3,",
      "workspace_id = CASE WHEN workspace_id = $2::uuid THEN $4::uuid ELSE workspace_id END",
      "WHERE user_id = $1",
    ].join(" "),
    [guestUserId, guestWorkspaceId, targetUserId, targetWorkspaceId],
  );
}
