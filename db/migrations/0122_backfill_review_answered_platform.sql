-- Migration status: Current / one-time backfill.
-- Introduces: the platform on the analytics.product_events rows of event_name 'review_answered'
--   that 0120 reconstructed and left NULL, plus the amended analytics.product_events table comment
--   that permits exactly this one further rewrite and the corrected platform column comment, since
--   0114 is immutable.
-- Schemas touched/read explicitly: analytics, content, sync, pg_catalog.
--
-- 0120 rebuilt one review_answered row per content.review_events row whose author still had an
-- org.user_settings row - its insert is guarded by the UUID regex on reviewed_by_user_id and by an
-- EXISTS against that table (0120:669-674), so a review whose author had already deleted their
-- account produced no analytics row at all and is no candidate for anything below - and it wrote no
-- platform on any of the rows it did write, for a reason its own header states at length: every live
-- server-derived producer passed platform: null at the time, so a backfilled row naming one would
-- have disagreed with the live stream on the column that is hardest to correct afterwards. That
-- reason ends the moment the live review_answered producer starts carrying the platform. Without
-- this file the dashboard's per-platform history would then be coloured from the day that producer
-- deploys and grey for everything before it - not because the platform of a historical review is
-- unknown, but because nobody went back for it. This is that walk back.
--
-- No row here waits on that producer's deploy, and no ordering against it can produce a wrong row.
-- This file writes only rows carrying origin = 'backfill', and no application path writes that
-- value: the only two origins the backend ever constructs are 'server' in
-- apps/backend/src/productAnalytics/serverEvents.ts and 'client' in the ingest route, so a
-- 'backfill' row is always one a migration of this repository inserted. The live producer therefore
-- cannot reach the rows below and this file cannot reach its rows, in either order, so this is
-- correct run before, after or across that deploy - the same property 0120's own header claims for
-- the inserts these rows came from.
--
-- What the dashboard shows in between is a different question, and it is not deferred, because this
-- column is already read. apps/admin/src/reports/reviewEventsByDate/query.ts buckets
-- analytics.product_events_resolved.platform for event_name = 'review_answered' into web, android,
-- ios, agent and unattributed, and the report renders that split today - wholly as unattributed,
-- because every one of those rows carries NULL. So this file has an immediate visible effect rather
-- than a dormant one. From the moment it runs the reconstructed history is coloured, while the live
-- origin = 'server' rows - the ones that beat 0120 to the primary key and everything the live
-- producer has written since - stay unattributed, until that producer starts carrying the platform
-- and colours what it writes from its own deploy onward.
--
-- That interim picture is the inverse of the one the opening paragraph describes: coloured history
-- against a grey tail, rather than grey history against a coloured tail. It is accepted rather than
-- avoided. Every value it shows is true of the row it came from, no total on that report moves
-- because only the split changes, and the grey tail is bounded and closes without another migration
-- once the live producer ships. Running this file after that producer instead would not remove the
-- interim state either; it would only swap which half of the series is grey while it lasts.
--
--
-- THIS FILE WRITES TO AN APPEND-ONLY TABLE, AND SAYS SO FIRST
--
-- 0114's own comment on analytics.product_events reads:
--
--   The single permitted UPDATE is the account-deletion anonymization path, which sets
--   identity_state to anonymized and clears the person-linked columns in place. The table is
--   otherwise append-only and no other writer may rewrite a row.
--
-- This file does not fit that sentence, so it does two things together or neither: it amends the
-- contract, in the COMMENT ON TABLE below, and it stays inside the amendment. 0115 established that
-- pattern for this exact table - its header carries "the corrected analytics.product_events comments
-- ... since 0114 is immutable" and it restates three column comments 0114 got wrong. The same
-- mechanism is used here for the table comment.
--
-- THE AMENDMENT IS AS NARROW AS THE JUSTIFICATION, AND MUST NOT BE WIDENED. What makes this
-- permissible is not that a backfill is special. It is that these rows are origin = 'backfill' -
-- an artefact this repository fabricated out of content.review_events, not an observation a client
-- sent or a fact the backend watched happen. The guards on the UPDATE below are part of that
-- justification rather than defensive decoration, and this is what each of them buys:
--
--   * No client-origin row is touched. A client's report of itself is not this file's to complete.
--   * No server-origin row is touched either, including the live review_answered rows that beat
--     0120 to the primary key. Those are the live stream's own observations and belong to the live
--     producer; the named residual below says what that costs.
--   * No non-null value is overwritten, on any row, ever. platform IS NULL is a precondition and not
--     a filter for efficiency.
--   * No fact changes. A column that was NULL gains the value it always should have had. The row's
--     event_id, its identity columns, its occurred_at, its event_properties and its details are all
--     left exactly as 0120 wrote them.
--
-- details is deliberately not rewritten to name this file. That row was still reconstructed by 0120,
-- from content.review_events, and its details says so correctly; rewriting it would be an overwrite
-- of a stored value, which is precisely what the amendment above does not permit. A reader who wants
-- to know which run completed the column reads this file, or the rows' backfill_id, which is
-- 0120's 139bd2f2-12b8-44c4-ad17-1081e5ed223f on every one of them. This file writes no backfill_id
-- of its own, because it inserts no row and owns none: it completes rows another run wrote.
--
-- The amendment grants nobody a privilege. Migrations run as the database owner
-- (infra/aws/lib/migration-runner.ts passes DB_OWNER_SECRET_ARN), so this UPDATE needs no grant, and
-- backend_app's table-wide UPDATE is still solely the account-deletion anonymization path 0114
-- granted it for. No application writer gains anything here.
--
--
-- WHERE THE PLATFORM COMES FROM, AND WHY JOINING THE REPLICA IS RIGHT HERE
--
-- Each backfilled row maps to exactly one content.review_events row, and the map is the derivation
-- 0120 used to build it: event_id = analytics.derive_server_event_id('review_answered',
-- ARRAY[review_event_id]). The function (0119) is used rather than a re-implementation of the
-- digest, for the reason its own comment gives - the in-database twin and the TypeScript emitter
-- must never diverge, and there is exactly one of each. review_event_id is the table's PRIMARY KEY
-- (0001), so distinct reviews derive distinct ids and the resolution below can match at most one
-- source row per analytics row. content.review_events.replica_id is NOT NULL with a foreign key to
-- sync.workspace_replicas (0035, restated by 0037 as NO ACTION DEFERRABLE INITIALLY DEFERRED), so
-- that review names exactly one replica, and the replica carries both actor_kind and platform on the
-- same row.
--
-- 0120 refused to join that replica and spent a section saying why, so the difference has to be
-- stated rather than left to look like a contradiction. What 0120 refused to take from the replica
-- was AUTHORSHIP: sync.workspace_replicas.user_id is a mutable label that
-- apps/backend/src/sync/identity/replica.ts rewrites on every re-registration, so it names whoever
-- holds the install now and not who answered the review, which is the whole reason 0058 introduced
-- content.review_events.reviewed_by_user_id. That argument is about one column and it is untouched
-- here: this file reads no user id from anywhere and writes none.
--
-- platform on that same row is the opposite kind of column. The re-registration UPDATE in
-- replica.ts sets user_id, app_version and last_seen_at and carries platform in its WHERE, never in
-- its SET, so a re-registration that names a different platform matches no row and the request fails
-- with SYNC_REPLICA_CONFLICT rather than moving the value. A client_installation replica's platform
-- is therefore fixed for the life of the row: the install that stamped the review is on the same
-- platform today that it was on then, whoever owns it now. That is what makes the replica a correct
-- source for this column while remaining a wrong one for authorship, and it is why 0061 already
-- reads exactly this pair off exactly this join to decide what counts as real client activity for a
-- review (0061:77-78 and 0061:120-121).
--
-- The pair is read together and never apart, which is the hard requirement on
-- ServerDerivedProductAnalyticsEvent in apps/backend/src/productAnalytics/serverEvents.ts. That
-- comment is cited by name and not by line, because the producer work on this very column edits
-- that area and a line range into a moving file rots the moment it merges. The rule is that
-- sync.workspace_replicas.platform may never be read without actor_kind on the same row, because
-- more than one actor kind stores a value there that describes no device: an agent_connection
-- replica stores the literal 'web' for the machine API, an ai_chat replica stores a hardcoded 'web',
-- and workspace_seed and workspace_reset store 'system'. So the resolution below admits
-- actor_kind = 'client_installation' and platform IN ('ios', 'android', 'web') and nothing else.
--
-- Both halves of that allowlist are load-bearing. The actor kind is checked because the column alone
-- cannot tell a device from a backend actor. The value is checked because the table's own CHECK
-- (0035:27) admits 'system' as well, so nothing at the schema level stops a client_installation row
-- from holding it; only the application does, and this file is not going to depend on that.
--
--
-- WHY NO 'agent' BUCKET HERE, WHERE 0121 MINTED ONE
--
-- 0121 wrote platform 'agent' for machine-API activity, derived from the actor kind because no
-- stored column anywhere holds that value, and warned its consumers about the bucket. This file does
-- not, and the difference between the two is the situation rather than the judgement.
--
-- 0121 was the only producer that could ever write the bucket it minted. app_opened does have a live
-- half, but it is client-origin, and 'agent' is not a value a client may claim:
-- productAnalyticsClientReportablePlatformFlags in apps/backend/src/productAnalytics/catalog.ts
-- marks it false, and the machine API's api_key transport is refused by the ingest route outright.
-- No live server producer emits app_opened either. So 0121 could define that bucket and define it
-- completely, and nothing live could contradict it. review_answered is not that. It is one series
-- whose live half this file does not write, produced continuously by the backend on the very
-- derived-id space these rows occupy, so a bucket invented for the history that the live stream does
-- not also emit - or omitted from the history when the live stream does emit it - shows up as that
-- client appearing or vanishing on the day a deploy landed. Both directions are wrong.
--
-- What breaks the symmetry is that the two errors are not equally repairable, and the amendment
-- above is what decides it. NULL is what 0120 already wrote on every one of these rows, and a NULL
-- can be completed later by exactly the kind of migration this file is. A minted 'agent' cannot be
-- taken back: removing it would be an overwrite of a stored value, which the amendment does not
-- permit and must not be widened to permit. So the value that can be wrong and still fixed is the
-- one this file writes, and the allowlist is the three real client platforms - which is also the set
-- 0061 uses for review activity, and a subset of what the platform split of this chart reads: that
-- split also has an 'agent' bucket, and leaving it empty from here is the whole point above.
--
--
-- ACCOUNT DELETION, AND WHY THIS FILE CARRIES NO org.user_settings GUARD
--
-- 0120 and 0121 both guard every write with an EXISTS against the live org.user_settings, and each
-- spends a section on the residual that guard leaves. This file has neither, and the omission is
-- deliberate rather than forgotten.
--
-- Those guards exist because both files INSERT a person's real user_id, subject_user_id,
-- guest_session_id or workspace_id onto an append-only table after the anonymization sweep may
-- already have run for the last time, which would re-create exactly what
-- apps/backend/src/auth/accountDeletion.ts removed. This file inserts nothing and writes no id. The
-- only value it stores is one of the three strings 'ios', 'android' and 'web', naming a class of
-- client and not a person. There is nothing here for a guard to protect.
--
-- Nor would the guard leave the rows it skipped in a safer state. anonymizeProductAnalyticsInExecutor
-- rewrites user_id and subject_user_id to a pseudonym, sets identity_state to 'anonymized', and
-- clears anonymous_id, session_id, guest_session_id, workspace_id, request_id, device_model,
-- os_version, timezone and device_locale. platform is not in that SET list, and neither are
-- app_version, network_state, screen, country, event_properties or experiment_assignments; of the
-- last three the sweep's own comment says they stay because they name a place and
-- catalog-allowlisted enum, numeric and fixed-format values rather than a person, and platform is
-- the same kind of value, a class of client. So this is a column the sweep leaves in place on every
-- anonymized row it touches: completing it on a row 0120 wrote adds nothing the deletion removed,
-- and skipping anonymized rows would only put a permanent hole in the per-platform history for
-- people who have left, while protecting nobody.
--
-- The concurrency is unusually benign for the same reason, and it is worth stating exactly rather
-- than inheriting 0120's residual by reference. This file's three row predicates - event_name,
-- origin and platform IS NULL - name columns the anonymization UPDATE does not write. Under READ
-- COMMITTED, a row this UPDATE finds locked by a deletion that then commits is re-checked against
-- the updated version, still satisfies all three, and receives its platform with every column the
-- sweep just wrote left intact. There is no lost update and no ordering between the two that
-- produces a wrong row.
--
--
-- WHAT THIS FILE LOCKS
--
-- It takes a row lock on every analytics.product_events row it writes and holds it until COMMIT, so
-- a concurrent DELETE /account whose anonymization UPDATE reaches one of them waits, and then fails
-- 55P03 once its own lock_timeout fires (apps/backend/src/database/deadline.ts). That is the same
-- shape 0120 recorded for the one lock it took, and the comparison is not flattering in every
-- direction, so it is written out both ways: the window is the narrowest this file could have, since
-- the UPDATE is its last statement and the locks therefore live from that statement to COMMIT, but
-- it covers far more rows than 0120's did, which locked only pre-existing identity links for guest
-- upgrades. It is accepted for the reason 0120 accepted its own: an account deletion is rare, what
-- it costs when it collides is one 55P03 the caller can retry, and the only way to remove the
-- contention entirely is to not write the column at all.
--
-- The converse direction is bounded too - if the deletion gets there first, this UPDATE waits, and
-- at worst fails with 57014 under the statement_timeout below, which rolls the release back cleanly
-- and can simply be run again.
--
-- No lock is taken on org.user_settings, because nothing here reads it. The whole-table FOR KEY
-- SHARE that 0120's header records and rejects - a certain authenticated-API outage for as long as
-- the migration runs - has nothing to protect here and is not worth re-litigating for this file.
--
--
-- WHAT STAYS NULL, IN ONE LINE, FOR WHOEVER READS THE CHART LATER
--
-- After this file a review_answered row still carries platform NULL only if its replica is not a
-- client_installation on ios, android or web (typically the machine API, the AI chat actor or a
-- backend actor, and, if the replica table's own CHECK is ever taken up on it, a client installation
-- holding 'system'), if the content.review_events row it was reconstructed from, or the replica
-- that row named, no longer exists - gone with a deleted workspace or card - or if it is a live
-- origin = 'server' row this file may not touch; every other backfilled row is coloured, so a grey
-- series in one of those shapes is a known undercount and anything else is a bug.
--
-- The first two are counted and announced by the notices below. The third is the one this file
-- cannot reach: 0120's inserts ended in ON CONFLICT (event_id) DO NOTHING, so wherever the live
-- producer had already reported a review, the live row won the primary key and 0120's row
-- disappeared. Those survivors carry origin = 'server', they are the rows between the live
-- producers' deploy and 0120's run, and they will carry whatever the live producer gives them - not
-- what this file would have. Their platform is a matter for that producer and not for a rewrite
-- here, which is why the origin guard is a guard and not an oversight.
--
-- Nothing else in analytics.product_events is touched: every other event keeps the platform it
-- already carries, which is NULL on every live server-derived row and, on 0121's reconstructed
-- app_opened rows, whatever that file resolved there including its 'agent'. This file names
-- 'review_answered' in the resolution and again in the row predicate so that stays true whatever
-- else the table comes to hold.

