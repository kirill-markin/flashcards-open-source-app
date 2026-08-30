-- Migration status: Current / one-time backfill.
-- Introduces: the platform on the live analytics.product_events rows of event_name 'review_answered'
--   that the server-derived producer left NULL - the rows it wrote before it learned to resolve one,
--   and the rows whose best-effort resolution did not complete - plus the amended
--   analytics.product_events table comment that permits exactly this rewrite and a note correcting
--   one sentence 0122 shipped wrong, since 0114 and 0122 are both immutable.
-- Schemas touched/read explicitly: analytics, content, sync, pg_catalog.
--
-- 0122 completed the platform on the review_answered rows 0120 reconstructed, and named in its own
-- WHAT STAYS NULL section the one population it deliberately did not reach: "a live origin =
-- 'server' row this file may not touch". This file is that population as it stands when this file
-- commits, and it exists because those rows turned out to be bounded and resolvable rather than a
-- matter for the live producer after all.
--
-- Three deploys made it, in this order:
--
--   * 13e62949a shipped the live review_answered producer. It wrote origin = 'server' rows carrying
--     platform NULL, because nothing resolved one yet.
--   * 0120 then ran and reconstructed the history from content.review_events. Its insert ended in
--     ON CONFLICT (event_id) DO NOTHING (0120:675), so wherever the live producer had already
--     reported a review the live row held the primary key and 0120's row was discarded. Those
--     survivors are origin = 'server' with a NULL platform, and 0122's origin guard skipped them.
--   * dd2c32143 taught the producer to resolve the platform from the replica that recorded the
--     review. Everything it has written since carries one wherever that resolution completed, which
--     is not every row and is the second population below.
--
-- So the series is coloured on both sides of a gap and grey inside it: the reconstructed history
-- 0122 filled, then the window between the first and third deploys, then the live rows, which carry
-- a platform whenever the producer's best-effort resolution completed and are grey where it did not,
-- as below. Nothing about that window makes its platform unknowable: every row of it whose review
-- content.review_events still holds names, through that review, the replica the live producer would
-- read today, and the rows whose review is gone are counted and announced below rather than assumed
-- away. The gap is not missing evidence. It is a producer that shipped before its derivation did.
--
-- The window will not close by itself, and this is the fact that decides the whole file. The live
-- producer only ever writes this column on INSERT, through a statement that ends in
-- ON CONFLICT (event_id) DO NOTHING (apps/backend/src/productAnalytics/writer.ts:92-98), and the
-- only UPDATE the backend runs against this table is the account-deletion anonymization path
-- (apps/backend/src/auth/accountDeletion.ts:179-195). A row it already wrote with a NULL platform is
-- a row it will never revisit, however long it runs. Either a migration completes those rows or the
-- chart carries a grey band across that window for as long as the table is retained.
--
-- The same statement is why this file cannot race the producer. Its rows are already inserted and
-- committed; the producer contends for none of them, and platform IS NULL below excludes every row
-- it has since coloured. There is no ordering against any further deploy that produces a wrong row.
--
-- The window is also not the only thing here. The producer's resolution is best effort by design -
-- it runs after the product transaction committed and may not raise into a closed caller - so a
-- drain whose replica read failed, or whose scoped read matched nothing at all, stores its reviews
-- with a NULL platform and reports a Sentry warning
-- (product_analytics_review_answered_platform_resolution_failed and ..._resolution_empty in
-- apps/backend/src/productAnalytics/reviewAnswers.ts). Failed is wider than timed out and is meant
-- to be: one catch wraps the whole scoped read, so a connection the pool could not hand over, the
-- BEGIN, the workspace-scope statement, the SELECT itself and the COMMIT all reach that one
-- warning, and reviewAnswerPlatformResolutionTimeoutMs is only the deadline among them. Those two
-- announce themselves. The third does not, and it is the one a grey row can never be traced back to
-- from logs: the empty-read warning is guarded on the read returning no rows at all
-- (reviewAnswers.ts:321-335), so a drain whose scoped read returns some replicas but not the one
-- that recorded a given review stores that answer with a NULL platform and reports nothing. That
-- read is filtered by the row-level policy on sync.workspace_replicas, which admits a row only
-- where the request's workspace scope reaches it and its user_id is the request's own identity
-- (0035:119-126), and that user_id is rewritten to the registering identity every time a replica
-- re-registers (apps/backend/src/sync/identity/replica.ts:163-176), so a single replica row can
-- fall out of an otherwise healthy read. That is exactly the shape this file's unscoped read below
-- reaches and the producer's scoped one did not.
--
-- A spent post-commit budget is not one of these three, and it is worth saying so because it reads
-- like one. A drain that finds the budget already spent resolves nothing and then stops on the same
-- check before its first chunk, so it stores no review_answered row at all rather than a grey one
-- (emitCollectedReviewAnswers in the same file), and it says so: it reports
-- product_analytics_review_answered_drain_aborted with reason budget_exhausted, a storedEventCount
-- of zero and every answer of the drain counted as skipped. That is a missing bar rather than a grey
-- one - there is no row for this file to fill or for the shapes below to count - and it is
-- announced, so it is never what a grey band is made of.
--
-- All three causes leave rows of the same shape as the window's: a column no writer ever populated,
-- over a review whose replica is still stored. They are not separated out below, because nothing
-- stored distinguishes them and nothing needs to: the resolution this file runs is the producer's
-- own, so a row it fills gets exactly the value the producer would have written had it succeeded.
--
-- This file's read is in one way stronger than the producer's, which is worth stating because it is
-- why the second population is reachable at all. The producer reads sync.workspace_replicas inside
-- the request's own workspace scope, under the row-level policy that table carries (0035:82). This
-- file runs as the migration role, which owns that table, and no migration declares FORCE ROW LEVEL
-- SECURITY on it, so the policy does not filter this read. A replica the producer's scope could not
-- see is visible here.
--
--
-- THE AMENDMENT, AND WHY 0122'S SENTENCE DOES NOT ALREADY COVER THIS
--
-- 0114's comment on analytics.product_events permitted one UPDATE, the account-deletion
-- anonymization path. 0122 amended it to permit a second: "a backfill migration completing a column
-- an earlier backfill left NULL on rows that earlier backfill wrote itself". That sentence is
-- written about who wrote the row, and these rows were written by the live producer, so this file is
-- outside it. It therefore does what 0122 did in the same position: it amends the contract, in the
-- COMMENT ON TABLE below, and it stays inside the amendment. 0115 established that mechanism for
-- this table because 0114 is immutable, and 0122 used it for this same comment.
--
-- The amendment restates the second permitted rewrite on the STATE OF THE COLUMN rather than on the
-- identity of the writer. What justified 0122's rewrite was never that a backfill wrote the row; it
-- was that the column held nothing, so completing it destroyed no stored fact. That property is
-- exactly as true of a live row whose producer had no derivation yet, and the restated sentence says
-- so directly: a migration may complete a column that no writer has ever populated on that row, when
-- the value is derivable from a record the backend already stored.
--
-- THE ASYMMETRY IN THAT SENTENCE IS THE WHOLE OF ITS SAFETY AND MUST NOT BE READ AWAY. NULL to a
-- derived value is permitted. A value to another value is not, whatever is thought of the stored
-- value. A future author will find a column that was resolved wrongly - a producer that read the
-- wrong source, an allowlist that admitted too much - and argue that a wrong value is as incomplete
-- as an absent one and equally deserving of a migration. It is not, and the sentence is worded to
-- refuse that reading rather than to leave it arguable: a stored non-null value is never
-- overwritten, so a row this table holds can gain a fact and can never change one. That is the only
-- reason an append-only contract survives being amended twice.
--
-- The guards on the UPDATE below are that sentence, expressed as predicates, and not filters for
-- efficiency:
--
--   * platform IS NULL. The precondition. A row that already carries a platform - one the live
--     producer resolved, or one 0122 completed - is not visited.
--   * origin = 'server'. Keeps this to the population described above. 0122 already completed the
--     'backfill' rows, and no client-origin row of this event name can exist: review_answered is
--     serverOnly in apps/backend/src/productAnalytics/catalog.ts, which client ingest rejects
--     outright (validation.ts:263-265) and the writer refuses again before storing
--     (writer.ts:306-310).
--   * event_name = 'review_answered'. Keeps this to the one series whose derivation is stated here.
--   * No column but platform is written. event_id, the identity columns, occurred_at,
--     event_properties and details are left exactly as the producer wrote them. details needs its
--     own reason here, because the never-overwrite clause is not the one that reaches it: the live
--     producer writes details null on every review_answered row, having no provenance to record
--     (toReviewAnsweredEvent in apps/backend/src/productAnalytics/reviewAnswers.ts, and writer.ts
--     on why the column is nullable at all), so on this population there is nothing stored there to
--     overwrite. What rules it out is the amendment's other clause. A note naming which migration
--     completed the column would be a fact this file minted about its own run rather than a value
--     derivable from a record the backend already stored, so writing it is outside the sentence
--     whatever the column holds. 0122 argued the other way round because its population was the
--     other case: 0120 wrote a details object onto the rows it inserted (0120:661-664), so there a
--     rewrite really would have overwritten a stored value. Reading that argument across to these
--     rows is the one thing this bullet is here to prevent. This file inserts no row, owns none and
--     writes no backfill_id: it completes rows the live producer wrote, and
--     product_events_backfill_id_shape (0114:42-44) ties backfill_id to origin 'backfill' anyway.
--
-- The amendment grants nobody a privilege. Migrations run as the database owner
-- (infra/aws/lib/migration-runner.ts passes DB_OWNER_SECRET_ARN), so this UPDATE needs no grant, and
-- backend_app's table-wide UPDATE remains solely the account-deletion anonymization path 0114
-- granted it for.
--
--
-- A CORRECTION TO 0122, BECAUSE MIGRATION FILES ARE IMMUTABLE
--
-- 0122:323 states, in the paragraph introducing its COMMENT ON COLUMN, "No other 0114 comment on
-- this table is touched." That is not what 0122 did. It restated two 0114 comments on this table:
-- the COMMENT ON TABLE at 0122:299-308 and the COMMENT ON COLUMN on platform at 0122:337-343. The
-- sentence reads as though the column comment were the only one, and a reader auditing which 0114
-- text is still in force would be misled by it. Nothing else in 0122 is affected and nothing it did
-- was wrong; only that one sentence describes it inaccurately, and this note is where the correction
-- has to live.
--
-- This file restates exactly one of the two: the table comment, below. The platform column comment
-- stays as 0122 wrote it, because it already describes what this file stores - "On a row the server
-- writes itself, whether a server-derived emission or a backfill, it is whatever the server could
-- resolve from its own stored record of the actor behind the fact" - and re-issuing an accurate
-- comment to no effect is how the next reader ends up auditing three versions of it instead of two.
--
--
-- WHERE THE PLATFORM COMES FROM
--
-- The resolution is 0122's, unchanged, and 0122's own section on it is the justification rather than
-- anything restated here: the map from an analytics row back to its review is the derivation the
-- producer used to build the id, analytics.derive_server_event_id('review_answered',
-- ARRAY[review_event_id]), which 0119 exists to keep byte-identical to
-- deriveServerDerivedProductAnalyticsEventId; review_event_id is the PRIMARY KEY of
-- content.review_events, so no two reviews reach one event_id; the review names exactly one replica
-- through a NOT NULL foreign key; the replica's platform is immutable once registered; and the pair
-- actor_kind = 'client_installation' AND platform IN ('ios', 'android', 'web') is read together
-- because sync.workspace_replicas.platform describes no device for the other actor kinds and its own
-- CHECK (0035:27) admits 'system' besides.
--
-- One thing is different from 0122 and is the reason the allowlist is not merely inherited but
-- confirmed: for these rows there is a live producer to agree with, and it resolves the same pair
-- the same way. toReviewAnsweredPlatform in apps/backend/src/productAnalytics/reviewAnswers.ts
-- returns null unless actor_kind is 'client_installation', then returns the platform only for 'ios',
-- 'android' and 'web'. So a row this file fills carries the value the producer writes today on the
-- next review from that same install, and the chart shows one series rather than a seam at a deploy.
-- 0122's argument for not minting an 'agent' bucket here holds for the same reason and with more
-- force: the live producer never writes that value, so a history that did would show the machine API
-- appearing and vanishing on deploy days.
--
-- Nothing about a person is read or written. The only value stored is one of three strings naming a
-- class of client, which is why this file carries no org.user_settings guard - 0122's section on
-- that applies here unchanged, including that the anonymization sweep does not write platform
-- (accountDeletion.ts:179-195) and that this file's three row predicates name columns that sweep
-- does not touch, so under READ COMMITTED a row locked by a concurrent deletion is re-checked, still
-- qualifies, and receives its platform with the sweep's own writes intact.
--
--
-- WHAT THIS FILE LOCKS
--
-- A row lock on every row it writes, held until COMMIT, so a concurrent DELETE /account reaching one
-- of them waits and then fails 55P03 on its own lock_timeout
-- (apps/backend/src/database/deadline.ts). Accepted on 0122's reasoning and at a smaller scale: this
-- population is live rows of one event name rather than the whole reconstructed history. The
-- converse is bounded too - if the deletion arrives first this UPDATE waits and at worst fails 57014
-- under the statement_timeout below, which rolls the release back cleanly and can be run again.
--
--
-- WHAT STAYS NULL, FOR WHOEVER READS THE CHART LATER
--
-- After this file a review_answered row still carries platform NULL in three shapes and no others.
-- Two of them this file counts and announces below: the replica that recorded the review is not a
-- client installation on ios, android or web (typically the machine API, the AI chat actor or a
-- backend actor, and, if the replica table's CHECK is ever taken up on it, a client installation
-- holding 'system'), or the content.review_events row it names, or the replica that row named, no
-- longer exists.
--
-- The third is not a leftover of any migration and appears in none of those counts: a review
-- answered on a real client installation whose live resolution did not complete - the failed read
-- in any of the forms above, the empty scoped read, or the scoped read that returned other replicas
-- but not this one - on a row this file's UPDATE did not see, which is every such row the producer
-- writes from now on. It names a replica that is a client installation and a review that does
-- exist, so it is neither of the two shapes above, and it is expected behaviour rather than a
-- defect. It is bounded going forward by the producer and not by another migration: a row already
-- written with a NULL platform is one the producer never revisits (above), so nothing shrinks this
-- shape except the resolution succeeding more often, and that work is in
-- apps/backend/src/productAnalytics/reviewAnswers.ts and nowhere in db/migrations. Two of its three
-- causes announce themselves as the Sentry warnings named above; the partial scoped read announces
-- nothing, so a grey row of this shape may have left no trace anywhere. A grey series in one of
-- these three shapes is a known undercount; anything else is a bug. Rows missing outright are a
-- different question from grey ones, and product_analytics_review_answered_drain_aborted above is
-- where that one is answered.
--
-- That the first two are all a migration can leave is a stronger statement than 0122 could make, and
-- it is the point of this file: origin is CHECK-bound to client, server and backfill (0114:39-41),
-- review_answered can never be client, 0122 completed backfill and this completes server, so the
-- series has no origin left that a migration has not walked back. No further file of this kind is
-- needed for it, the third shape included: a migration could only ever chase that shape and never
-- end it.
--
-- Nothing else in analytics.product_events is touched. Every other event keeps the platform it
-- carries, including 0121's reconstructed app_opened rows and their 'agent' bucket, which is a
-- different event with a different producer and no defect of this kind: app_opened has no
-- server-side emitter, its live rows are client-origin and carry the header platform, and 0121
-- avoided this overlap with an explicit anti-join rather than ON CONFLICT. 'review_answered' is
-- named in the resolution and again in the row predicate so this stays true whatever the table comes
-- to hold.

