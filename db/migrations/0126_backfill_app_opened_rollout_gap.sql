-- Migration status: Current / one-time backfill.
-- Introduces: the reconstructed analytics.product_events rows of event_name 'app_opened' for the
--   person-days that fall between the last day 0121 wrote and the day each client actually began
--   reporting the event itself. No new database object of any kind: the same reconstruction 0121
--   performed, run again against today's data.
-- Schemas touched/read explicitly: analytics, auth, community, content, org, public, support, sync,
--   pg_catalog.
--
--
-- THIS FILE IS 0121 AGAIN, NOT NEW LOGIC
--
-- Everything below this header is 0121_backfill_synthetic_app_opened_days.sql's executable body,
-- carried over unchanged except for the two temp table names, this run's backfill_id, and the
-- migration that this run's details name. 0121 is the specification and is not restated here: what
-- counts as evidence of a day and why each of the thirteen sources is read, how platform is derived
-- per source, why subject_user_id equals user_id, what account deletion forbids, which writes look
-- like a person and are not, and what is deliberately not reconstructed are all argued there, at
-- length, and none of it changes by being run a second time. Read that file before changing this
-- one.
--
-- The statement comments below are 0121's too. Where they say "the header" they mean 0121's header,
-- and the numbers they quote - the 85% coverage, the 124k hot changes, the 694 person-days - are
-- 0121's own measurements. Two of its sentences were true only of its own release and are dropped
-- rather than carried over false: its position in the queue of files relying on the migration
-- runner's notice subscription, and its being that release's --require-migration gate value, which
-- this file is not.
--
-- One of 0121's arguments the replay invalidates outright, corrected here because 0121 cannot be
-- edited: its EFFECT ON THE WEB GUEST REAPER section calls that effect a ONE-TIME SHIFT on the
-- ground that the file runs once and nothing re-stamps ingested_at afterwards (0121:562-565).
-- Running the body again re-stamps it. auth.guest_sessions.created_at is still an evidence source, a
-- web guest still passes the org.user_settings EXISTS guard through its foreign key, and every row
-- written here still takes ingested_at DEFAULT now(), so each web guest that minted a session on a
-- day not already covered gets one more row - one row per web guest per uncovered session day -
-- which moves its GREATEST(MAX(occurred_at), MAX(ingested_at)) to this run's instant and defers its
-- permanent deletion to this run + 90 days. Every replay does it again, including the third run this
-- header expects. Everything else 0121 argues there still holds: no guest is made un-reapable, none
-- is made reapable earlier, and the identity links 0120 wrote are untouched.
--
--
-- WHY IT RUNS AGAIN
--
-- Measured against production on 2026-09-03 through the reporting role:
--
--   * 0121 wrote app_opened rows for 2026-03-07 through 2026-08-28 inclusive and stops there by
--     design, because it writes nothing at or after the UTC day it runs on.
--   * The web client's first app_opened row is 2026-08-28 09:43 UTC. Android's is 2026-09-01
--     03:04 UTC and iOS's is 2026-09-01 06:59 UTC, which is the 1.24.0 store release.
--   * So 2026-08-29, 08-30 and 08-31 carry web rows only: 9, 13 and 9 distinct actors, against 41
--     and 42 on the two days before them.
--   * On those three days the admin dashboard shows fewer active people than reviewing people -
--     ratios 0.35, 0.46 and 0.33 - which cannot be true, because nobody answers a card without
--     opening the app. The two days before the gap sit at 1.41 and 1.45.
--   * 2026-09-01 and 09-02 are still under-reported at 0.84 and 1.27 while the store rollout
--     reaches devices.
--
-- Neither series is defective. This is the seam between a reconstruction that stopped at its own
-- run day and clients that started reporting after it, and 0121 was written to be re-run across
-- exactly that seam. Its two bounds are "nothing at or after the UTC day this file runs on" and
-- "nothing the app_opened series already holds", and the second is expressed against event_name
-- alone rather than origin = 'client' precisely so that a replay of the file falls under the same
-- invariant without anything being edited in a merged migration. Copying it is therefore the
-- whole change: logic that has already run correctly in production is worth more here than a
-- refactor into a shared callable object, which would be a new artifact to get right.
--
--
-- WHAT WINDOW THIS ACTUALLY FILLS
--
-- Exactly what the two bounds produce and nothing else: every person-day the app_opened series does
-- not already hold, that falls before the UTC day this file lands on. There is no lower bound in the
-- body at all. In practice that is the rollout gap, 2026-08-29 onward, because 0121 already wrote
-- every earlier day it had evidence for and its rows are app_opened rows carrying a user_id, so they
-- are collected into the existing-days temp table like any other and anti-joined away. Nothing at or
-- after the run day is written, because that day is partial and the clients report it themselves.
--
-- The absent floor also admits any older day whose evidence did not exist when 0121 ran, so expect
-- some pre-2026-08-29 rows under this run's backfill_id and read them as correct rather than as a
-- bound that failed. Two paths reach one:
--
--   * A content.review_events.reviewed_at_server row inserted since 0121 ran that carries a
--     client-supplied past timestamp - the offline-import path 0121 documents at 0121:42-54, where a
--     guest who studied offline for a month uploads that whole history at once.
--   * A sync.workspace_replicas row whose user_id was rewritten by re-registration since 0121, which
--     re-attributes that replica's existing hot changes, pushes and creation day to a new person;
--     0121's hot-changes branch names that mutability.
--
-- Filling a window that is still moving has one visible artifact: a client event queued on a day
-- this run reconstructs can arrive afterwards under a different platform or none, splitting that
-- actor across two platform series on that day in the admin section's (date, actor, platform)
-- grouping, while the set-based unique-actor and cohort numbers stay correct.
--
-- WHICH OF THE TWO MECHANISMS ACTUALLY PROTECTS THIS RUN: the anti-join, not the primary key. The
-- derived id is analytics.derive_server_event_id('app_opened', ARRAY[user_id, YYYY-MM-DD]) and
-- nothing about the run enters that vector - not backfill_id, not origin, not the file name - so a
-- person-day 0121 already wrote derives the identical event_id here and the closing
-- ON CONFLICT (event_id) DO NOTHING would discard it. That backstop is real, and it never fires,
-- because the anti-join drops the same row one predicate earlier. The event_id expression is kept
-- byte-identical to 0121's for exactly that reason and must stay that way in any later replay.
--
--
-- EXPECT A THIRD RUN
--
-- The store rollout is not finished. A person still on an older build emits no app_opened at all
-- and leaves only the indirect traces this reconstruction reads, so the days from 2026-09-01
-- onward stay under-counted until those builds are gone. The answer to that is another copy of
-- this file once the rollout has settled, not a wider bound here: there is no floor to widen, and a
-- later copy writes only what is still missing, because every day already covered is dropped by the
-- same anti-join. What that copy recovers is evidence that arrived after this run - a client that
-- finally reports, and the same two late-evidence paths listed above, offline review imports first
-- among them - and not a re-reading of a day this run already had the same evidence for, which
-- yields nothing.
--
--
-- WHAT THE FILLED DAYS ARE WORTH
--
-- Exactly what the rest of the pre-release series is worth and no more. These rows are not events
-- anybody observed. They are the union of the days on which some durable table still holds a
-- timestamp that could only have been written because a person was in a client, and on one sampled
-- day that union named about 85% of the people who really opened the app. Somebody who opened the
-- app, browsed and wrote nothing leaves no trace at all, so these days are a floor rather than a
-- count, and the dashboard should read them as one. The platform split is thinner still: across the
-- whole backfilled history 1983 of 7396 rows carry no platform, most of them days that rest on
-- auth.guest_sessions.created_at standing alone.
--
-- This run is separable from every other by backfill_id f1b12bb1-22f4-4e91-9a9d-824a36914e02,
-- distinct from 0121's 2b389b46-2215-4b2f-8e48-81a6499939a4 and 0120's
-- 139bd2f2-12b8-44c4-ad17-1081e5ed223f, and by details -> 'backfill'.