-- The session bounds this file runs under.
--
-- The migration runner wraps each file in BEGIN/COMMIT on a client that sets no timeout of its own
-- (applyPendingMigrations in apps/backend/src/database/migrationRunner.ts), and the migration
-- Lambda's own timeout is 5 minutes (infra/aws/lib/migration-runner.ts:95). Without a server-side
-- bound the failure mode of a statement that runs long is the Lambda being killed at 300 seconds
-- with the transaction still open on the server, which the database only tears down when it
-- eventually notices the connection is gone. A clean SQL error is strictly better, so both bounds
-- are set here, exactly as 0120 and 0121 set them and for the same reasons.
--
-- statement_timeout is 240 seconds, the same value 0120 and 0121 chose against that 300-second
-- Lambda budget, so 60 seconds are left for the ROLLBACK and for the runner to report which file
-- failed. What it bounds is a statement and not this file, and that is not smoothed over here any
-- more than it was there. Two statements below can run long - the DO block, which the server treats
-- as one statement whose timer PL/pgSQL does not re-arm per query inside it, and the UPDATE - so two
-- statements each allowed 240 seconds still add up to more than the Lambda has. A lower per-file
-- arithmetic bound was considered and not taken: it would put this file out of step with the two
-- backfills it follows for no gain, because the value is not what keeps the release inside the
-- budget.
--
-- What does is the scale. At the size this was measured against - about 40k content.review_events
-- rows and the same order of review_answered rows in analytics.product_events - both statements are
-- one pass over the reviews, one primary-key probe per review into sync.workspace_replicas, and a
-- join on analytics.product_events.event_id, which is that table's primary key. That runs in
-- seconds. Reaching this bound at all therefore means the plan is wrong rather than that the bound
-- is tight, and the release should then fail with a 57014 naming the statement instead of with a
-- Lambda timeout naming nothing.
--
-- One operational consequence of the UPDATE is worth naming since nothing else here would: this is
-- the first bulk rewrite this table has taken, and it leaves a dead tuple behind every row it
-- touches. That is what 0114's autovacuum_vacuum_scale_factor = 0.02 on this table is for, and it is
-- a one-time cost on rows nothing re-reads before the next autovacuum.
--
-- idle_in_transaction_session_timeout is 30 seconds. Every applier drives this file from a local
-- source and commits as soon as it ends - the Lambda runner sends the whole file as one message,
-- scripts/deploy/migrate.sh runs it under psql --single-transaction - so this transaction is never
-- legitimately idle for anything close to 30 seconds. The bound exists for the case where the client
-- dies with the transaction still open, so the server ends it on a timer instead of holding it until
-- it notices the connection is gone.
--
-- Both are SET LOCAL so they revert at COMMIT and do not leak into the later migrations, the view
-- files or the admin grant statements that share this client.
SET LOCAL statement_timeout = '240s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- The contract amendment, restated in full because COMMENT ON TABLE replaces the whole comment and
-- 0114 is immutable. The first three sentences are 0114's own, carried across verbatim so nothing
-- else that comment states is lost. Only the rule about rewrites changes, and it changes by exactly
-- one clause.
--
-- The clause is written to be hard to widen by reading. It permits completing a column, not editing
-- a row; a column that is still NULL, not one that holds a value; on rows a backfill migration wrote
-- itself, not on anything a client or the live backend produced. A future writer that wants more
-- than that is outside this sentence and needs its own amendment and its own justification, in its
-- own migration.
COMMENT ON TABLE analytics.product_events IS
  'Append-only product analytics events. Every column is written either by the client or by the server, never by both. '
  'No foreign keys are declared on purpose: they would add write contention on an insert-only table and block user deletion, '
  'and reporting joins work without them. '
  'Exactly two rewrites are permitted and no other writer may rewrite a row. The first is the account-deletion '
  'anonymization path, which sets identity_state to anonymized and clears the person-linked columns in place. The second is '
  'a backfill migration completing a column an earlier backfill left NULL on rows that earlier backfill wrote itself: only '
  'a row this repository fabricated from a production table, never a client-origin or server-origin row, only a column that '
  'is still NULL, and never an overwrite of a stored value, so the row gains the value it always should have had and no '
  'fact changes. The table is otherwise append-only.';

