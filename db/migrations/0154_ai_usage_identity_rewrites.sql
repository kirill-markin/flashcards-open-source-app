-- Migration status: Current / additive.
-- Introduces: the narrow UPDATE privilege and the matching row level security policy that let the two
--   identity lifecycle flows rewrite who an ai.usage_events row belongs to. No table, column,
--   constraint or index changes here: this migration is a grant and a policy.
-- Current guidance: db/migrations/0152_ai_usage_facts.sql revoked UPDATE and DELETE on
--   ai.usage_events and gave backend_app SELECT and INSERT policies only, so the table is append-only
--   for every writer. That stays true for the counters, which are the facts: no statement anywhere may
--   change what a provider call consumed, and DELETE stays revoked, so no row may be removed either.
--   What this migration opens is who a row names, and only that: UPDATE is granted on user_id,
--   workspace_id and request_id alone, so a statement that reaches for a counter column is refused by
--   the grant rather than by review. request_id is in the list because it is an identifier of the same
--   kind as the other two rather than a counter: its documented purpose is correlating a row with
--   backend logs and error reports, so a surviving one bridges a pseudonymised row to a log line or a
--   Sentry event that still names the real user_id for as long as those are retained. The erasure nulls
--   it for exactly the reason anonymizeProductAnalyticsInExecutor already nulls
--   analytics.product_events.request_id in the same transaction.
-- Current guidance: two callers, both named, and no third may use this privilege without appearing
--   here, which is the shape db/migrations/0140_analytics_excluded_actors.sql uses for its own narrow
--   grant. Account deletion anonymises the person's rows rather than cascading them away, which
--   0152's table comment already promises and nothing performed until now:
--   anonymizeAiUsageForDeletedPersonInExecutor (apps/backend/src/aiUsage/identity.ts) rewrites user_id
--   to the same one-way pseudonym anonymizeProductAnalyticsInExecutor
--   (apps/backend/src/auth/accountDeletion.ts) writes over that person's analytics history, in the same
--   transaction, and nulls workspace_id and request_id because both outlive what they point at and
--   both rejoin the row to the person the pseudonym exists to hide.
--   A guest upgrade transfers them: transferAiUsageToUpgradedAccountInExecutor in the same module moves
--   the guest's rows to the destination account, because leaving them behind would hand a person a
--   fresh monthly AI allowance for signing up, and moves the guest workspace id to the destination
--   workspace so per-workspace cost stays attributable after the guest workspace is deleted.
-- Current guidance: 0152's table comment closes with "nothing may rewrite or remove a row here", which
--   this grant makes untrue of the three identity columns. An applied migration is immutable, so that
--   sentence is corrected in db/migrations/README.md rather than re-commented here.
-- Schemas touched/read explicitly: ai.
-- See also: db/migrations/0152_ai_usage_facts.sql, db/migrations/0140_analytics_excluded_actors.sql,
--   db/migrations/0053_feedback_guest_upgrade_transfer.sql, db/migrations/0151_billing_schema.sql.

GRANT UPDATE (user_id, workspace_id, request_id) ON TABLE ai.usage_events TO backend_app;

-- The grant alone would still be refused. ai.usage_events has row level security enabled and is owned
-- by the migration role, so backend_app is subject to it, and 0152 created a policy per granted
-- command: with no UPDATE policy the rewrites above match no row and change nothing, silently. USING
-- picks the rows the statement may see, WITH CHECK the rows it may leave behind; both are unscoped for
-- the reason 0152 gives for its own policies, that the privilege boundary here is the grant.
CREATE POLICY usage_events_backend_update
  ON ai.usage_events
  FOR UPDATE
  TO backend_app
  USING (true)
  WITH CHECK (true);