-- The session bounds this file runs under.
--
-- The migration runner wraps each file in BEGIN/COMMIT on a client that sets no timeout of its own
-- (apps/backend/src/database/migrationRunner.ts), and the migration Lambda's own timeout is 5
-- minutes (infra/aws/lib/migration-runner.ts:95). Without a server-side bound the failure mode of a
-- statement that runs long is the Lambda being killed at 300 seconds with the transaction still open
-- on the server, which the database only tears down when it eventually notices the connection is
-- gone. A clean SQL error is strictly better, so both bounds are set here, exactly as 0120 sets
-- them and for the same reasons.
--
-- statement_timeout is 240 seconds, chosen against that 300-second Lambda budget so 60 seconds are
-- left for the ROLLBACK and for the runner to report which file failed. What it bounds is a
-- statement and not this file. At the scale 0121 was measured against - about 124k
-- sync.hot_changes rows and about 40k content.review_events rows, collapsing to roughly 694
-- person-days over the 31 days sampled - the three sequential scans in the evidence union below run
-- in seconds. Everything after that is bounded on its own terms, and nothing in this file performs a
-- lookup once per person-day:
--
--   * The existing-app-opened-days temp table reads analytics.product_events once for a single
--     event_name, which idx_product_events_event_name_occurred_at (0119) leads on, and collapses to
--     one row per already-reported person-day.
--   * The DO block reads only the two temp tables plus one whole read of org.user_settings, which
--     it joins as a pre-aggregated set rather than probing per group. An earlier draft had that
--     read as an EXISTS in the target list of a grouped query, which PostgreSQL cannot pull up into
--     a semi-join the way it can from a WHERE: it became a correlated SubPlan re-executed once per
--     person-day, each execution a sequential scan of org.user_settings because
--     pg_catalog.lower(user_settings.user_id) defeats the primary-key index. The LEFT JOIN written
--     there now is that same set built once and hashed.
--   * The insert reads the two temp tables, anti-joins them, and keeps its account-deletion guard as
--     an EXISTS in the WHERE, where the planner is free to flatten it into a single hashed semi-join
--     over org.user_settings. That guard is deliberately left reading the live table rather than a
--     pre-materialized set, because materializing it earlier would move its snapshot earlier and
--     widen the account-deletion race the header accepts at exactly one statement wide.
--
-- So reaching this bound at all means the plan is wrong rather than that the bound is tight, and the
-- release should then fail with a 57014 naming the statement instead of with a Lambda timeout naming
-- nothing.
--
-- idle_in_transaction_session_timeout is 30 seconds. Every applier drives this file from a local
-- source and commits as soon as it ends, so this transaction is never legitimately idle for anything
-- close to that. The bound exists for the case where the client dies with the transaction still
-- open, so the server ends it on a timer instead of holding it until it notices.
--
-- Both are SET LOCAL so they revert at COMMIT and do not leak into the later migrations, the view
-- files or the admin grant statements that share this client.
SET LOCAL statement_timeout = '240s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- The union of every trace, collapsed to one row per person, UTC day, platform and evidence label.
--
-- It is materialized rather than written as a CTE inside the insert because three separate things
-- read it: the notices below, the grouping that decides each row's platform, and the insert itself.
-- A CTE would be re-planned per reference and the three large scans would run more than once. ON
-- COMMIT DROP is the same mechanism 0035, 0073 and 0078 use, and it is why every applier runs a
-- migration file inside one transaction (scripts/deploy/migrate.sh says so at its --single-
-- transaction flag).
--
-- The SELECT DISTINCT is what keeps this table small: the raw evidence rows, most of them from the
-- three large tables, collapse to a few thousand person-day-platform-source tuples, and everything
-- after this statement reads only those.
--
-- Two filters apply to the whole union rather than to any one branch.
--
-- The first drops any instant at or after this migration's own clock. It is the high half of the
-- first of the two bounds the header describes - the other half being the insert's own
-- occurred_on < today - and it doubles as an overflow guard: pg_catalog.date_trunc with
-- an explicit zone can raise "timestamp out of range" near the end of the timestamptz range, and a
-- raise here would abort the release. The truncation sits in the target list and this filter in the
-- WHERE, so the filter is applied first and the truncation only ever sees an instant in the past.
--
-- The second drops any instant equal to a public.schema_migrations.applied_at, which is how a
-- migration's own bulk write is told apart from a person's. The header says why that equality holds,
-- where it does not, and why it can only ever drop a row rather than invent one. Two independent
-- client transactions do not share a transaction-start instant to the microsecond, and if one ever
-- did, losing one piece of evidence for one person-day is the same undercount this file accepts
-- everywhere else.
--
-- Every branch lowers the id it selects and filters it through the canonical-UUID regex first. The
-- regex is the one apps/backend/src/guestAuth/reaper/index.ts:52 uses and it exists for the same
-- reason: these id columns are TEXT and a local AUTH_MODE=none database holds non-UUID ids in them,
-- which would fail the ::uuid cast in the insert below and take the whole release transaction with
-- them. On every deployed environment it excludes nothing. Because it runs here, every id in this
-- table is canonical hyphenated lowercase hex, so the cast in the insert cannot raise and the day
-- part of the derived id cannot vary in width.
--
-- The platform expression is one expression, written identically in all SIX branches that read a
-- replica, and the header justifies each of its arms. It reads sync.workspace_replicas.platform only
-- under actor_kind = 'client_installation' and it never reads that column for an agent connection.
-- The six are content.review_events, sync.hot_changes, sync.applied_operations_current,
-- sync.workspace_replicas.created_at, sync.workspace_replicas.last_seen_at and
-- sync.catalog_package_install_idempotency. That is one more than the five the header's platform
-- section counts, and both counts are right about different things: five branches take their PERSON
-- from a replica, while content.review_events takes its person from the row and joins the replica
-- only to reach a platform. Anybody auditing or editing this CASE has six copies to change.
CREATE TEMP TABLE migration_0126_app_open_evidence (
  user_id         TEXT        NOT NULL,
  occurred_on     TIMESTAMPTZ NOT NULL,
  platform        TEXT,
  evidence_source TEXT        NOT NULL
) ON COMMIT DROP;