-- The platform column comment, restated by the same 0115 mechanism and for the same kind of reason.
-- 0114's text is "Client platform normalized by the server from the request headers, not from the
-- event body", which described the only writer that existed when 0114 was written and no longer
-- describes the column. 0121 already stores values it read off sync.workspace_replicas,
-- auth.guest_sessions, support.feedback_prompt_events and support.feedback_submissions, and values
-- it derived from an actor kind, on its reconstructed app_opened rows, and the UPDATE below adds a
-- further set read off that replica table. No request header was involved in any of them. A reader
-- who takes 0114's sentence literally reads every one of those rows as a header the server saw,
-- which is the wrong provenance, and reads a NULL as a header the server did not get, which is the
-- wrong absence.
--
-- Only provenance and the meaning of NULL are restated, and only for writers that exist today: the
-- client ingest path, and the migrations that have filled the column from rows the backend already
-- had stored. No other 0114 comment on this table is touched. NULL is spelled out because it is the
-- value most easily misread: it says the row carries no resolved device fact, and it covers two
-- reasons at once. The actor behind the row may not be a device at all - the machine API, the AI
-- chat actor, a backend actor - or it may be a real device that nothing here could resolve. Both
-- populations are stored already, and the WHAT STAYS NULL section above has them side by side for
-- this one series: a replica that is not a client installation is the first kind, while the client
-- installation holding 'system' that the same sentence allows for, a review whose
-- content.review_events row or replica no longer exists, and a live origin = 'server' row this file
-- may not touch are all the second.
-- 0121 holds the second kind too, since it wrote NULL wherever its evidence union disagreed on the
-- platform for a person-day, which is an ambiguous device and not a backend actor. So the comment
-- claims no more than that no device was resolved for the row - which is also what lets a NULL be
-- completed later by exactly the kind of migration this file is - and a reader must not file every
-- unattributed row as a non-device actor.
COMMENT ON COLUMN analytics.product_events.platform IS
  'Which client the row describes, from one of two sources. On a client-origin row it is the client platform normalized '
  'by the server from the request headers, never from the event body. On a row the server writes itself, whether a '
  'server-derived emission or a backfill, it is whatever the server could resolve from its own stored record of the '
  'actor behind the fact, never from the analytics event body. NULL means the row carries no resolved device fact, '
  'either because the actor behind it is not a device or because no device could be resolved for it, so a per-platform '
  'split reports it as its own bucket and never guesses at it.';