-- The session bounds this file runs under, set exactly as 0120, 0121 and 0122 set them and for the
-- reasons 0122 states at length: the runner wraps each file in BEGIN/COMMIT on a client that sets no
-- timeout of its own (applyPendingMigrations in apps/backend/src/database/migrationRunner.ts) and
-- the migration Lambda's own timeout is 5 minutes (infra/aws/lib/migration-runner.ts:95), so without
-- a server-side bound a long statement ends as a killed Lambda with the transaction still open on
-- the server rather than as a clean SQL error.
--
-- statement_timeout is 240 seconds against that 300-second budget, leaving 60 for the ROLLBACK and
-- for the runner to name the file that failed. It bounds a statement and not the file, and the two
-- statements below can each take it, which is the same arithmetic 0122 declined to smooth over: the
-- value is not what keeps the release inside the budget. The scale is. This population is smaller
-- than the one 0122 visited - live rows of one event name rather than the whole reconstructed
-- history, and a disjoint set of rows rather than a part of that one, since the origin guards do not
-- overlap - over the same plan: one pass over content.review_events, one primary-key probe per
-- review into sync.workspace_replicas, and a join on analytics.product_events.event_id, that table's
-- primary key. Reaching this bound therefore means the plan is wrong, not that the bound is tight,
-- and a 57014 naming the statement is a better failure than a Lambda timeout naming nothing.
--
-- idle_in_transaction_session_timeout is 30 seconds. Every applier drives this file from a local
-- source and commits as soon as it ends, so this transaction is never legitimately idle for anything
-- close to that; the bound exists for the case where the client dies with the transaction open, so
-- the server ends it on a timer instead of when it notices the connection is gone.
--
-- Both are SET LOCAL so they revert at COMMIT and do not leak into later migrations, the view files
-- or the admin grant statements that share this client.
SET LOCAL statement_timeout = '240s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- The contract amendment, restated in full because COMMENT ON TABLE replaces the whole comment and
-- 0114 is immutable. The first three sentences are 0114's own, carried across verbatim exactly as
-- 0122 carried them, so nothing else that comment states is lost. Only the second permitted rewrite
-- changes, and it changes from a rule about who wrote the row to a rule about what the column holds.
--
-- It is written to be hard to widen by reading. It permits completing a column, not editing a row; a
-- column that is still NULL, not one that holds a value; a value the backend already stored
-- somewhere, not one a migration reasons its way to. A writer that wants more than that is outside
-- this sentence and needs its own amendment and its own justification, in its own migration - which
-- is what this file is, relative to 0122's.
COMMENT ON TABLE analytics.product_events IS
  'Append-only product analytics events. Every column is written either by the client or by the server, never by both. '
  'No foreign keys are declared on purpose: they would add write contention on an insert-only table and block user deletion, '
  'and reporting joins work without them. '
  'Exactly two rewrites are permitted and no other writer may rewrite a row. The first is the account-deletion '
  'anonymization path, which sets identity_state to anonymized and clears the person-linked columns in place. The second is '
  'a migration completing a column that no writer has ever populated on that row, whatever wrote the row, where the value is '
  'derivable from a record the backend already stored: the column must still be NULL, and a stored non-null value is never '
  'overwritten. Null to a derived value is permitted; a value to another value is not, however wrong the stored value is '
  'thought to be, because a wrong value is not an incomplete column. So a row may gain a fact it always should have carried '
  'and may never change one. The table is otherwise append-only.';