INSERT INTO migration_0126_app_open_evidence (user_id, occurred_on, platform, evidence_source)
SELECT DISTINCT
  observations.user_id,
  pg_catalog.date_trunc('day', observations.observed_at, 'UTC'),
  observations.platform,
  observations.evidence_source
FROM (
  -- A graded answer. The person is the row's own reviewed_by_user_id and the replica is joined only
  -- to reach a platform, so a review whose replica is a backend actor still counts as a day.
  SELECT
    pg_catalog.lower(review_events.reviewed_by_user_id) AS user_id,
    review_events.reviewed_at_server AS observed_at,
    CASE
      WHEN replicas.actor_kind = 'client_installation'
        AND replicas.platform IN ('ios', 'android', 'web') THEN replicas.platform
      WHEN replicas.actor_kind = 'agent_connection' THEN 'agent'
      ELSE NULL
    END AS platform,
    'content.review_events.reviewed_at_server' AS evidence_source
  FROM content.review_events AS review_events
  LEFT JOIN sync.workspace_replicas AS replicas
    ON replicas.replica_id = review_events.replica_id
  WHERE review_events.reviewed_by_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  -- A mutable-root write, dated by a server clock. The person is the replica's label, which is
  -- mutable: apps/backend/src/sync/identity/replica.ts rewrites user_id on every re-registration, so
  -- a write from an install that later changed hands is dated to whoever holds it now. That is the
  -- same trade 0058:17-19 named and 0120 took for the same column, accepted here because no stored
  -- authorship exists for a hot change at all.
  SELECT
    pg_catalog.lower(replicas.user_id),
    hot_changes.recorded_at,
    CASE
      WHEN replicas.actor_kind = 'client_installation'
        AND replicas.platform IN ('ios', 'android', 'web') THEN replicas.platform
      WHEN replicas.actor_kind = 'agent_connection' THEN 'agent'
      ELSE NULL
    END,
    'sync.hot_changes.recorded_at'
  FROM sync.hot_changes AS hot_changes
  INNER JOIN sync.workspace_replicas AS replicas
    ON replicas.replica_id = hot_changes.replica_id
  WHERE replicas.actor_kind IN ('client_installation', 'agent_connection')
    AND replicas.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    -- 0073 and 0078 stamped their bulk repairs with a literal 'migration-...' operation_id. A client
    -- could in principle send one too, and dropping it would cost one uncounted write on a day the
    -- other sources almost certainly also name.
    AND hot_changes.operation_id NOT LIKE 'migration-%'

  UNION ALL

  -- A push batch operation, dated by an explicit server now(). Same actor and same trade as above.
  SELECT
    pg_catalog.lower(replicas.user_id),
    applied_operations.applied_at,
    CASE
      WHEN replicas.actor_kind = 'client_installation'
        AND replicas.platform IN ('ios', 'android', 'web') THEN replicas.platform
      WHEN replicas.actor_kind = 'agent_connection' THEN 'agent'
      ELSE NULL
    END,
    'sync.applied_operations_current.applied_at'
  FROM sync.applied_operations_current AS applied_operations
  INNER JOIN sync.workspace_replicas AS replicas
    ON replicas.replica_id = applied_operations.replica_id
  WHERE replicas.actor_kind IN ('client_installation', 'agent_connection')
    AND replicas.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  -- The first sync of that install into that workspace, and the last day it was confirmed active.
  -- Both are read off the same row, so both carry the same mutable-label caveat: the creation day of
  -- a replica that later changed hands is dated to its current owner. 0035 carried these two columns
  -- over from the legacy device rows rather than defaulting them, so no replica's created_at is the
  -- day that migration ran.
  SELECT
    pg_catalog.lower(replicas.user_id),
    replicas.created_at,
    CASE
      WHEN replicas.actor_kind = 'client_installation'
        AND replicas.platform IN ('ios', 'android', 'web') THEN replicas.platform
      WHEN replicas.actor_kind = 'agent_connection' THEN 'agent'
      ELSE NULL
    END,
    'sync.workspace_replicas.created_at'
  FROM sync.workspace_replicas AS replicas
  WHERE replicas.actor_kind IN ('client_installation', 'agent_connection')
    AND replicas.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  SELECT
    pg_catalog.lower(replicas.user_id),
    replicas.last_seen_at,
    CASE
      WHEN replicas.actor_kind = 'client_installation'
        AND replicas.platform IN ('ios', 'android', 'web') THEN replicas.platform
      WHEN replicas.actor_kind = 'agent_connection' THEN 'agent'
      ELSE NULL
    END,
    'sync.workspace_replicas.last_seen_at'
  FROM sync.workspace_replicas AS replicas
  WHERE replicas.actor_kind IN ('client_installation', 'agent_connection')
    AND replicas.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  -- A guest credential being minted. auth.guest_sessions.platform is the one stored platform column
  -- serverEvents.ts:57-60 calls safe to read directly, and its null for a pre-1.7.0 mobile client
  -- passes through as a null platform rather than as a guess.
  --
  -- auth.guest_sessions.last_seen_at is NOT read as a second branch here, for the reason the header
  -- gives: nothing ever updates it, so it is byte-identical to created_at on every row and would add
  -- no person-day, one more full scan of this table, and a permanent second evidence label in
  -- details for a trace the schema never wrote. Do not add it back.
  SELECT
    pg_catalog.lower(guest_sessions.user_id),
    guest_sessions.created_at,
    guest_sessions.platform,
    'auth.guest_sessions.created_at'
  FROM auth.guest_sessions AS guest_sessions
  WHERE guest_sessions.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  -- An account being created. No platform is stored anywhere on this path, so none is written.
  -- 0031's own backfill of this table for every pre-existing user took created_at from DEFAULT
  -- now(), which is why the schema_migrations filter below matters as much for this source as for
  -- the hot changes.
  SELECT
    pg_catalog.lower(user_identities.user_id),
    user_identities.created_at,
    NULL::TEXT,
    'auth.user_identities.created_at'
  FROM auth.user_identities AS user_identities
  WHERE user_identities.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  -- A guest merging into an account. Only the account side is taken: the guest side of a completed
  -- upgrade has no org.user_settings row and would be dropped by the guard below anyway, and this
  -- file's subject_user_id rule leaves no column for a second identity to live in.
  SELECT
    pg_catalog.lower(upgrades.target_user_id),
    upgrades.merged_at,
    NULL::TEXT,
    'auth.guest_upgrade_history.merged_at'
  FROM auth.guest_upgrade_history AS upgrades
  WHERE upgrades.target_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  -- An invite link created, and the same link consumed. Two people, two days, each read off the
  -- column that names them.
  SELECT
    pg_catalog.lower(invitations.inviter_user_id),
    invitations.created_at,
    NULL::TEXT,
    'community.friend_invitations.created_at'
  FROM community.friend_invitations AS invitations
  WHERE invitations.inviter_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  SELECT
    pg_catalog.lower(invitations.accepted_by_user_id),
    invitations.accepted_at,
    NULL::TEXT,
    'community.friend_invitations.accepted_at'
  FROM community.friend_invitations AS invitations
  WHERE invitations.accepted_at IS NOT NULL
    AND invitations.accepted_by_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  -- An in-app feedback prompt shown or dismissed, and feedback submitted. Both tables carry a
  -- NOT NULL platform constrained to ios, android and web (0052), reported by the client on a
  -- first-party route, which makes them the cleanest platform evidence in this file.
  SELECT
    pg_catalog.lower(prompt_events.user_id),
    prompt_events.created_at_server,
    prompt_events.platform,
    'support.feedback_prompt_events.created_at_server'
  FROM support.feedback_prompt_events AS prompt_events
  WHERE prompt_events.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  SELECT
    pg_catalog.lower(submissions.user_id),
    submissions.created_at_server,
    submissions.platform,
    'support.feedback_submissions.created_at_server'
  FROM support.feedback_submissions AS submissions
  WHERE submissions.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

  UNION ALL

  -- A catalog deck install committing. The replica is the one the install itself recorded, which is
  -- a proxy for the installing user rather than a stored authorship: install/persistence.ts
  -- validated it against the workspace and never against the user. Same trade as the hot changes.
  SELECT
    pg_catalog.lower(replicas.user_id),
    installs.completed_at,
    CASE
      WHEN replicas.actor_kind = 'client_installation'
        AND replicas.platform IN ('ios', 'android', 'web') THEN replicas.platform
      WHEN replicas.actor_kind = 'agent_connection' THEN 'agent'
      ELSE NULL
    END,
    'sync.catalog_package_install_idempotency.completed_at'
  FROM sync.catalog_package_install_idempotency AS installs
  INNER JOIN sync.workspace_replicas AS replicas
    ON replicas.replica_id = installs.last_modified_by_replica_id
  WHERE replicas.actor_kind IN ('client_installation', 'agent_connection')
    AND replicas.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
) AS observations
WHERE observations.observed_at < pg_catalog.now()
  AND NOT EXISTS (
    SELECT 1
    FROM public.schema_migrations AS migrations
    WHERE migrations.applied_at = observations.observed_at
  );