-- What this file leaves NULL, measured rather than assumed, and announced rather than left silent.
--
-- Nothing below branches on these counts and nothing raises. This file becomes the
-- --require-migration value in .github/workflows/aws-web-release.yml and the databaseMigrationGate
-- argument in infra/aws/lib/stack.ts, so a RAISE EXCEPTION here would not cost a rerun - it would
-- block AWS/Web Release, and every unrelated change riding that release, until somebody edited a
-- merged migration file or hand-inserted a schema_migrations row, both out-of-band database
-- operations this repository's CI/CD-only rule forbids and neither of them something a rerun can do
-- for itself. Every condition measured here is permanent rather than transient: a replica is either
-- a client installation on a real client platform or it is not, and a deleted review row does not
-- come back, so a retry finds the same thing. Reporting is the whole of the response.
--
-- PostgreSQL sends a notice to the client rather than to any log a release could read afterwards,
-- and node-postgres drops one that nothing listens for, so the migration client subscribes to the
-- 'notice' event and writes each one to stdout, which is the migration Lambda's CloudWatch log, as a
-- database_migration_notice record carrying the name of the file that raised it
-- (apps/backend/src/database/migrationRunner.ts). 0120 added that subscription; this is the third
-- file to rely on it.
--
-- The three counts partition the candidate set exactly, so an operator may add them. The query is
-- driven from the candidate rows themselves rather than from the reviews, and the resolution is
-- attached with a LEFT JOIN, so every candidate row falls into exactly one of: it resolves to a
-- client installation and will be filled; it resolves to a replica that is not one and stays NULL;
-- it resolves to nothing at all and stays NULL. The predicates on the candidate side are written
-- exactly as the UPDATE's own, and the resolution is written exactly as the UPDATE's own minus the
-- allowlist, which is moved into the CASE so the rows it excludes can be counted instead of
-- disappearing.
--
-- These are counts as this statement's snapshot has them, and the UPDATE below takes its own. A
-- review row deleted between the two makes the filled count over-report by one. The counts are an
-- operator signal. The exact number of rows actually written is readable directly and is the answer
-- to prefer: count(*) over analytics.product_events where event_name = 'review_answered' and
-- origin = 'backfill' and platform IS NOT NULL.
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
      AND product_events.origin = 'backfill'
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
      'Completing the platform on % reconstructed review_answered row(s) from the client installation replica that recorded the review. No other column of those rows is written and no stored value is overwritten.',
      fillable_row_count;
  END IF;

  IF non_client_replica_row_count > 0 THEN
    RAISE NOTICE
      'Leaving % reconstructed review_answered row(s) with a null platform because the replica that recorded the review is not a client installation on ios, android or web. That is typically the machine API, the AI chat actor or a backend actor, and it also covers a client installation storing the system value the replica table permits. None of those is a device that sync.workspace_replicas.platform describes, and null is the only value this file can defend for them.',
      non_client_replica_row_count;
  END IF;

  IF unresolvable_row_count > 0 THEN
    RAISE NOTICE
      'Leaving % reconstructed review_answered row(s) with a null platform because the content.review_events row they were reconstructed from, or the replica it named, no longer exists. Those reviews went with a deleted workspace or card after 0120 ran, and analytics.product_events keeps its row because it holds no foreign key.',
      unresolvable_row_count;
  END IF;
