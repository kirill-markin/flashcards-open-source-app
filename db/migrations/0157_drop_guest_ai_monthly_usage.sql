-- Migration status: Current / contract cleanup.
-- Removes: auth.guest_ai_monthly_usage, the guest AI quota table added by
--   db/migrations/0031_guest_ai_identity_and_quota.sql, and the reporting_readonly column grant
--   db/migrations/0066_reporting_readonly_operational_analytics.sql put on it.
-- Current guidance: the replacement is ai.usage_events from db/migrations/0152_ai_usage_facts.sql,
--   summed per UTC calendar month by apps/backend/src/aiUsage/. 0152's own See also block names
--   apps/backend/src/guestAiQuota/index.ts, the module that read this table, and the metering cutover
--   deleted that module; an applied migration's comments are immutable, so the replacement is named
--   here instead. apps/backend/src/aiUsage/cap.ts owns the monthly window and the allowance -
--   getAiUsageMonthWindow is now the only home in code of the UTC month rule this table's usage_month
--   column used to carry - and apps/backend/src/aiUsage/record.ts writes the facts that sum is taken
--   over.
-- Current guidance: no deployed code reads or writes this table, which is what this migration waited
--   for rather than assumed. When it was written, on 2026-09-24, the last write here was 2026-09-22,
--   two days before the metering cutover reached production, and ai.usage_events was already receiving
--   real rows from chat and composer suggestions. This is the contract half of an expand-and-contract
--   split and is deliberately a separate deploy. What orders the two halves in production is the
--   migration gate: migrationRunner in infra/aws/lib/migration-runner.ts is a Lambda that applies each
--   pending file through applyPendingMigrations in apps/backend/src/database/migrationRunner.ts,
--   databaseMigrationGate in the same infra file invokes it as a CDK custom resource requiring the
--   newest bundled migration, and addDatabaseMigrationDependency makes the backend function depend on
--   that gate, so the new code cannot serve a request until this file has applied. What reaches the
--   gate, and therefore what applies this migration, is the npx cdk deploy --all step of
--   .github/workflows/aws-web-release.yml. No deploy script applies it. scripts/deploy/migrate-aws.sh
--   is post-deploy verification: it runs after that step as Verify required database migration with
--   --require-latest-migration and invokes the Lambda with an empty payload, which
--   parseMigrationInvocation (apps/backend/src/entrypoints/migrate-lambda.ts) classifies as a direct
--   invocation that never touches the custom resource, so by then nothing is pending and the run
--   asserts that the newest file is installed rather than installing it. scripts/deploy/migrate.sh
--   applies the same files locally only. Dropping this table in the cutover's own release would
--   therefore have left the previous deploy's quota reading a table that was already gone.
-- Current guidance: the DROP below takes ACCESS EXCLUSIVE on org.user_settings as well as on the table
--   it removes, which is why the lock_timeout below is not optional. This table is the child end of a
--   foreign key into org.user_settings, so dropping it drops that constraint, and dropping the
--   constraint removes the ON DELETE CASCADE action trigger the constraint placed on the parent.
--   org.user_settings carries the profile traffic of the authenticated surface, and that traffic both
--   writes and locks: ensureUserProfileInExecutor (apps/backend/src/auth/ensureUser.ts) upserts the
--   row and then takes SELECT ... FOR UPDATE on it. It runs for every request resolved through the
--   request-context choke point, loadRequestContextWithDependencies in
--   apps/backend/src/server/requestContext.ts - that choke point is the scope of the claim, not every
--   transport, because the live chat stream skips the profile for api_key and queries
--   org.user_settings not at all (apps/backend/src/chat/live/request.ts). Guest upgrade and account
--   deletion take FOR UPDATE on the same rows (apps/backend/src/guestAuth/store/workspace.ts,
--   apps/backend/src/auth/accountDeletion.ts). Without a cap this drop waits behind any in-flight
--   transaction holding a lock there while every new request through that choke point queues behind
--   the pending lock request, bounded only by the migration Lambda's five-minute timeout and ending in
--   a failed release, inside the gate the backend function depends on. The runner wraps each file in a
--   bare BEGIN/COMMIT and sets no lock_timeout of its own, so the SET LOCAL below is the only bound,
--   exactly as in db/migrations/0133_drop_cards_search_trgm_index.sql and
--   db/migrations/0155_ai_chat_item_content_metrics.sql. It is not one shared budget: lock_timeout
--   applies per lock acquisition, so the DROP may wait up to 30s for the table and another 30s for
--   org.user_settings, roughly 60s worst case for this file, still far inside those five minutes. Past
--   any single one of those waits the statement fails 55P03, the release fails, and a rerun retries the
--   file. None of it caps how long traffic queues once a lock is held, which costs little here: both
--   statements below are catalog-only, rewriting no heap data, so they hold their locks for the
--   remainder of one short transaction rather than for a rewrite.
-- Current guidance: the pre-cutover guest consumption recorded here is intentionally not carried over.
--   Twenty rows across five months, 206,090 weighted tokens in total, are dropped as they are: nothing
--   is copied into ai.usage_events and no synthetic row stands in for them, so a usage or cost report
--   spanning the cutover shows AI consumption starting where the facts start. That is a decision rather
--   than an oversight. A row here is one weights-applied total per user-month with no surface, model or
--   provider beside it, so moved into a per-call fact table it could be neither re-priced nor
--   attributed, and would only look like a measurement it never was.
-- Current guidance: 0066 still carries a GRANT naming this table, and
--   apps/backend/src/database/reportingReadonlyOperationalAnalytics.test.ts still asserts that text.
--   Neither is a leftover and neither should be edited to match this drop: an applied migration records
--   what it did when it ran, and the table existed then.
-- Current guidance: DROP TABLE removes every privilege on the table by itself, so the REVOKE below is
--   not what takes the access away. It is written out because the reporting_readonly grants are an
--   inventory maintained across migrations and audited from the SQL, so the removal of a column list
--   should be as findable as the grant was. backend_app's grant from 0031 needs no such entry, which is
--   why the asymmetry is deliberate.
-- Current guidance: the DROP is deliberately neither IF EXISTS nor CASCADE. Nothing references this
--   table - the foreign key above is its own, into org.user_settings - so a RESTRICT drop that fails
--   means that assumption stopped holding and is a signal rather than something to force through.
-- Schemas touched/read explicitly: auth, org.
-- See also: db/migrations/0031_guest_ai_identity_and_quota.sql,
--   db/migrations/0066_reporting_readonly_operational_analytics.sql,
--   db/migrations/0152_ai_usage_facts.sql, apps/backend/src/aiUsage/cap.ts.

SET LOCAL lock_timeout = '30s';

REVOKE SELECT (
  user_id,
  usage_month,
  weighted_tokens,
  updated_at
) ON TABLE auth.guest_ai_monthly_usage FROM reporting_readonly;

DROP TABLE auth.guest_ai_monthly_usage;