-- Every (person, UTC day) the app_opened series already holds.
--
-- This is the second of the two bounds the header describes, and it is the one that keeps this
-- reconstruction out of the way of the live client series. The clients emit app_opened with their
-- own UUIDv7 ids, so ON CONFLICT (event_id) cannot suppress an overlap, and analytics.product_events
-- is append-only with no repair path: a person-day written on both sides is counted twice forever.
--
-- It is a per-person-day set rather than a date floor on purpose. A floor would have to be derived
-- from a timestamp, and the only timestamps available are either client-influenced or so
-- conservative that they would delete a month of real history for everybody to suppress a handful of
-- duplicates. Comparing a person-day against the same person-day has no boundary to move: a client
-- row can only ever suppress the one reconstructed day it actually names.
--
-- event_name alone is the filter, not event_name with origin = 'client'. The invariant this file
-- holds is one app_opened row per person and UTC day whatever wrote it, so a future server-derived
-- producer, or a replay of this file itself, is covered by the same predicate. Restricting to
-- origin = 'client' would be a narrower claim with nothing to gain from it.
--
-- user_id is a UUID column here and TEXT in the evidence table above. uuid_out renders canonical
-- lowercase hyphenated hex, which is exactly the shape the regexes above guarantee every evidence id
-- has, so ::text puts both sides in one comparable space; pg_catalog.lower is applied anyway so the
-- two tables read identically and neither drifts if one side's derivation changes. A NULL user_id -
-- the column is nullable - names nobody and is dropped rather than stored, which is also what the
-- NOT NULL column below requires.
--
-- The primary key is what makes the anti-join below cheap regardless of which plan the planner
-- picks, and it is safe because SELECT DISTINCT already produces exactly one row per pair.
CREATE TEMP TABLE migration_0126_existing_app_opened_days (
  user_id     TEXT        NOT NULL,
  occurred_on TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, occurred_on)
) ON COMMIT DROP;