-- What this file leaves NULL, measured rather than assumed, and announced rather than left silent.
--
-- Nothing below branches on these counts and nothing raises. This file becomes the
-- --require-migration value in .github/workflows/aws-web-release.yml and the databaseMigrationGate
-- argument in infra/aws/lib/stack.ts, so a RAISE EXCEPTION here would not cost a rerun - it would
-- block AWS/Web Release, and every unrelated change riding that release, until somebody edited a
-- merged migration file or hand-inserted a schema_migrations row, both out-of-band database
-- operations this repository's CI/CD-only rule forbids and neither of them something a rerun can do
-- for itself. Every condition measured here is permanent rather than transient - a replica is either
-- a client installation on a real client platform or it is not, and a deleted review does not come
-- back - so a retry finds the same thing about every row this one saw, and reporting is the whole of
-- the response.
--
-- The notices reach an operator because the migration client subscribes to the 'notice' event and
-- writes each one to stdout as a database_migration_notice record naming the file that raised it
-- (apps/backend/src/database/migrationRunner.ts). 0120 added that subscription; this is the fourth
-- file to rely on it.
--
-- The three counts partition the candidate set exactly, so an operator may add them. The query is
-- driven from the candidate rows themselves with the resolution attached by a LEFT JOIN, so every
-- candidate falls into exactly one of: it resolves to a client installation and will be filled; it
-- resolves to a replica that is not one and stays NULL; it resolves to nothing at all and stays
-- NULL. The candidate predicates are the UPDATE's own, and the resolution is the UPDATE's own minus
-- the allowlist, which moves into the CASE so the rows it excludes are counted instead of
-- disappearing.
--
-- These are counts as this statement's snapshot has them, and the UPDATE takes its own; a review
-- deleted between the two makes the filled count over-report by one, and a row the live producer
-- inserts between the two with a resolution that did not complete makes it under-report by one. The
-- counts are an operator signal. The number of rows this series actually carries afterwards is
-- readable directly and is the answer to prefer: count(*) over analytics.product_events where
-- event_name = 'review_answered' and origin = 'server' and platform IS NOT NULL.
DO $$
DECLARE
  fillable_row_count BIGINT;
  non_client_replica_row_count BIGINT;
  unresolvable_row_count BIGINT;