END
$$;

-- The one statement this file exists for.
--
-- The three predicates this statement puts on analytics.product_events beside the join key are part
-- of the contract amendment above rather than performance filters, and the section that states the
-- amendment says what each one is doing: event_name keeps this to the one series being completed,
-- origin keeps it to rows this repository fabricated, and platform IS NULL keeps it to a column that
-- has no value to lose. Removing any of them would put this statement outside the sentence the
-- COMMENT ON TABLE above now carries.
--
-- The join key is the derivation itself, which is what makes this the inverse of the insert that
-- created these rows rather than a second guess at which review a row came from. It cannot match
-- ambiguously: review_event_id is the PRIMARY KEY of content.review_events, so no two source rows
-- reach one event_id and no analytics row can be offered two different platforms by this statement.
--
-- The allowlist sits in the subquery rather than in a CASE, so a review whose replica is not a
-- client installation on a real client platform produces no row here at all and its analytics row is
-- simply not visited. That is the same outcome as writing NULL over NULL and a smaller claim on an
-- append-only table: the row is left exactly as 0120 wrote it.
--
-- The value written can only ever be 'ios', 'android' or 'web'. It is
-- sync.workspace_replicas.platform as stored, bounded by that column's own CHECK (0035:27) and
-- narrowed again by the IN list here, and all three are members of productAnalyticsPlatforms in
-- apps/backend/src/productAnalytics/catalog.ts. analytics.product_events.platform carries no CHECK
-- of its own - 0114 declared it as bare TEXT - so this statement's own allowlist is what keeps the
-- column's stored domain intact, which is the reason it is written as a literal list rather than as
-- "whatever the replica holds".
--
-- The join is INNER on sync.workspace_replicas because content.review_events.replica_id is NOT NULL
-- with a foreign key to it (0035, restated by 0037), so a review with no replica is not a state this
-- schema can reach; if it ever became one, the row would simply not be visited and would keep the
-- NULL 0120 gave it, which is the same undercount the notice above reports and never a raise.
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
  AND product_events.origin = 'backfill'
  AND product_events.platform IS NULL;