INSERT INTO migration_0126_existing_app_opened_days (user_id, occurred_on)
SELECT DISTINCT
  pg_catalog.lower(reported_events.user_id::text),
  pg_catalog.date_trunc('day', reported_events.occurred_at, 'UTC')
FROM analytics.product_events AS reported_events
WHERE reported_events.event_name = 'app_opened'
  AND reported_events.user_id IS NOT NULL;

-- What this file leaves out, measured rather than assumed, and announced rather than left silent.
--
-- Nothing below branches on these counts and nothing raises. A raise here aborts the release's
-- migration run, so a RAISE EXCEPTION would not cost a rerun - it would block AWS/Web Release, and
-- every unrelated change riding it, until somebody edited a merged migration file or hand-inserted
-- a schema_migrations row, both out-of-band database operations this repository's CI/CD-only rule
-- forbids and neither of them something a rerun can do for itself.
-- Every condition measured here is also permanent rather than transient: a day is either before this
-- migration's own day or it is not, and an account is either gone or it is not, so a retry would
-- find the same thing. Skipping and reporting is the only response that makes sense.
--
-- PostgreSQL sends a notice to the client rather than to any log a release could read afterwards,
-- and node-postgres drops one that nothing listens for, so the migration client subscribes to the
-- 'notice' event and writes each one to stdout, which is the migration Lambda's CloudWatch log, as a
-- database_migration_notice record carrying the name of the file that raised it
-- (apps/backend/src/database/migrationRunner.ts). 0120 added that subscription.
--
-- These are counts of person-days as the temp tables' snapshots have them, and this block and the
-- insert below take separate snapshots of org.user_settings, so an account that disappears between
-- them makes the second count under-report by one. The counts are an operator signal.
--
-- The five filters below are mutually exclusive rather than five independent questions: each one
-- excludes the reasons above it, in the order the insert applies them, so no day is reported under
-- two headings.
--
-- They are NOT a partition of the temp table and they do NOT sum to its person-day total. The one
-- bucket they leave uncounted is the largest and is most of what this file writes: a day that is
-- before today, that the app_opened series does not already report, whose person is live, and whose
-- evidence names exactly one platform - in other words every row written carrying a platform. So the
-- two 'Writing' notices count only the platform-free and platform-conflict rows, not everything this
-- file wrote, and an operator must not add the five counts together and expect the candidate total,
-- nor add the two 'Writing' counts and expect the written total. What the notices do support is
-- subtraction: the three withheld/skipped counts are exactly the candidate days the insert's three
-- predicates drop, so the written total is the temp table's person-day count minus those three, as
-- the snapshots above have them. The written total is also readable directly and exactly, and that
-- is the answer to prefer: count(*) over analytics.product_events where
-- backfill_id = 'f1b12bb1-22f4-4e91-9a9d-824a36914e02'.
--
-- person_is_live is a LEFT JOIN and not an EXISTS in the target list, which is a correctness-shaped
-- performance decision worth stating. PostgreSQL can pull an EXISTS in a WHERE up into a semi-join;
-- it cannot do that from a target list, so an EXISTS there becomes a correlated SubPlan re-executed
-- once per person-day group, each execution a sequential scan of org.user_settings because
-- pg_catalog.lower(user_settings.user_id) defeats the primary-key index. Joined this way, the
-- lowered live-id set is built once and hashed. The DISTINCT inside it is what keeps the join from
-- multiplying a person-day: two settings rows differing only in hex case fold to one id.
DO $$
DECLARE
  withheld_recent_day_count BIGINT;
  already_reported_day_count BIGINT;
  departed_person_day_count BIGINT;
  platform_free_day_count BIGINT;
  platform_conflict_day_count BIGINT;