BEGIN
  SELECT
    pg_catalog.count(*) FILTER (WHERE resolved.platform IS NOT NULL),
    pg_catalog.count(*) FILTER (
      WHERE resolved.event_id IS NOT NULL
        AND resolved.platform IS NULL
    ),
    pg_catalog.count(*) FILTER (WHERE resolved.event_id IS NULL)
  INTO STRICT
    fillable_row_count,
    non_client_replica_row_count,
    unresolvable_row_count
  FROM (
    SELECT product_events.event_id
    FROM analytics.product_events AS product_events
    WHERE product_events.event_name = 'review_answered'
      AND product_events.origin = 'server'
      AND product_events.platform IS NULL
  ) AS candidate_rows
  LEFT JOIN (
    SELECT
      analytics.derive_server_event_id(
        'review_answered',
        ARRAY[review_events.review_event_id::text]
      ) AS event_id,
      CASE
        WHEN replicas.actor_kind = 'client_installation'
          AND replicas.platform IN ('ios', 'android', 'web') THEN replicas.platform
        ELSE NULL
      END AS platform
    FROM content.review_events AS review_events
    INNER JOIN sync.workspace_replicas AS replicas
      ON replicas.replica_id = review_events.replica_id
  ) AS resolved
    ON resolved.event_id = candidate_rows.event_id;

  IF fillable_row_count > 0 THEN
    RAISE NOTICE
      'Completing the platform on % live review_answered row(s) the server-derived producer left null, whether it wrote them before it could resolve a platform at all or its best-effort resolution did not complete for them, from the client installation replica that recorded the review. That is the same resolution the producer runs today, so no column but platform is written on those rows and no stored value is overwritten.',
      fillable_row_count;
  END IF;

  IF non_client_replica_row_count > 0 THEN
    RAISE NOTICE
      'Leaving % live review_answered row(s) with a null platform because the replica that recorded the review is not a client installation on ios, android or web. That is typically the machine API, the AI chat actor or a backend actor, and it also covers a client installation storing the system value the replica table permits. None of those is a device that sync.workspace_replicas.platform describes, the live producer resolves them to null for the same reason, and null is the only value this file can defend for them.',
      non_client_replica_row_count;
  END IF;

  IF unresolvable_row_count > 0 THEN
    RAISE NOTICE
      'Leaving % live review_answered row(s) with a null platform because the content.review_events row the event id was derived from, or the replica it named, no longer exists. Those reviews went with a deleted workspace or card, and analytics.product_events keeps its row because it holds no foreign key.',
      unresolvable_row_count;
  END IF;