BEGIN
  SELECT
    pg_catalog.count(*) FILTER (WHERE NOT candidate_days.is_before_today),
    pg_catalog.count(*) FILTER (
      WHERE candidate_days.is_before_today
        AND candidate_days.is_already_reported
    ),
    pg_catalog.count(*) FILTER (
      WHERE candidate_days.is_before_today
        AND NOT candidate_days.is_already_reported
        AND NOT candidate_days.person_is_live
    ),
    pg_catalog.count(*) FILTER (
      WHERE candidate_days.is_before_today
        AND NOT candidate_days.is_already_reported
        AND candidate_days.person_is_live
        AND candidate_days.distinct_platform_count = 0
    ),
    pg_catalog.count(*) FILTER (
      WHERE candidate_days.is_before_today
        AND NOT candidate_days.is_already_reported
        AND candidate_days.person_is_live
        AND candidate_days.distinct_platform_count > 1
    )
  INTO STRICT
    withheld_recent_day_count,
    already_reported_day_count,
    departed_person_day_count,
    platform_free_day_count,
    platform_conflict_day_count
  FROM (
    SELECT
      grouped_days.occurred_on
        < pg_catalog.date_trunc('day', pg_catalog.now(), 'UTC') AS is_before_today,
      grouped_days.distinct_platform_count,
      live_people.user_id IS NOT NULL AS person_is_live,
      reported.user_id IS NOT NULL AS is_already_reported
    FROM (
      SELECT
        evidence.user_id,
        evidence.occurred_on,
        -- count(DISTINCT ...) ignores nulls, so this is the number of platforms the evidence for
        -- this person-day actually names, and the insert below writes one only when it is exactly
        -- one.
        pg_catalog.count(DISTINCT evidence.platform) AS distinct_platform_count
      FROM migration_0126_app_open_evidence AS evidence
      GROUP BY evidence.user_id, evidence.occurred_on
    ) AS grouped_days
    LEFT JOIN (
      SELECT DISTINCT pg_catalog.lower(user_settings.user_id) AS user_id
      FROM org.user_settings AS user_settings
    ) AS live_people
      ON live_people.user_id = grouped_days.user_id
    LEFT JOIN migration_0126_existing_app_opened_days AS reported
      ON reported.user_id = grouped_days.user_id
      AND reported.occurred_on = grouped_days.occurred_on
  ) AS candidate_days;

  IF withheld_recent_day_count > 0 THEN
    RAISE NOTICE
      'Withheld % reconstructed person-day(s) that fall on or after this migration''s own UTC day. That day is still in progress, so a row for it would understate itself permanently on an append-only table, and the clients are already reporting it themselves. Those days belong to the client series instead.',
      withheld_recent_day_count;
  END IF;

  IF already_reported_day_count > 0 THEN
    RAISE NOTICE
      'Withheld % reconstructed person-day(s) that the app_opened series already reports for the same person on the same UTC day. The clients emit app_opened with their own UUIDv7 ids, so ON CONFLICT (event_id) could not have suppressed these and both rows would have been stored and counted twice, permanently. Nothing is lost: those days are present already, as the rows that reported them.',
      already_reported_day_count;
  END IF;

  IF departed_person_day_count > 0 THEN
    RAISE NOTICE
      'Skipped % reconstructed person-day(s) because no live org.user_settings row names that person. That is an account whose deletion already anonymized its analytics history and must not be re-identified, or a guest whose upgrade deleted its settings row, whose guest-phase days are lost with it.',
      departed_person_day_count;
  END IF;

  IF platform_free_day_count > 0 THEN
    RAISE NOTICE
      'Writing % reconstructed person-day(s) with no platform because no evidence for that day records one. Nothing is skipped: the day is still a fact and null is the correct answer for a producer that cannot justify a value.',
      platform_free_day_count;
  END IF;

  IF platform_conflict_day_count > 0 THEN
    RAISE NOTICE
      'Writing % reconstructed person-day(s) with no platform because the evidence for that day names more than one, which is a person who used more than one client that day. One row cannot carry two platforms and choosing between them would be an invention, so the column is left null.',
      platform_conflict_day_count;
  END IF;
END
$$;

-- One row per person and UTC day.
--
-- The grouping decides three things. The event_id is derived from the two fixed-shape parts the
-- header describes, so two traces of one day collapse into one row. The platform is written only
-- when every trace that names one names the same one - count(DISTINCT ...) and min(...) both ignore
-- nulls, so a count of exactly one means one platform was named and min is that value. And the
-- evidence labels are aggregated into details, sorted so the array is stable across replays and
-- deduplicated so a person-day supported by four hot changes names sync.hot_changes once.
--
-- Three predicates stand between this and a wrong row.
--
-- occurred_on < the migration's own UTC day withholds the day this file runs on and everything after
-- it. That day is partial and its evidence is still being written, and the clients are reporting it
-- themselves.
--
-- The NOT EXISTS against migration_0126_existing_app_opened_days is what separates this series from
-- the live one, and it is the predicate the header calls load-bearing. The client app_opened series
-- is already running - the web app has been emitting it since it shipped - so a date bound alone
-- would write a second row for days the clients already cover, on ids that share no space with
-- theirs and therefore on a table where ON CONFLICT (event_id) cannot help. Anti-joining the exact
-- (person, UTC day) pair drops precisely the overlapping days and keeps every day the clients did
-- not report, which is most of them. It reads a snapshot, so a client row that arrives after this
-- statement can still land on a reconstructed day; the header bounds that residual at the ingest
-- route's own 30-day occurred_at window and says why it is accepted.
--
-- The EXISTS on org.user_settings is the account-deletion guard, and it covers every evidence source
-- at once because every source ends up in the one id this statement writes into user_id and
-- subject_user_id. It folds case on both sides because the union mixes columns that are foreign keys
-- to org.user_settings with columns that carry no foreign key at all, and the unconstrained ones may
-- hold either hex case; folding one that a foreign key already made byte-identical changes nothing.
-- It is a best-effort read under this statement's own READ COMMITTED snapshot and not a guarantee:
-- nothing here locks org.user_settings, for the reason the header gives at length, so a deletion
-- committing after this read and before COMMIT leaves these rows written with a real id and nothing
-- later re-checks them. That residual is the one the header names.
--
-- ::uuid on the id cannot raise: every row of the temp table passed the canonical-UUID regex on the
-- way in. That is a stronger position than 0120 was in, where the regex and the cast lived in the
-- same statement and the argument had to be about which the planner evaluates first.
INSERT INTO analytics.product_events (
  event_id,
  schema_version,
  event_name,
  origin,
  backfill_id,
  server_received_at,
  occurred_at,
  user_id,
  subject_user_id,
  trust_level,
  platform,
  event_properties,
  details
)
SELECT
  analytics.derive_server_event_id(
    'app_opened',
    ARRAY[
      reconstructed_days.user_id,
      pg_catalog.to_char(pg_catalog.timezone('UTC', reconstructed_days.occurred_on), 'YYYY-MM-DD')
    ]
  ),
  1,
  'app_opened',
  'backfill',
  'f1b12bb1-22f4-4e91-9a9d-824a36914e02'::uuid,
  reconstructed_days.occurred_on,
  reconstructed_days.occurred_on,
  reconstructed_days.user_id::uuid,
  reconstructed_days.user_id::uuid,
  'backfill_derived',
  reconstructed_days.platform,
  -- The catalog requires launch_type on every app_opened row and admits 'unknown' for exactly this
  -- case (apps/backend/src/productAnalytics/catalog.ts:202-213). A reconstructed day cannot know
  -- cold from warm and the property stays present so that is a stored fact rather than an absent key
  -- indistinguishable from a client that failed to send one.
  pg_catalog.jsonb_build_object('launch_type', 'unknown'),
  pg_catalog.jsonb_build_object(
    'backfill', '0126_backfill_app_opened_rollout_gap',
    -- No date is written here. ingested_at records when this backfill ran, and a hardcoded day would
    -- be a false claim on every row the moment the release lands on a different one.
    'note', 'Reconstructed app-open day, not an event a client reported. Written by migration 0126 from durable production traces; on one sampled day this union recovered about 85% of the people who really opened the app. evidence names every trace that placed this person on this day.',
    'evidence', pg_catalog.to_jsonb(reconstructed_days.evidence_sources)
  )
FROM (
  SELECT
    evidence.user_id,
    evidence.occurred_on,
    CASE
      WHEN pg_catalog.count(DISTINCT evidence.platform) = 1
        THEN pg_catalog.min(evidence.platform)
      ELSE NULL
    END AS platform,
    pg_catalog.array_agg(
      DISTINCT evidence.evidence_source ORDER BY evidence.evidence_source
    ) AS evidence_sources
  FROM migration_0126_app_open_evidence AS evidence
  GROUP BY evidence.user_id, evidence.occurred_on
) AS reconstructed_days
WHERE reconstructed_days.occurred_on < pg_catalog.date_trunc('day', pg_catalog.now(), 'UTC')
  AND NOT EXISTS (
    SELECT 1
    FROM migration_0126_existing_app_opened_days AS reported
    WHERE reported.user_id = reconstructed_days.user_id
      AND reported.occurred_on = reconstructed_days.occurred_on
  )
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE pg_catalog.lower(user_settings.user_id) = reconstructed_days.user_id
  )
ON CONFLICT (event_id) DO NOTHING;