END
$$;

-- The one statement this file exists for.
--
-- Identical to 0122's in every part except the origin predicate, which is 'server' here where that
-- file wrote 'backfill'. That is the whole of the difference between the two populations, and it is
-- deliberate that nothing else moves: the join key, the allowlist and the value written are the same
-- derivation, so the two halves of this series cannot disagree about what platform a review was
-- answered on.
--
-- The predicates beside the join key are the contract amendment above expressed as predicates rather
-- than performance filters, and removing any of them would put this statement outside the sentence
-- the COMMENT ON TABLE now carries: event_name keeps this to the one series, origin keeps it to the
-- live rows this file is about, and platform IS NULL keeps it to a column with no value to lose.
--
-- The join key is the producer's own derivation, which is what makes this the completion of a row
-- rather than a second guess at which review it came from. It cannot match ambiguously:
-- review_event_id is the PRIMARY KEY of content.review_events, so no two source rows reach one
-- event_id and no analytics row can be offered two different platforms here.
--
-- The allowlist sits in the subquery rather than in a CASE, so a review whose replica is not a
-- client installation on a real client platform produces no row and its analytics row is not
-- visited at all - the same outcome as writing NULL over NULL, and a smaller claim on an
-- append-only table.
--
-- The value written can only ever be 'ios', 'android' or 'web': it is sync.workspace_replicas.platform
-- as stored, bounded by that column's CHECK (0035:27) and narrowed again by the IN list here, and
-- all three are members of productAnalyticsPlatforms in apps/backend/src/productAnalytics/catalog.ts.
-- analytics.product_events.platform carries no CHECK of its own - 0114 declared it as bare TEXT - so
-- this statement's allowlist is what keeps the column's stored domain intact, which is why it is a
-- literal list and not "whatever the replica holds".
--
-- The join is INNER on sync.workspace_replicas because content.review_events.replica_id is NOT NULL
-- with a foreign key to it (0035, restated by 0037), so a review with no replica is not a state this
-- schema can reach; if it ever became one the row would simply not be visited and would keep its
-- NULL, which is the undercount the notice above reports and never a raise.
UPDATE analytics.product_events AS product_events
SET platform = resolved_platforms.platform
FROM (
  SELECT
    analytics.derive_server_event_id(
      'review_answered',
      ARRAY[review_events.review_event_id::text]
    ) AS event_id,
    replicas.platform AS platform
  FROM content.review_events AS review_events
  INNER JOIN sync.workspace_replicas AS replicas
    ON replicas.replica_id = review_events.replica_id
  WHERE replicas.actor_kind = 'client_installation'
    AND replicas.platform IN ('ios', 'android', 'web')
) AS resolved_platforms
WHERE product_events.event_id = resolved_platforms.event_id
  AND product_events.event_name = 'review_answered'
  AND product_events.origin = 'server'
  AND product_events.platform IS NULL;
