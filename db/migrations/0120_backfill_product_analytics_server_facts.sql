-- Migration status: Current / one-time backfill.
-- Introduces: the historical rows of analytics.product_events for the eight facts the backend
--   observes itself, reconstructed from the production tables that already hold them, plus the
--   analytics.identity_links rows for the guest upgrades that happened before the live producers
--   shipped.
-- Schemas touched/read explicitly: ai, analytics, auth, catalog, community, content, org, sync,
--   pg_catalog.
--
-- 0119 deleted every row this table held, because all of them were written under the pre-revision
-- event catalog, and it created analytics.derive_server_event_id so a backfill written in SQL could
-- put the history back. This is that backfill.
--
--
-- WHY THIS IS SAFE TO RUN BEFORE, AFTER OR ACROSS THE LIVE PRODUCERS' DEPLOY
--
-- Every event_id below comes from analytics.derive_server_event_id with exactly the key parts the
-- merged live producer passes to deriveServerDerivedProductAnalyticsEventId for the same fact. A
-- fact this migration reconstructs that the live stream also reported therefore lands on the same
-- primary key and is stored once, not twice, on a table whose only rewrite is the account
-- anonymization UPDATE described below - the single UPDATE 0114's own table comment permits - and
-- never a rewrite of the facts themselves. Each of the seven analytics.product_events inserts below
-- ends in ON CONFLICT (event_id) DO NOTHING, so the live row wins and this one disappears. The
-- eighth insert of this file writes analytics.identity_links, a different table on a different key,
-- and ends in ON CONFLICT (anonymous_id, user_id) DO UPDATE; it says so where it stands. No
-- statement of this file removes a row from either table.
--
-- The key parts, each copied from the producer named beside it, are:
--   review_answered          [review_event_id]
--                            apps/backend/src/productAnalytics/reviewAnswers.ts:210
--   card_created             [card_id]
--                            apps/backend/src/productAnalytics/contentCreations.ts:140
--   deck_created             [deck_id]
--                            apps/backend/src/productAnalytics/contentCreations.ts:140
--   friend_invitation_created [friend_invitation_id]
--                            apps/backend/src/community/analytics.ts:34-37
--   friendship_created       [friend_invitation_id, viewer_user_id]
--                            apps/backend/src/community/analytics.ts:94-97
--   catalog_deck_installed   [workspace_id, install_id]
--                            apps/backend/src/catalog/distribution/install/index.ts:421-424
--   ai_message_sent          [workspace_id, run_id]
--                            apps/backend/src/chat/runs/analytics.ts:28
--   guest_upgrade_completed  [guest_session_id]
--                            apps/backend/src/guestAuth/index.ts:166-169
--
-- A NULL element inside key_parts is rendered as the empty string by the three-argument
-- array_to_string 0119 uses, exactly as Array.prototype.join does on the TypeScript side, and there
-- is no length prefix between parts. Two different source rows whose key parts differ only in a NULL
-- would therefore derive one id, and the second of them would be lost for good. Every key part fed
-- to the function below is NOT NULL at the schema level, so that cannot happen here:
--   content.review_events.review_event_id                is the table's PRIMARY KEY (0001).
--   sync.hot_changes.entity_id                           is NOT NULL (0028); one row per entity is
--                                                        selected, so the id is unique by
--                                                        construction.
--   community.friend_invitations.friend_invitation_id    is the table's PRIMARY KEY (0063).
--   community.friendships.created_from_invitation_id     is UUID NOT NULL with a foreign key (0063),
--                                                        so the empty-string degradation this
--                                                        producer looks most exposed to is not
--                                                        reachable at all; viewer_user_id is NOT
--                                                        NULL as half of the PRIMARY KEY. The pair
--                                                        carries no uniqueness constraint of its
--                                                        own, so it is measured and reported below
--                                                        instead.
--   sync.catalog_package_install_idempotency             (workspace_id, install_id) is the table's
--                                                        PRIMARY KEY (0106).
--   ai.chat_runs.run_id                                  is the table's PRIMARY KEY (0033), and the
--                                                        workspace part is the NOT NULL
--                                                        ai.chat_sessions.workspace_id (0032)
--                                                        reached through the run's NOT NULL
--                                                        session_id foreign key.
--   auth.guest_upgrade_history.source_guest_session_id   is NOT NULL (0034) and carries a UNIQUE
--                                                        index (0040).
--
--
-- WHY NO ROW BELOW CARRIES A PLATFORM
--
-- Not an omission, and not a hazard being dodged: every one of the eight live producers passes
-- platform: null, so a backfilled row that named one would disagree with the live stream on the
-- column it is hardest to correct afterwards. The producers' own reasons are recorded at
-- reviewAnswers.ts:239-247, contentCreations.ts:169-178, community/analytics.ts:51-56 and 108-111,
-- catalog/distribution/install/index.ts:435-437, chat/runs/analytics.ts:36-38, and
-- guestAuth/index.ts:179-182, and they all reduce to the invariant on
-- ServerDerivedProductAnalyticsEvent: sync.workspace_replicas.platform may never be read without
-- actor_kind on the same row, because an agent_connection replica stores 'web' for the machine API,
-- an ai_chat replica stores a hardcoded 'web' that describes no device, and workspace_seed and
-- workspace_reset store 'system'. This migration reads that table only for its user_id column,
-- never for platform.
--
--
-- ACCOUNT DELETION IS ONE-WAY AND NOTHING BELOW MAY UNDO IT
--
-- apps/backend/src/auth/accountDeletion.ts anonymizes a departed person's analytics history rather
-- than erasing it: it rewrites user_id and subject_user_id to a pseudonym it stores nowhere, clears
-- guest_session_id, workspace_id and every other joinable column, sets identity_state to
-- 'anonymized', deletes every analytics.identity_links row whose user_id is one of the person's
-- ids, and deletes their org.user_settings row. That link deletion is keyed on user_id and on
-- nothing else (DELETE FROM analytics.identity_links WHERE user_id = ANY($1::uuid[]),
-- accountDeletion.ts:199-201), so a link that carries one of the person's guest ids as its
-- anonymous_id under some other account's user_id survives it - a shape
-- apps/backend/src/productAnalytics/writer.ts:106-108 describes and this file's own ambiguous-source
-- case reaches. The narrower statement is the one everything below relies on. Its own comments state
-- why the deletion is final: no mapping survives anywhere, and anonymization "runs once and can
-- never be reapplied".
--
-- Several of the tables read below outlive that deletion still carrying the person's real ids.
-- auth.guest_upgrade_history is append-only and its id columns are bare TEXT and UUID with no
-- foreign key of any kind (0034), which is exactly the threat accountDeletion.ts documents at its
-- loadAnalyticsUserIdsForPersonInExecutor: a reader joining those surviving rows back to the
-- deleted account. sync.workspace_replicas.user_id is likewise plain TEXT with no foreign key
-- (0035), and account deletion removes only sole-member workspaces, so a shared workspace that
-- outlives one member keeps that member's real id on its replica rows. Writing either into a fresh
-- row here - on an append-only table with no repair path, after the deletion sweep has already run
-- for the last time - would re-create precisely what the deletion removed, and re-inserting the
-- identity link would make the pseudonymization reversible again.
--
-- What stands between that and the rows below is an EXISTS against the live org.user_settings on the
-- id each statement is about to write. It is a best-effort read, not a guarantee, and this section
-- states the residual it leaves rather than claiming a stronger property than the file has.
--
-- THE RESIDUAL, PLAINLY. Nothing below locks org.user_settings. The backend Lambda keeps serving
-- throughout AWS/Web Release - only the reconciliation schedule is gated
-- (.github/workflows/aws-web-release.yml) - so DELETE /account runs in its own transaction while
-- this file runs. Each guard reads org.user_settings under its own READ COMMITTED snapshot, so a
-- deletion that commits after that read and before this file's COMMIT is invisible to it, and the
-- rows this file wrote for that person survive carrying their real user_id, subject_user_id,
-- guest_session_id and workspace_id, with the anonymization sweep already past. The exposure for a
-- given row runs from its own statement's snapshot to this file's COMMIT, so the earliest writes
-- below are exposed for almost the whole file and the last for almost none of it. That is the shape
-- for analytics.product_events and analytics.identity_links alike: nothing re-reads either
-- afterwards, and no statement of this file deletes from either. Only the links have an out-of-band
-- remedy if this is ever hit, and it is stated where that insert stands; analytics.product_events
-- has none, which is why every statement below guards before it writes rather than after. Each is
-- said again where it happens.
--
-- WHY THAT RESIDUAL IS ACCEPTED. The alternative that closes the race is recorded here in full, so
-- it is not re-proposed later as an improvement. Materializing the live ids under a whole-table
-- FOR KEY SHARE does close it, and simultaneously blocks every authenticated request for as long
-- as this migration runs. loadAuthenticatedRequestContext calls ensureCognitoUserProfileFn or
-- ensureUserProfileFn on every authenticated request on both transports
-- (apps/backend/src/server/requestContext.ts:148-150), and both reach
-- INSERT INTO org.user_settings ... ON CONFLICT (user_id) DO UPDATE
-- (apps/backend/src/auth/ensureUser.ts:44-51) followed by SELECT ... WHERE user_id = $1 FOR UPDATE
-- on the same row (ensureUser.ts:62-68). ON CONFLICT DO UPDATE takes LockTupleExclusive on the
-- conflicting row before its WHERE is evaluated and the following FOR UPDATE settles it regardless;
-- both conflict with FOR KEY SHARE. The auth service holds the same upsert
-- (apps/auth/src/server/agent/userWorkspace.ts:27-34), and workspace creation, selection and
-- management each take FOR UPDATE on the same row through
-- lockUserSettingsForWorkspaceLifecycleInExecutor (apps/backend/src/workspaces/state.ts:26-39).
-- Every one of those requests would wait and then fail 55P03 once its own lock_timeout fired
-- (apps/backend/src/database/deadline.ts). A certain authenticated-API outage on every release
-- carrying this migration is a worse defect than the race it closes, so the race is accepted and no
-- lock is taken. Locking only the ids this backfill touches is not the answer either: a person whose
-- id is in the backfill would still block on their own request, which is the same class of harm in a
-- narrower window at much higher complexity.
--
-- WHAT THIS FILE BLOCKS ANYWAY. Everything above is about the locks these statements do not take
-- while reading. There is one they do take, and it belongs in the same discussion. The identity link
-- insert at the end of this file ends in ON CONFLICT (anonymous_id, user_id) DO UPDATE, which takes
-- LockTupleExclusive on every pre-existing conflicting analytics.identity_links row before its WHERE
-- is evaluated - the same mechanic the paragraph above cites for ensureUser.ts - and holds those row
-- locks until this file's COMMIT. A concurrent DELETE /account whose
-- DELETE FROM analytics.identity_links WHERE user_id = ANY(...) reaches one of them therefore waits,
-- and then fails 55P03 once its own lock_timeout fires (apps/backend/src/database/deadline.ts).
--
-- That is a far smaller thing than the whole-table FOR KEY SHARE rejected above, and the difference
-- is the reason it is kept rather than an excuse for it: this takes at most the link rows of the
-- guest upgrades this backfill re-observes, only from that one statement to COMMIT, and only against
-- an account deletion, which is rare - where the rejected lock took every row of org.user_settings
-- for the whole file and failed every authenticated request. It is written down because a file that
-- spends this much text on the locks it does not take should not be silent about the one it does.
--
-- Each statement below still says which mechanism keeps it deletion-aware:
--
--   * The source row is already gone, because the column naming the person is a foreign key to
--     org.user_settings with ON DELETE CASCADE, so the row cannot be read at all.
--     content.review_events.reviewed_by_user_id is the ON DELETE SET NULL variant of the same
--     thing, and a NULL there fails the regex its statement filters on, so it drops out too. Those
--     statements carry the EXISTS as well, because a cascade only proves the deletion happened
--     before that statement's snapshot and says nothing about one that commits after it.
--   * The source row survives the deletion, so the statement requires the account to still exist,
--     with EXISTS (SELECT 1 FROM org.user_settings ...) on the id it is about to write. That is the
--     same guard 0058:25-29 applied when it backfilled review authorship from the same replica label
--     this file also reads.
--
-- Where that guard sits on a guest upgrade it keys on target_user_id alone and never on
-- source_guest_user_id. The guest side of a completed upgrade is always absent from
-- org.user_settings, deleted account or not: phase 12 of the merge calls
-- cleanupGuestSessionSourceInExecutor (apps/backend/src/guestAuth/upgrade/index.ts:617), which
-- deletes the guest's settings row (apps/backend/src/guestAuth/delete/index.ts:52) inside the
-- merge's own transaction. Requiring the guest to exist would suppress every historical
-- guest_upgrade_completed row and every identity link, which is the whole of what this file is for.
--
--
-- HOW THAT GUARD COMPARES IDS
--
-- org.user_settings.user_id is TEXT (0001:27) and so is every id column read below, but they do not
-- all reach it the same way, and the guards differ for that reason rather than by accident.
-- content.review_events.reviewed_by_user_id, community.friend_invitations.inviter_user_id,
-- community.friendships.viewer_user_id and ai.chat_sessions.user_id are foreign keys to
-- org.user_settings, so each is byte-identical to the row it references and raw equality is exact
-- there. sync.workspace_replicas.user_id (0035:23) and auth.guest_upgrade_history.target_user_id
-- (0034:9) carry no foreign key of any kind, so nothing in the schema makes them byte-identical to
-- anything, and their guards compare through pg_catalog.lower.
--
-- That is the same case folding the identity link predicates further down use, under the same single
-- premise this file settles on: an unconstrained TEXT id column may hold either hex case, and every
-- predicate reading one has to fold. It is not defensive decoration. The value these statements
-- write is the id cast to UUID, and account deletion matches its rows in that same UUID space
-- (WHERE user_id = ANY($2::uuid[]), accountDeletion.ts:177-195), so the question the guard must
-- answer is whether a live account exists with that UUID, not with that byte string. On a value the
-- regex beside it has already proved is canonical hyphenated hex, pg_catalog.lower is exactly
-- ::uuid::text; folding is used instead of the cast because a cast the planner may evaluate before
-- that regex would abort the whole release on the first non-UUID id a local AUTH_MODE=none database
-- holds. Raw equality on those two columns would silently drop an uppercase-hex id instead - no row,
-- no link, and no notice, since the guard's failure is indistinguishable from the account being
-- gone.
--
-- The cost of all this is an undercount: a deleted person's reviews, creations and installs get no
-- row at all. That is the trade this schema makes everywhere else - a missing row leaves a fact
-- uncounted, a wrong one is permanent - and here the wrong row would also be a privacy regression.
--
-- The account deletion sweep imposes one more rule on every row below: no person may be reachable
-- only through subject_user_id. anonymizeProductAnalyticsInExecutor selects the rows to rewrite with
-- WHERE user_id = ANY($2::uuid[]) and then rewrites subject_user_id blind
-- (accountDeletion.ts:177-195), so a subject_user_id naming an id that never appears in user_id
-- would outlive a deletion the sweep believed it had covered.
--
-- Four of the statements below satisfy that the simple way, by writing one actor into both columns,
-- which is also what their live producers do. Two - the friend invitation and the friendship - write
-- no subject_user_id at all, matching their producers, and have nothing to satisfy. The remaining
-- one, guest_upgrade_completed, pairs the account in user_id with the guest id in subject_user_id,
-- which looks like the shape the rule forbids and is in fact the shape the sweep is built for:
-- accountDeletion.ts:171-175 names that exact row, and the recursive walk over
-- auth.guest_upgrade_history at loadAnalyticsUserIdsForPersonInExecutor has already collected that
-- guest id into the id set the match is made on, so the row is swept by its user_id like any other.
--
--
-- WHAT IS NOT RECONSTRUCTED, AND WHY
--
--   * card_updated and deck_updated. The content producer emits creations only, on purpose
--     (contentCreations.ts:35-44), so there is no live series for a backfill to extend.
--   * Client-origin events. The single day 0119 deleted is not recoverable from any production
--     table and is not attempted.
--   * Entities created before sync.hot_changes existed (0028) have no creation row in that log and
--     are simply absent here; no row is invented for them from content.cards or content.decks. The
--     other half of that boundary is worth naming too: an entity that predates the log and was
--     written again afterwards has an update as the oldest row the log holds for it, and no stored
--     column separates that from a creation, so its reconstructed creation carries the date of that
--     later write.
--
--     One concrete cohort dominates that second case and will show up as a spike, so it is named
--     here rather than left to be rediscovered. db/migrations/0073_card_effort_tag_backfill.sql:
--     130-165 inserted one 'card' or 'deck' hot change per entity it touched, carrying
--     operation_id LIKE 'migration-0073-effort-tag-%' and recorded_at left to its DEFAULT now(),
--     which is 0073's own run. For every card and deck whose only earlier hot change predates 0028
--     or was never written, that 0073 row is now the oldest the log holds and becomes the
--     reconstructed creation. Those entities' client_updated_at is almost always more than 720 hours
--     before 0073 ran, so the CASE below falls back to recorded_at and the whole cohort lands on the
--     single day 0073 was applied. That is not corrected here and cannot be corrected later: the
--     data that would date those creations properly exists nowhere, and analytics.product_events has
--     no repair path, so the spike is permanent and this paragraph is its explanation.
--   * Guest upgrades that completed bound - where the guest user id already was the account id -
--     write no auth.guest_upgrade_history row at all (guestAuth/index.ts:122-124), so their
--     guest_upgrade_completed events cannot be reconstructed and no link is owed for them either.
--   * The cards a catalog install writes, and the cards a guest merge re-inserts into the target
--     workspace. Both leave sync.hot_changes rows that are not authoring; the creations statement
--     below says what each one is and why it is dropped.
--   * Anything a deleted account produced. The section above says why and by which mechanism each
--     statement drops it.
--   * app_opened. It belongs to the separate synthetic-days backfill and is deliberately untouched.
--
--
-- EVERY analytics.product_events ROW BELOW
--
-- carries origin = 'backfill', trust_level = 'backfill_derived' - both admitted by
-- product_events_origin_valid and product_events_trust_level_valid (0114) - and the one backfill_id
-- of this run, which product_events_backfill_id_shape requires exactly for that origin. The id is a
-- literal rather than gen_random_uuid() so every environment this file replays on names the run by
-- the same value.
--
-- details is the first non-NULL write of that column anywhere. It is bounded by
-- product_events_details_shape (0119) to a JSON object under 2000 bytes measured on the jsonb text
-- rendering, and by product_events_details_client_shape to origin <> 'client', which holds here. The
-- objects written below are two short keys naming the run and the production relation the fact came
-- from, well inside that bound, and they carry nothing that identifies a person, which is the rule
-- 0119's column comment states and which matters because this column survives account anonymization
-- untouched.
--
-- client_occurred_at, client_sent_at, session_id and anonymous_id stay NULL on every row, which
-- product_events_client_columns_shape (0114) requires for any origin but 'client'.
--
-- The eighth insert of this file writes analytics.identity_links, a different table that has none
-- of these columns; it says what it writes where it stands.
--
--
-- TIMESTAMPS
--
-- server_received_at on a live row is Node's clock read after the product transaction COMMITted,
-- while sync.hot_changes.recorded_at defaults to now(), which in PostgreSQL is the transaction's
-- START. They are not the same instant and differ by the whole transaction, so nothing here joins,
-- dedupes or compares a backfilled row against a live one on that column; the only thing that
-- decides overlap is event_id.
--
-- ingested_at is left to its own DEFAULT on every row below, so it records when this backfill ran,
-- which is what 0114 says that column is for: "A backfilled or long-offline event has an old
-- occurred_at and a new ingested_at, and that is intentional." details therefore does not repeat it.
--
-- All statements in one migration file run inside a single transaction (applyPendingMigrations in
-- apps/backend/src/database/migrationRunner.ts wraps each file in BEGIN/COMMIT - the function is
-- named rather than cited by line because this same change edits that file, and a line range into a
-- file being edited alongside an immutable comment rots the moment it merges), so now() below is one
-- fixed instant shared by every statement.
--
-- The two client-clock windows below are written as INTERVAL '720 hours' rather than
-- INTERVAL '30 days'. productAnalyticsMaxEventAgeMs (apps/backend/src/productAnalytics/
-- validation.ts:24) is 30 * 24 * 60 * 60 * 1000 milliseconds, which is a fixed span of absolute
-- time; subtracting days from a timestamptz is calendar arithmetic in the session's time zone and
-- is 719 or 721 hours across a daylight-saving boundary. The hour form matches the producers
-- exactly and does not depend on what TimeZone the migration session happens to run with.
--
--
-- EFFECT ON THE WEB GUEST REAPER
--
-- The reaper measures a web guest's liveness as GREATEST(MAX(occurred_at), MAX(ingested_at)) over
-- that guest's analytics.product_events rows, falling back to its newest session's created_at when
-- it has none (apps/backend/src/guestAuth/reaper/index.ts:258-266). 0119 emptied the table, so that
-- lateral currently matches nothing and every candidate falls back. This migration puts rows back,
-- but only the table stops being empty: the lateral is keyed on the web guest's own user_id, no row
-- below can carry one, so it still matches nothing for a web guest and every candidate still falls
-- back to its newest session's created_at. No guest's outcome changes.
--
-- What makes that true is that a web guest credential is refused on every authenticated surface
-- except analytics
-- ingest by apps/backend/src/guestAuth/webPlatform.ts, applied through the default-deny gate in
-- apps/backend/src/server/requestContext.ts that every authenticated surface passes, so it never
-- answers a review, writes a card or a deck, installs a catalog deck, creates an invitation or a
-- friendship, or upgrades. And no older session became a web guest retroactively: 0116 only widened
-- the platform CHECK and relabelled nothing, so every platform = 'web' session was minted after that
-- gate already existed. The identity links written at the end move in the same direction - a link
-- only ever excludes a guest from reaping, and only for guests that really did sign in.

-- The session bounds this file runs under, and the first thing it does.
--
-- The migration runner wraps each file in BEGIN/COMMIT on a client that sets no timeout of its own
-- (apps/backend/src/database/migrationRunner.ts), and the migration Lambda's own timeout is 5
-- minutes (infra/aws/lib/migration-runner.ts:95). Without a server-side bound the failure mode of a
-- statement that runs long is the Lambda being killed at 300 seconds with the transaction still open
-- on the server, which the database only tears down when it eventually notices the connection is
-- gone. A clean SQL error is strictly better, so both bounds are set here.
--
-- statement_timeout is 240 seconds, chosen against that 300-second Lambda budget so 60 seconds are
-- left for the ROLLBACK and for the runner to report which file failed. What it bounds is a
-- statement and not this file, and that difference is not smoothed over here: it is not a
-- 240-second cap on the transaction, and the statements below each allowed 240 seconds add up to
-- far more than the Lambda has. How much less than that sum the real bound is depends on when
-- PostgreSQL re-arms the timer, and the appliers of this file do not all submit it the same way -
-- the Lambda runner sends the whole file as one multi-statement simple query, while
-- scripts/deploy/migrate.sh runs it under psql --single-transaction, which submits each statement
-- separately - so no guarantee of that shape is asserted here. The claim worth making is the
-- smaller one: at the scale this file was measured against (about 124k sync.hot_changes rows and
-- about 40k content.review_events rows) every statement below runs in seconds, so reaching this
-- bound at all means the plan is wrong rather than that the bound is tight, and the release should
-- then fail with a 57014 naming the statement instead of with a Lambda timeout naming nothing.
--
-- idle_in_transaction_session_timeout is 30 seconds. Every applier of this file drives it from a
-- local source and commits as soon as it ends - the Lambda runner sends the whole file as one
-- message, scripts/deploy/migrate.sh runs it under psql --single-transaction - so this transaction
-- is never legitimately idle for anything close to 30 seconds. The bound exists for the case where
-- the client dies with the transaction still open, so the server ends it on a timer instead of
-- holding it until it notices the connection is gone.
--
-- Both are SET LOCAL so they revert at COMMIT and do not leak into the later migrations, the view
-- files or the admin grant statements that share this client.
SET LOCAL statement_timeout = '240s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- What this file measures before it writes, and what it does about each finding.
--
-- The identity links below are the irreversible half of this file. analytics.identity_links is
-- append-only and first-link-wins with no repair path, so a wrong link permanently attributes one
-- person's history to another. The three shapes of history that would produce one are measured here
-- rather than assumed, because this migration runs unattended during a release.
--
-- They are measured and skipped, not asserted, and the reason belongs here because migration
-- comments are immutable once merged. Every condition below is permanent: auth.guest_upgrade_history
-- is append-only, and neither it nor community.friendships has a delete path the product can reach,
-- so a condition that exists once exists again on every retry. This file is the --require-migration
-- value in .github/workflows/aws-web-release.yml and the databaseMigrationGate argument in
-- infra/aws/lib/stack.ts, so raising here would not cost a rerun. It would block AWS/Web Release -
-- and every unrelated change riding that release - until somebody edited a merged migration file or
-- hand-inserted a schema_migrations row, both out-of-band database operations this repository's
-- CI/CD-only rule forbids and neither of them something a rerun can do for itself. Skipping the
-- affected guest ids costs one uncounted link instead, which is the trade this file makes
-- everywhere else: a missing row leaves a fact uncounted, a wrong one is permanent.
--
-- Each skip is announced with RAISE NOTICE naming its count and its reason rather than left silent.
-- PostgreSQL sends a notice to the client rather than to any log a release could read afterwards,
-- and node-postgres drops one that nothing listens for, so the migration client subscribes to the
-- 'notice' event and writes each one to stdout, which is the migration Lambda's CloudWatch log, as a
-- database_migration_notice record carrying the name of the file that raised it
-- (apps/backend/src/database/migrationRunner.ts).
--
-- The three link counts are measured over exactly the pairs the identity link statement would
-- otherwise write a link for - the same self-comparison, the same two regexes, the same live-account
-- guard, and the same grouping, because that statement offers one link per (anonymous_id, user_id)
-- pair however many history rows name it. A pair that matches more than one reason is counted under
-- each.
--
-- Each number is therefore what this DO block's snapshot says the identity link statement will skip,
-- and not a measurement of that statement's own outcome. This block runs near the top of the file
-- and that insert is the last of its writes; each takes its own READ COMMITTED snapshot, and the
-- tables the predicates read (auth.guest_upgrade_history, analytics.identity_links,
-- org.user_settings) all keep
-- taking live writes while this file runs. A row committed between the two snapshots is handled
-- correctly by the insert, which reads it, and is simply absent from these counts, which did not -
-- so a notice can under-report and, if an account disappears in between, over-report. The counts are
-- an operator signal, and nothing below branches on them.
--
--   * A chain. This upgrade's target user id is itself the source of another upgrade, so the link
--     would name an intermediate identity rather than the account the person ended on, and
--     first-link-wins would keep it there. Chains are reachable by product design rather than
--     hypothetically: apps/backend/src/auth/accountDeletion.ts:94-101 documents the
--     bound-upgrade-then-merge sequence that creates one, and walks the history recursively because
--     of it. Skipped, so that guest's tail stays unresolved instead of resolving to a stale
--     identity. The later upgrade of the chain is not affected and its own link is still written,
--     and the guest_upgrade_completed event for every one of these upgrades is still backfilled -
--     the fact is correct either way, it is only the link that would be wrong.
--   * An ambiguous source. One guest user id upgrades into more than one account, so no single link
--     is correct for it. Every row naming that guest id is skipped.
--   * A displacement. A server_derived link naming a different account already owns this guest id.
--     linked_at below is the historical merged_at, deliberately earlier than any link written since,
--     and first_guest_upgrade_link in analytics.product_events_resolved is
--     DISTINCT ON (anonymous_id) ORDER BY linked_at, link_id (0115:112-118), so a backdated link
--     does not queue behind the existing one - it displaces it, and every row that link was
--     resolving moves to a different account for good. Skipped.
--
-- The fourth measurement is not about the links and nothing is skipped for it. An invitation is
-- single use, so its acceptance inserts exactly two directed community.friendships rows with
-- different viewers, but nothing in the schema says so; if that ever stopped holding, the two rows
-- would derive one event_id and ON CONFLICT DO NOTHING would keep only one of them. Neither
-- skipping nor raising is the right response there, because nothing wrong is written: what survives
-- is a correct friendship_created event for that viewer and what is lost is a duplicate, so the
-- cost is the undercount this file accepts everywhere else, and the notice is the whole of the
-- response.
--
-- Every comparison of a history id below runs through pg_catalog.lower - the three skip predicates,
-- and the live-account guard beside them - and so does the identity link statement's own WHERE,
-- which applies the same predicates and the same guard these counts measure. The premise is the one
-- the header's section on how the guard compares ids settles for the whole file:
-- auth.guest_upgrade_history has no foreign key of any kind (0034), so nothing makes its TEXT id
-- columns byte-identical to anything and either hex case may be stored. Two rows differing only in
-- case are two TEXT values but one (anonymous_id, user_id) pair once cast, so compared as stored a
-- chain or an ambiguous source could slip past both predicates and then collide inside the insert;
-- and compared as stored against org.user_settings, an uppercase-hex target_user_id would fail the
-- live-account guard and lose both its event and its link with nothing said about it. Case folding
-- is used rather than a cast even now that the regexes sit beside it, because nothing orders a cast
-- after the regex that would have protected it, and a cast evaluated first would abort the release
-- on the first non-UUID id a local AUTH_MODE=none database holds - which is the failure this whole
-- section now exists to avoid rather than to cause.
DO $$
DECLARE
  chained_upgrade_count BIGINT;
  ambiguous_upgrade_source_count BIGINT;
  displaced_guest_link_count BIGINT;
  ambiguous_friendship_key_count BIGINT;
BEGIN
  SELECT
    pg_catalog.count(*) FILTER (WHERE candidate_links.is_chained),
    pg_catalog.count(*) FILTER (WHERE candidate_links.is_ambiguous_source),
    pg_catalog.count(*) FILTER (WHERE candidate_links.is_displacing)
  INTO STRICT
    chained_upgrade_count,
    ambiguous_upgrade_source_count,
    displaced_guest_link_count
  FROM (
    -- DISTINCT, with the lowered pair carried beside the flags, because the insert at the end of
    -- this file ends in GROUP BY source_guest_user_id::uuid, target_user_id::uuid and so offers one
    -- link per pair however many history rows name it. Counting history rows here would report more
    -- skipped links than were left unwritten. Each flag below is a function of the lowered pair
    -- alone, so every row of one pair carries all three identically and DISTINCT collapses that pair
    -- to the single link it would have been; the regexes in the WHERE have already proved both
    -- halves are canonical hyphenated hex, so these lowered text pairs partition the rows exactly as
    -- that statement's ::uuid pairs do.
    SELECT DISTINCT
      pg_catalog.lower(upgrades.source_guest_user_id) AS source_guest_user_id,
      pg_catalog.lower(upgrades.target_user_id) AS target_user_id,
      EXISTS (
        SELECT 1
        FROM auth.guest_upgrade_history AS chained_upgrades
        WHERE pg_catalog.lower(chained_upgrades.source_guest_user_id)
          = pg_catalog.lower(upgrades.target_user_id)
      ) AS is_chained,
      EXISTS (
        SELECT 1
        FROM auth.guest_upgrade_history AS sibling_upgrades
        WHERE pg_catalog.lower(sibling_upgrades.source_guest_user_id)
            = pg_catalog.lower(upgrades.source_guest_user_id)
          AND pg_catalog.lower(sibling_upgrades.target_user_id)
            <> pg_catalog.lower(upgrades.target_user_id)
      ) AS is_ambiguous_source,
      -- This one compares against the rendered text of a stored uuid, which PostgreSQL always emits
      -- lowercase and hyphenated, so it is exact against a lowered id the WHERE below has proved is
      -- in that form. The only cast is uuid to text and it cannot raise, so it is safe here in the
      -- target list whatever order the planner picks.
      EXISTS (
        SELECT 1
        FROM analytics.identity_links AS identity_links
        WHERE identity_links.anonymous_id::text = pg_catalog.lower(upgrades.source_guest_user_id)
          AND identity_links.source = 'server_derived'
          AND identity_links.user_id::text <> pg_catalog.lower(upgrades.target_user_id)
      ) AS is_displacing
    FROM auth.guest_upgrade_history AS upgrades
    WHERE pg_catalog.lower(upgrades.source_guest_user_id)
        <> pg_catalog.lower(upgrades.target_user_id)
      AND upgrades.source_guest_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND upgrades.target_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND EXISTS (
        SELECT 1
        FROM org.user_settings AS user_settings
        WHERE pg_catalog.lower(user_settings.user_id)
          = pg_catalog.lower(upgrades.target_user_id)
      )
  ) AS candidate_links;

  IF chained_upgrade_count > 0 THEN
    RAISE NOTICE
      'Skipped % historical guest upgrade identity link(s) because the upgrade chains: the target user id is itself the source of another upgrade, so the link would name an intermediate identity rather than the account the person ended on, and analytics.identity_links is first-link-wins. The guest_upgrade_completed events for those upgrades are still backfilled.',
      chained_upgrade_count;
  END IF;

  IF ambiguous_upgrade_source_count > 0 THEN
    RAISE NOTICE
      'Skipped % historical guest upgrade identity link(s) because the guest user id upgrades into more than one account, so no single link is correct for it.',
      ambiguous_upgrade_source_count;
  END IF;

  IF displaced_guest_link_count > 0 THEN
    RAISE NOTICE
      'Skipped % historical guest upgrade identity link(s) because a server_derived link naming a different account already owns that guest user id, and this file''s backdated linked_at would displace that link and move another person''s resolved history.',
      displaced_guest_link_count;
  END IF;

  SELECT pg_catalog.count(*) INTO STRICT ambiguous_friendship_key_count
  FROM (
    SELECT 1
    FROM community.friendships AS friendships
    WHERE friendships.viewer_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    GROUP BY friendships.created_from_invitation_id, friendships.viewer_user_id
    HAVING pg_catalog.count(*) > 1
  ) AS ambiguous_friendship_keys;

  IF ambiguous_friendship_key_count > 0 THEN
    RAISE NOTICE
      'Backfilling friendship_created over % invitation and viewer pair(s) that community.friendships now holds more than one row for. Nothing is skipped: the rows of such a pair derive one event_id, ON CONFLICT (event_id) DO NOTHING keeps a correct event for that viewer, and the duplicate is an undercount rather than a wrong row.',
      ambiguous_friendship_key_count;
  END IF;
END
$$;

-- One graded answer per content.review_events row.
--
-- The anchor is reviewed_at_server as stored, capped at this migration's own clock. That is the
-- rule reviewAnswers.ts:139-146 applies to the one anchor kind that reads a value out of our own
-- table rather than stamping it in the request at hand: legitimately old values are kept, because
-- collapsing a guest's offline history onto one day is the failure this exists to avoid, while a
-- claimed future instant is replaced, because it would file a permanent row on a day that has not
-- happened. Which of the three anchor kinds a stored row had is not recorded anywhere, so it cannot
-- be recovered here; the producer's own comment (reviewAnswers.ts:177-181) says that reconstructing
-- history for real belongs to a backfill reading these rows offline with no request clock to
-- defend, which is what this is.
--
-- That anchor is an upper cap and nothing else, and the absent lower bound is a decision rather than
-- an oversight. reviewEventImportPayloadSchema accepts any RFC 3339 instant with no bound at all and
-- reviews.ts:142-143 stores it through COALESCE($8, now()), so a history imported from a device
-- whose clock was wrong keeps whatever old instant it stored and files it on occurred_at, the
-- indexed column every dashboard groups by. That is the hazard reviewAnswers.ts:47-53 names in the
-- value itself, and it is inherited here in full, knowingly: adding a floor would make this backfill
-- disagree with the live producer about the same fact and put a visible step in the series at the
-- deploy boundary, which is worse than an old row being old.
--
-- occurred_at then applies the producer's client-clock rule unchanged: reviewed_at_client is kept
-- only inside the same 30-day window the live client ingest accepts and never after the anchor, and
-- outside that window the anchor is used instead (reviewAnswers.ts:182-197).
--
-- The reviewer is content.review_events.reviewed_by_user_id, read off the very row being
-- reconstructed. That is not a proxy for the live producer's actor, it is the same value: the
-- insert stores security.current_user_id() into that column (reviews.ts:142-143) and hands the
-- producer the same id resolved from the same request scope (reviews.ts:167 and 191, through
-- publicProfiles.ts:247-259), which reviewAnswers.ts:232-233 writes into both identity columns. So
-- a guest's reviews follow the account through the guest upgrade link that
-- analytics.product_events_resolved reads on subject_user_id.
--
-- sync.workspace_replicas.user_id is deliberately not used here, and the replica is not joined at
-- all. It is a mutable label rather than an authorship record: apps/backend/src/sync/identity/
-- replica.ts:166 rewrites it (SET user_id = $3) on every re-registration of the replica, so it
-- names whoever holds the replica now, not who answered the review. 0058:10-15 introduced
-- reviewed_by_user_id for exactly that reason and 0058:17-19 states the rule this statement
-- follows: the replica label "is the only available historical signal and is used only for this
-- backfill; new writes never infer authorship from mutable replica labels" - that backfill being
-- 0058's own, which already copied the label into reviewed_by_user_id once, under an
-- org.user_settings guard. Reading the label again here would recover nothing 0058 left behind; it
-- would only overwrite settled authorship with whoever holds the replica today.
-- (0061 is not a precedent for the other reading either: it attributes a review through
-- facts.reviewed_by_user_id at 0061:69 and 0061:116, and joins sync.workspace_replicas only to
-- filter on actor_kind and platform at 0061:77-78 and 0061:120-121.)
--
-- This is also what makes the statement deletion-aware, by both mechanisms the header describes.
-- reviewed_by_user_id is a foreign key to org.user_settings with ON DELETE SET NULL (0058:11-12), so
-- the column is already NULL for every review whose author deleted their account before this file
-- started, and a NULL fails the regex below and drops the row. The live-account guard covers what a
-- cascade cannot: a cascade proves nothing about a deletion committing after this statement's
-- snapshot. It is a best-effort read and not a guarantee - nothing here locks org.user_settings, for
-- the reason the header gives - and the residual it leaves is the one the header names. Equality is
-- raw because that foreign key makes this column byte-identical to the org.user_settings row it
-- references.
--
-- The user id regex is the one apps/backend/src/guestAuth/reaper/index.ts:52 uses and it exists for
-- the same reason: org.user_settings.user_id is TEXT and a local AUTH_MODE=none database holds
-- non-UUID ids there, which would fail the cast and take the whole release transaction with them.
-- On every deployed environment it excludes nothing.
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
  workspace_id,
  event_properties,
  details
)
SELECT
  analytics.derive_server_event_id(
    'review_answered',
    ARRAY[review_events.review_event_id::text]
  ),
  1,
  'review_answered',
  'backfill',
  '139bd2f2-12b8-44c4-ad17-1081e5ed223f'::uuid,
  anchor.server_anchor,
  CASE
    WHEN review_events.reviewed_at_client > anchor.server_anchor
      OR review_events.reviewed_at_client < anchor.server_anchor - INTERVAL '720 hours'
      THEN anchor.server_anchor
    ELSE review_events.reviewed_at_client
  END,
  review_events.reviewed_by_user_id::uuid,
  review_events.reviewed_by_user_id::uuid,
  'backfill_derived',
  review_events.workspace_id,
  -- content.review_events.rating is 0..3 and 0001 names the four buttons in its column comment. The
  -- catalog takes the name, which is what reviewAnswers.ts:30 maps it to.
  pg_catalog.jsonb_build_object(
    'rating',
    (ARRAY['again', 'hard', 'good', 'easy'])[review_events.rating + 1]
  ),
  pg_catalog.jsonb_build_object(
    'backfill', '0120_backfill_product_analytics_server_facts',
    'reconstructed_from', 'content.review_events'
  )
FROM content.review_events AS review_events
CROSS JOIN LATERAL (
  SELECT LEAST(review_events.reviewed_at_server, pg_catalog.now()) AS server_anchor
) AS anchor
WHERE review_events.reviewed_by_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE user_settings.user_id = review_events.reviewed_by_user_id
  )
ON CONFLICT (event_id) DO NOTHING;

-- One creation per card and per deck, read from the oldest sync.hot_changes row the log holds for
-- that entity.
--
-- The live producer collects a creation only from a branch that genuinely inserted the row
-- (contentCreations.ts:77-99), and every such branch writes exactly one hot change for the same
-- write, carrying the same entity id and the same client_updated_at the producer is handed
-- (apps/backend/src/cards/shared.ts:241-251 for a card, recordDeckSyncChange for a deck). The oldest
-- hot change per entity is therefore that write, and nothing later can be mistaken for it.
--
-- Two adjustments make this agree with the live stream rather than with a naive reading of the log,
-- and both are applied to the oldest row after it has been chosen rather than as a filter before it,
-- so an excluded creation stays excluded instead of promoting the entity's next update into one:
--
--   * Catalog installs are dropped. An installed card is written by the install's own SQL and never
--     reaches the card_created producer, so no live row exists for it, but the install does record a
--     hot change per card like any other write - the reason is spelled out at
--     apps/backend/src/catalog/distribution/install/persistence.ts:333-339, which names this
--     backfill. Counting them would disagree with the live stream by a whole deck per install, and
--     the install is already reported once as catalog_deck_installed carrying card_count. The rows
--     to drop are named exactly by the install's own stored result, which lists the card id it
--     minted for every installed card.
--
--   * Hot changes stamped by a guest merge are dropped. The merge deletes the guest workspace's
--     content and re-inserts it into the target under the same ids, so a whole guest library lands
--     in one transaction; the 30-day rule below would then pull everything the guest authored more
--     than a month before signing up onto merge day, and an upgrade would read as a burst of
--     authoring that never happened. auth.guest_upgrade_history.merged_at and
--     sync.hot_changes.recorded_at both default to now() and the merge writes both in one
--     transaction, so equality on that instant identifies exactly those rows. The guest workspace's
--     own hot changes went with the workspace, so this is a deliberate undercount: those cards get
--     no creation at all. It is the trade this schema makes everywhere else too - a missing row only
--     leaves a fact uncounted, a wrong one is permanent. It does mean this one path differs from the
--     live stream, which does emit a creation for every row a merge re-inserts; upgrades are rare
--     enough that the step is small, and it is named here rather than left to be discovered.
--
-- An insertion that arrives already deleted still counts, exactly as it does live: the deck insert
-- collects a creation with the deletedAt it was given (apps/backend/src/decks/index.ts:663-675), and
-- nothing below filters on a tombstone.
--
-- The actor is sync.workspace_replicas.user_id, and unlike the review statement above this is an
-- acknowledged proxy rather than the producer's own value. The live producer takes the identity from
-- the authenticated request that performed the write, and nothing in this log records it: neither
-- sync.hot_changes nor content.cards nor content.decks stores an authorship column, so the replica
-- that stamped the change is the only signal left. That label is mutable - replica.ts:166 rewrites
-- it on every re-registration of the replica - so a card whose replica later re-registered under a
-- second account is attributed to that account here. This is the same trade 0058:17-19 named when it
-- had to reach for the same label, and it is accepted because a creation with no actor is not
-- reportable at all, while the alternative signal does not exist. Like the producer, the value goes
-- into both identity columns (contentCreations.ts:161-162).
--
-- Because that label survives its owner, this is one of the statements that needs an explicit
-- deletion guard. A workspace with a second member is not deleted when one member's account is
-- (accountDeletion.ts deletes only sole-member workspaces), so its replica rows keep the departed
-- person's real id, and there is no foreign key to clear it. The EXISTS below requires the account
-- to still exist before the id is written, exactly as 0058:25-29 did with the same label. It is a
-- best-effort read against the live table and not a guarantee: nothing here locks org.user_settings,
-- for the reason the header gives, so a deletion committing after this statement's snapshot is
-- invisible to it. That residual is the one the header names, and nothing here or later re-checks
-- these rows. That same absent foreign key is why this guard
-- folds case while the review, invitation, friendship and chat guards do not - the header's section
-- on how the guard compares ids says why.
WITH first_content_changes AS (
  SELECT DISTINCT ON (hot_changes.entity_type, hot_changes.entity_id)
    hot_changes.entity_type,
    hot_changes.entity_id,
    hot_changes.workspace_id,
    hot_changes.replica_id,
    hot_changes.client_updated_at,
    hot_changes.recorded_at
  FROM sync.hot_changes AS hot_changes
  WHERE hot_changes.entity_type IN ('card', 'deck')
    -- sync.hot_changes.entity_id is TEXT while content.cards.card_id and content.decks.deck_id are
    -- UUID, and the producer's key part is the id it read back out of that uuid column, so it is
    -- always the canonical lowercase form. Every writer of this log stores exactly that value
    -- (apps/backend/src/cards/shared.ts:241-251 and the sibling deck helper), so this excludes
    -- nothing today. It is a filter rather than a ::uuid cast on purpose: a cast would normalize a
    -- stray value into a different id than the producer would derive, and would abort the whole
    -- release on one that is not a UUID at all, while skipping it only leaves one creation
    -- uncounted.
    AND hot_changes.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ORDER BY hot_changes.entity_type, hot_changes.entity_id, hot_changes.change_id
),
catalog_installed_card_ids AS MATERIALIZED (
  -- MATERIALIZED is load-bearing and must not be simplified away. This CTE is referenced exactly
  -- once, so without it PostgreSQL inlines it into the NOT EXISTS below; simplify_EXISTS_query
  -- should then strip the DISTINCT and convert_EXISTS_sublink_to_join should produce a hash
  -- anti-join, but a subquery shaped like this one - a CROSS JOIN LATERAL over a set-returning
  -- function - is the kind the planner can leave as a correlated SubPlan instead. A SubPlan here is
  -- re-executed per row of first_content_changes, re-expanding every install_result array each time,
  -- which against that many rows would not finish inside the release's Lambda timeout. Forcing the
  -- fence makes the anti-join's hash side a single evaluation, and the CTE is small: one row per
  -- installed card.
  --
  -- The array guard sits inside the argument rather than in a WHERE clause: a set-returning
  -- function in FROM is evaluated per row before WHERE runs, and jsonb_array_elements raises on a
  -- value that is not an array, which would take the whole release transaction with it.
  SELECT DISTINCT installed_card ->> 'cardId' AS entity_id
  FROM sync.catalog_package_install_idempotency AS installs
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
    CASE
      WHEN pg_catalog.jsonb_typeof(installs.install_result -> 'installedCards') = 'array'
        THEN installs.install_result -> 'installedCards'
      ELSE '[]'::jsonb
    END
  ) AS installed_card
)
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
  workspace_id,
  event_properties,
  details
)
SELECT
  analytics.derive_server_event_id(
    creation_names.event_name,
    ARRAY[first_changes.entity_id]
  ),
  1,
  creation_names.event_name,
  'backfill',
  '139bd2f2-12b8-44c4-ad17-1081e5ed223f'::uuid,
  first_changes.recorded_at,
  -- resolveContentCreationOccurredAt, unchanged: keep the device's own timestamp where it is
  -- plausible - inside the same 30-day window the live client ingest accepts and never after the
  -- server clock - and fall back to the server clock outside it, which loses the offline interval
  -- but keeps a broken device clock from parking events on an arbitrary day forever
  -- (contentCreations.ts:101-126).
  CASE
    WHEN first_changes.client_updated_at > first_changes.recorded_at
      OR first_changes.client_updated_at < first_changes.recorded_at - INTERVAL '720 hours'
      THEN first_changes.recorded_at
    ELSE first_changes.client_updated_at
  END,
  replicas.user_id::uuid,
  replicas.user_id::uuid,
  'backfill_derived',
  first_changes.workspace_id,
  -- Both catalog entries carry no properties, deliberately: the row is the fact, and anything
  -- describing what was written would be content a person typed.
  '{}'::jsonb,
  pg_catalog.jsonb_build_object(
    'backfill', '0120_backfill_product_analytics_server_facts',
    'reconstructed_from', 'sync.hot_changes'
  )
FROM first_content_changes AS first_changes
INNER JOIN sync.workspace_replicas AS replicas
  ON replicas.replica_id = first_changes.replica_id
CROSS JOIN LATERAL (
  SELECT
    CASE first_changes.entity_type
      WHEN 'card' THEN 'card_created'
      ELSE 'deck_created'
    END AS event_name
) AS creation_names
WHERE replicas.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE pg_catalog.lower(user_settings.user_id) = pg_catalog.lower(replicas.user_id)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM catalog_installed_card_ids AS installed
    WHERE installed.entity_id = first_changes.entity_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM auth.guest_upgrade_history AS upgrades
    WHERE upgrades.target_workspace_id = first_changes.workspace_id
      AND upgrades.merged_at = first_changes.recorded_at
  )
ON CONFLICT (event_id) DO NOTHING;

-- One invite link per community.friend_invitations row.
--
-- The row's own created_at is the moment the backend created it, so occurred_at and
-- server_received_at are one instant and there is no skew to keep recoverable, which is exactly
-- what the producer does (community/analytics.ts:39-43). subject_user_id stays NULL and workspace_id
-- stays NULL for the producer's reasons: the routes take only signed-in human transport, so there is
-- no guest identity user_id does not already name, and the table is account-scoped and names no
-- workspace.
--
-- Deletion-aware by both mechanisms. inviter_user_id is a foreign key to org.user_settings with
-- ON DELETE CASCADE (0063:9), so an invitation created by an account deleted before this file
-- started no longer exists to be read, and the live-account guard below covers what a cascade says
-- nothing about, a deletion committing after this statement's snapshot. That guard is a best-effort
-- read and not a guarantee, with the residual the header names and nothing later that re-checks
-- these rows; equality is raw because that foreign key makes the column byte-identical to the
-- org.user_settings row it references.
INSERT INTO analytics.product_events (
  event_id,
  schema_version,
  event_name,
  origin,
  backfill_id,
  server_received_at,
  occurred_at,
  user_id,
  trust_level,
  event_properties,
  details
)
SELECT
  analytics.derive_server_event_id(
    'friend_invitation_created',
    ARRAY[invitations.friend_invitation_id::text]
  ),
  1,
  'friend_invitation_created',
  'backfill',
  '139bd2f2-12b8-44c4-ad17-1081e5ed223f'::uuid,
  invitations.created_at,
  invitations.created_at,
  invitations.inviter_user_id::uuid,
  'backfill_derived',
  '{}'::jsonb,
  pg_catalog.jsonb_build_object(
    'backfill', '0120_backfill_product_analytics_server_facts',
    'reconstructed_from', 'community.friend_invitations'
  )
FROM community.friend_invitations AS invitations
WHERE invitations.inviter_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE user_settings.user_id = invitations.inviter_user_id
  )
ON CONFLICT (event_id) DO NOTHING;

-- One event per directed community.friendships row, which is what the producer emits: both people
-- gained a friend and each of them sees that when looking only at their own events
-- (community/analytics.ts:62-84). The producer takes the viewer of each directed row as that event's
-- user_id and as the second key part, and reads the invitation id off the same row, so reading both
-- straight off the row reproduces it.
--
-- The database dated both directed rows itself, so occurred_at and server_received_at are one
-- instant here too.
--
-- Both mechanisms again. viewer_user_id and friend_user_id are both foreign keys to
-- org.user_settings with ON DELETE CASCADE (0063:39-40), so deleting one account removes both
-- directed rows of every friendship it was part of, the surviving friend's row included; a deletion
-- that happened before this file started therefore leaves neither row to read, and the friendship is
-- uncounted for both people rather than half-counted for one. The live-account guard below covers
-- what a cascade says nothing about, a deletion committing after this statement's snapshot; it is a
-- best-effort read and not a guarantee, with the residual the header names and nothing later that
-- re-checks these rows. It keys on the viewer, which is the only person this statement names: no
-- column of the row it writes carries the friend's id. Equality is raw because that foreign key
-- makes the column byte-identical to the org.user_settings row it references.
INSERT INTO analytics.product_events (
  event_id,
  schema_version,
  event_name,
  origin,
  backfill_id,
  server_received_at,
  occurred_at,
  user_id,
  trust_level,
  event_properties,
  details
)
SELECT
  analytics.derive_server_event_id(
    'friendship_created',
    ARRAY[friendships.created_from_invitation_id::text, friendships.viewer_user_id]
  ),
  1,
  'friendship_created',
  'backfill',
  '139bd2f2-12b8-44c4-ad17-1081e5ed223f'::uuid,
  friendships.created_at,
  friendships.created_at,
  friendships.viewer_user_id::uuid,
  'backfill_derived',
  '{}'::jsonb,
  pg_catalog.jsonb_build_object(
    'backfill', '0120_backfill_product_analytics_server_facts',
    'reconstructed_from', 'community.friendships'
  )
FROM community.friendships AS friendships
WHERE friendships.viewer_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE user_settings.user_id = friendships.viewer_user_id
  )
ON CONFLICT (event_id) DO NOTHING;

-- One install per sync.catalog_package_install_idempotency row.
--
-- That table is written once per committed install and never deleted - backend_app holds only
-- SELECT and INSERT on it (0106) - so it is the durable record of the fact. Its rows go with the
-- workspace when the workspace is deleted, which is also when the installed cards go, so nothing
-- here can outlive what it describes.
--
-- package_slug means catalog.packages.slug across this repository, and the client's
-- catalog_deck_install_started carries that same value, so the pair only joins into a funnel when
-- this event carries it too; the package version's frozen copy of the slug is deliberately not used
-- (install/index.ts:372-380). This statement writes that slug straight into event_properties without
-- passing through assertProductAnalyticsRowMatchesCatalog, so what keeps it on-catalog is not a
-- check here but an equality between two independently declared patterns:
-- catalog.packages_slug_format (0083:54) and productAnalyticsSlugPattern
-- (apps/backend/src/productAnalytics/catalog.ts:36) are both
-- ^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$, byte for byte. That equality is the load-bearing fact and
-- it is written down here because nothing enforces it: if the package slug format is ever widened
-- without widening the analytics pattern with it, this statement would write off-catalog
-- event_properties and nothing in this file would notice.
--
-- The join is inner on purpose: when the package row is gone the live
-- producer drops the event rather than emitting a stale slug, because a wrong slug joins to the
-- wrong deck forever while a missing row only undercounts (install/index.ts:382-386).
--
-- catalog.package_versions is joined on the way to that row, and it is inner for the same reason and
-- with the same effect: sync.catalog_package_install_idempotency.package_version_id carries no
-- foreign key (0106:8), so a removed version row would drop its installs here. The two joins can
-- only ever drop together, because catalog.package_versions.package_id references
-- catalog.packages ON DELETE CASCADE (0083:64), so removing a package removes its versions in the
-- same statement and there is no state where one is readable and the other is not.
--
-- This slug is the one value in event_properties below that is not point-in-time. catalog.packages
-- .slug is mutable - apps/backend/src/catalog/authoring/drafts.ts:179-186 writes it on every draft
-- update, and the only trigger guarding a slug is catalog.prevent_published_package_version_update
-- (0113), which freezes catalog.package_versions.slug and says nothing about this table - so a
-- historical install is backfilled with the slug the package carries today, not the one the live
-- producer would have emitted on the day of the install. That is unavoidable, since no install row
-- stores the slug it saw, and it is also the more useful of the two for a funnel join, which wants
-- every install of one package under one key; it is named here so nobody reads these rows as a
-- record of what the package was called at the time.
--
-- card_count is read from the stored result the install returned, which is where the producer takes
-- it from (install/index.ts:440).
--
-- The actor is the user of the replica the install recorded in last_modified_by_replica_id, and it
-- is a proxy, not the producer's value. The live producer writes the request's own userId
-- (install/index.ts:428), which this table does not store; the replica id it does store was only
-- ever validated against the workspace, never against the installing user
-- (assertCatalogInstallReplicaBelongsToWorkspaceInExecutor, install/persistence.ts:150-169), and the
-- label on that replica is rewritten on every re-registration (replica.ts:166). So an install
-- performed from a replica that has since changed hands is attributed here to whoever holds it now.
-- The same trade as the creations above: no stored authorship exists, and an install with no actor
-- is not reportable.
--
-- That proxy needs the same explicit deletion guard for the same reason. An install row lives as
-- long as its workspace, and a workspace with a second member outlives the member who installed,
-- while sync.workspace_replicas.user_id has no foreign key to clear. The EXISTS below requires the
-- account to still exist before its id is written. It is a best-effort read against the live table
-- and not a guarantee, with the residual the header names and nothing later that re-checks these
-- rows, and it folds case for the same reason the creations statement above does: that absent
-- foreign key.
--
-- guest_session_id is the one field the producer sets that cannot be reconstructed and is left NULL.
-- It comes from the request context (routes/catalog/install.ts:169-170) and no install row stores
-- it, and claiming a guest session this table does not record would be an invention. What that
-- costs is the guest/account split on the row itself, not the attribution, which is the same thing
-- the content and review producers say about their own NULL guest_session_id.
--
-- subject_user_id is not left NULL, and must not be. The producer takes it from the request context
-- too, but this route is reachable on guest transport - it passes the request's guestSessionId
-- through (routes/catalog/install.ts:169-170) - and a guest-transport request carries the guest user
-- id in userId and subjectUserId alike (apps/backend/src/auth/index.ts:379), so a live guest's
-- install really does land here with the guest identity on the replica label read below.
-- first_guest_upgrade_link in analytics.product_events_resolved joins on subject_user_id only
-- (0115:111-124), so a NULL there makes actor_id fall through to user_id - which for such an install
-- is the guest identity, not an account. A guest that has not upgraded yet when this backfill runs
-- still has its install and its replica row; the upgrade it performs afterwards writes its link
-- keyed on that guest id and the link would never be reached, leaving the install stranded on the
-- guest identity for good on an append-only table, and counting one person as a guest actor and an
-- account actor both. So the replica label goes into both identity columns, exactly as the content
-- producer does with its own actor (contentCreations.ts:161-162) and the review producer with its
-- (reviewAnswers.ts:232-233).
--
-- Writing the same value into both columns is also what account deletion requires, for the reason
-- the header section on deletion gives.
--
-- For an account rather than a guest this writes the app user id where the live producer writes the
-- Cognito subject. That divergence is the one contentCreations.ts:156-160 already documents as
-- harmless: the only link keyed on subject_user_id is a guest upgrade, and no account's
-- authoritative id is ever a merged-away guest user id, so no row's attribution changes either way.
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
  workspace_id,
  event_properties,
  details
)
SELECT
  analytics.derive_server_event_id(
    'catalog_deck_installed',
    ARRAY[installs.workspace_id::text, installs.install_id]
  ),
  1,
  'catalog_deck_installed',
  'backfill',
  '139bd2f2-12b8-44c4-ad17-1081e5ed223f'::uuid,
  installs.completed_at,
  installs.completed_at,
  replicas.user_id::uuid,
  replicas.user_id::uuid,
  'backfill_derived',
  installs.workspace_id,
  pg_catalog.jsonb_build_object(
    'package_slug', packages.slug,
    'card_count', installs.install_result -> 'summary' -> 'cardCount'
  ),
  pg_catalog.jsonb_build_object(
    'backfill', '0120_backfill_product_analytics_server_facts',
    'reconstructed_from', 'sync.catalog_package_install_idempotency'
  )
FROM sync.catalog_package_install_idempotency AS installs
INNER JOIN catalog.package_versions AS package_versions
  ON package_versions.package_version_id = installs.package_version_id
INNER JOIN catalog.packages AS packages
  ON packages.package_id = package_versions.package_id
INNER JOIN sync.workspace_replicas AS replicas
  ON replicas.replica_id = installs.last_modified_by_replica_id
WHERE replicas.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE pg_catalog.lower(user_settings.user_id) = pg_catalog.lower(replicas.user_id)
  )
  -- card_count is a non-negative integer in the frozen catalog, so a stored result that does not
  -- carry one is skipped rather than emitted with a missing property. The catalog binds this field
  -- to nonNegativeInteger and this statement does not pass through
  -- assertProductAnalyticsRowMatchesCatalog (apps/backend/src/productAnalytics/writer.ts:285-329),
  -- so the type check is all that is enforced here. The stored value is installedCards.length on
  -- every write that ever produced one of these rows, so the narrower bound has nothing to exclude;
  -- it is not added because the only way to test it in SQL is a cast, and a cast the planner is free
  -- to evaluate ahead of this type check would abort the whole release on a value it was meant to
  -- skip. Undercount over a rolled-back release, as everywhere else in this file.
  AND pg_catalog.jsonb_typeof(installs.install_result -> 'summary' -> 'cardCount') = 'number'
ON CONFLICT (event_id) DO NOTHING;

-- One user-sent chat turn per ai.chat_runs row.
--
-- The live producer runs once per prepared run, deduplicated or not, and derives its id from the
-- run id, so a retry that replays the stored run reports the same turn under the same id
-- (chat/runs/analytics.ts:7-28). One stored run is therefore exactly one live event, and reading the
-- table row for row reproduces the series with no dedupe rule of its own.
--
-- The actor is not a proxy here. ai.chat_sessions.user_id and ai.chat_sessions.workspace_id are the
-- request scope the turn ran under: every path that reaches a run selects or creates its session
-- with WHERE user_id = $1 AND workspace_id = $2 from that scope and inserts those same two values
-- (chat/store/repository.ts:96-97, 133-134, 139-152), and the handler passes the identical pair to
-- the producer (chat/http/handlers.ts:204-206). So this reconstructs userId and workspaceId, not a
-- stand-in for them.
--
-- It is deletion-aware by the strongest of the cascade mechanisms: ai.chat_sessions.user_id is a
-- foreign key to org.user_settings ON DELETE CASCADE and ai.chat_sessions.workspace_id one to
-- org.workspaces ON DELETE CASCADE (0032:16-17), while ai.chat_runs.session_id cascades from the
-- session (0033:5). An account deleted before this file started has its sessions and runs gone
-- outright, and so does a merged-away guest, because the merge deletes the guest workspace in its
-- own transaction. The live-account guard below is applied all the same, because a cascade that has
-- not fired yet proves nothing about a deletion committing after this statement's snapshot; that
-- guard is a best-effort read and not a guarantee, with the residual the header names and nothing
-- later that re-checks these rows, and its equality is raw because that foreign key makes
-- ai.chat_sessions.user_id byte-identical to the org.user_settings row it references. It excludes no
-- live guest: a guest holds an org.user_settings row of its own until the merge's cleanup phase
-- deletes it (apps/backend/src/guestAuth/delete/index.ts:52), which is what keeps the subject_user_id
-- reasoning below reachable.
--
-- created_at is the run row's own DEFAULT now(), which is the transaction start where the live
-- producer's clock is read just after that transaction committed. Both timestamps take it, which is
-- what the producer does: the turn is observed as it happens and there is no skew to keep
-- recoverable (chat/runs/analytics.ts:24-26). As everywhere above, nothing compares this against a
-- live row's server_received_at; only event_id decides overlap.
--
-- guest_session_id is the one field the producer sets that cannot be reconstructed and is left NULL,
-- exactly as for catalog_deck_installed above: it comes from the request context and neither a run
-- nor a session stores it. What that costs is the guest/account split on the row itself, not the
-- attribution.
--
-- subject_user_id is not left NULL, for the same reason it is not left NULL on the install above.
-- The chat route takes guest transport - it classifies signed-in transport rather than requiring it
-- (chat/http/handlers.ts:180) - and a guest-transport request carries the guest user id in userId
-- and subjectUserId alike (apps/backend/src/auth/index.ts:379), which is the id
-- ai.chat_sessions.user_id then holds for that session. That an upgraded guest's chat rows went with
-- their workspace at the merge is true, and it is not an argument for leaving the column NULL,
-- because it only covers upgrades that had already happened when this migration ran. A guest who has
-- not upgraded yet still has its sessions and runs here, and a NULL would leave this statement
-- stamping user_id with the guest id and nothing else; the upgrade that comes afterwards writes
-- its link keyed on that guest id, first_guest_upgrade_link joins on subject_user_id only
-- (0115:111-124), and the turn would stay stranded on the guest identity for good on an append-only
-- table. So the session's user id goes into both identity columns, as the content and review
-- producers do with theirs (contentCreations.ts:161-162, reviewAnswers.ts:232-233).
--
-- Writing the same value into both columns is also what account deletion requires, for the reason
-- the header section on deletion gives. For an account rather than a guest this is the app user id
-- where the live producer writes the Cognito subject, the divergence contentCreations.ts:156-160
-- documents as harmless.
--
-- The user id regex is the same one the statements above use, and this is the one place where it
-- demonstrably excludes something rather than only guarding a theoretical case: the PostgreSQL
-- integration harness seeds a chat session and run under the literal user id
-- 'migration-0103-legacy-chat-user' before applying 0103
-- (apps/backend/scripts/postgresIntegrations/migrations.mjs:298-373), so on that database this
-- statement selects nothing instead of aborting the whole file on the ::uuid cast.
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
  workspace_id,
  event_properties,
  details
)
SELECT
  analytics.derive_server_event_id(
    'ai_message_sent',
    ARRAY[chat_sessions.workspace_id::text, chat_runs.run_id::text]
  ),
  1,
  'ai_message_sent',
  'backfill',
  '139bd2f2-12b8-44c4-ad17-1081e5ed223f'::uuid,
  chat_runs.created_at,
  chat_runs.created_at,
  chat_sessions.user_id::uuid,
  chat_sessions.user_id::uuid,
  'backfill_derived',
  chat_sessions.workspace_id,
  -- The catalog entry declares no properties: the turn is the fact, and anything describing it
  -- would be content a person typed.
  '{}'::jsonb,
  pg_catalog.jsonb_build_object(
    'backfill', '0120_backfill_product_analytics_server_facts',
    'reconstructed_from', 'ai.chat_runs'
  )
FROM ai.chat_runs AS chat_runs
INNER JOIN ai.chat_sessions AS chat_sessions
  ON chat_sessions.session_id = chat_runs.session_id
WHERE chat_sessions.user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE user_settings.user_id = chat_sessions.user_id
  )
ON CONFLICT (event_id) DO NOTHING;

-- One conversion per auth.guest_upgrade_history row.
--
-- The upgrade is observed as it happens, so occurred_at and server_received_at are one instant, and
-- merged_at is the server timestamp of the merge's own commit. The row names both sides of the
-- upgrade the way the producer does (guestAuth/index.ts:170-178): the account in user_id, the guest
-- identity the client's earlier events already carried in subject_user_id, and the session that
-- initiated the merge in guest_session_id.
--
-- This is the statement the deletion guard matters most for, and the one it is easiest to get
-- wrong. auth.guest_upgrade_history has no foreign keys at all (0034), so it keeps a deleted
-- person's real target_user_id, source_guest_user_id, source_guest_session_id and
-- target_workspace_id verbatim after every one of them was cleared from analytics.product_events by
-- accountDeletion.ts. Writing this row unguarded would restore all four in one insert, on the same
-- append-only table, with identity_state left at its 'active' default. So the EXISTS below requires
-- the account to still exist. It is a best-effort read of the live table and not a guarantee: a
-- deletion committing after this statement's snapshot and before this file's COMMIT is invisible to
-- it, which is the residual the header names and which nothing later re-checks for these rows. It
-- keys on target_user_id alone: the guest side of a completed upgrade
-- is always absent from org.user_settings, whether or not the account was ever deleted, so guarding
-- on it as well would suppress every row this statement exists to write. It folds case because
-- auth.guest_upgrade_history carries no foreign key at all, exactly as the link predicates below do
-- and for the reason the header's section on how the guard compares ids gives.
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
  guest_session_id,
  workspace_id,
  event_properties,
  details
)
SELECT
  analytics.derive_server_event_id(
    'guest_upgrade_completed',
    ARRAY[upgrades.source_guest_session_id::text]
  ),
  1,
  'guest_upgrade_completed',
  'backfill',
  '139bd2f2-12b8-44c4-ad17-1081e5ed223f'::uuid,
  upgrades.merged_at,
  upgrades.merged_at,
  upgrades.target_user_id::uuid,
  upgrades.source_guest_user_id::uuid,
  'backfill_derived',
  upgrades.source_guest_session_id,
  upgrades.target_workspace_id,
  '{}'::jsonb,
  pg_catalog.jsonb_build_object(
    'backfill', '0120_backfill_product_analytics_server_facts',
    'reconstructed_from', 'auth.guest_upgrade_history'
  )
FROM auth.guest_upgrade_history AS upgrades
WHERE upgrades.target_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND upgrades.source_guest_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE pg_catalog.lower(user_settings.user_id) = pg_catalog.lower(upgrades.target_user_id)
  )
ON CONFLICT (event_id) DO NOTHING;

-- The historical guest upgrade identity links.
--
-- This is what lets the historical guest tail resolve through exactly the same machinery as live
-- data: first_guest_upgrade_link in analytics.product_events_resolved joins on subject_user_id, and
-- a guest-transport request writes the guest user id into user_id and subject_user_id alike, so one
-- link per upgrade resolves both that guest's client events and the events the backend emitted for
-- it. Nothing in the dashboard then needs a special case for old data.
--
-- The pair is keyed on the guest user id rather than on any anonymous_id, because the client's own
-- anonymous_id is not knowable here - which is the same key the live producer uses and for the same
-- reason (guestAuth/index.ts:149-158).
--
-- An upgrade that completed bound maps the identity to itself and is skipped, mirroring the guard
-- at guestAuth/index.ts:148. Rows are grouped so one pair is offered once however many history rows
-- name it, and because the ambiguous-source predicate below has already removed every guest id with
-- more than one target, the group is the pair.
--
-- The three NOT EXISTS clauses below are the whole of what the measurements at the top of this file
-- decided, and they are the only place this file skips a row to protect an irreversible write: a
-- chained upgrade, an ambiguous source, and an upgrade whose guest id is already owned by a
-- server_derived link naming a different account. Each of them would produce a link that is wrong
-- or that displaces a correct one, on a table that is append-only and first-link-wins, so the row
-- is dropped and the notice above says so with a count. The predicates are written exactly as the
-- counts measure them, in pg_catalog.lower and never in a cast, for the reason that section gives.
-- Dropping a row here costs one guest tail that stays unresolved; it does not touch the
-- guest_upgrade_completed event for the same upgrade, which the statement above still writes.
--
-- The grouping and the self-comparison both run in the value space of what is inserted rather than
-- in the raw TEXT of the columns. The regexes below admit either hex case, so two history rows
-- differing only in case are two TEXT groups but one (anonymous_id, user_id) pair, and
-- ON CONFLICT ... DO UPDATE would then raise 21000, "cannot affect row a second time", rolling back
-- the entire release. GROUP BY therefore takes the ::uuid expressions the SELECT list inserts, which
-- is safe because a target-list expression is only evaluated for rows the WHERE clause already
-- admitted; the self-comparison inside that same WHERE uses pg_catalog.lower instead, because a cast
-- there could be evaluated before the regex beside it and would abort on a non-UUID id.
--
-- This is the statement account deletion cares about most: accountDeletion.ts:199-201 deletes
-- exactly these rows to make its pseudonymization irreversible, and re-inserting one would resolve
-- the pseudonym back to a person - which is why the EXISTS below requires the account to still
-- exist. It keys on target_user_id only, and folds case, for the reasons the header section on
-- deletion gives.
--
-- The EXISTS is a best-effort read of the live org.user_settings under this statement's own
-- snapshot; a DELETE /account committing after it and before this file's COMMIT leaves the link
-- written and the pseudonymization reversible for that person. That is the residual the header
-- names, and no second pass over these rows is available even in principle:
-- analytics.identity_links has no backfill_id column, so there is no way to name the rows this run
-- wrote, and the ON CONFLICT ... DO UPDATE below may have rewritten source on a row that already
-- existed rather than inserting one, so even a heuristic would risk deleting a link this file did
-- not create. Deleting somebody else's link to protect against a race is a worse outcome than the
-- race.
--
-- What that leaves is not the whole transaction, and it is worth being exact rather than alarming:
-- this insert is the last write in the file, so its exposure runs from its own snapshot to COMMIT,
-- which is the narrowest window of any write here. If it is ever hit, the compensating action is
-- out-of-band: analytics.identity_links rows for a departed person are exactly what
-- accountDeletion.ts:199-201 removes, so a re-run of that deletion for the affected account removes
-- them again.
--
-- linked_at is the merge's own commit time rather than this migration's clock. It is the server time
-- the link was observed, which is what 0114's comment on that column says it is, and the resolved
-- view orders links by it to decide which one owns an anonymous tail - dating these to today would
-- put every historical upgrade behind any link written since.
--
-- The conflict clause is the analytics writer's own (apps/backend/src/productAnalytics/writer.ts:
-- 111-117): a repeated observation of a pair is not a new fact, and source is the one column it may
-- rewrite, only towards the server. Without that, a client-claimed link left in place on a pair the
-- upgrade itself observed would keep that guest out of the view's server namespace for good.
--
-- That clause is also the one lock this file takes that another transaction can wait on:
-- ON CONFLICT ... DO UPDATE takes LockTupleExclusive on every pre-existing conflicting row before
-- its WHERE is evaluated, and holds it until COMMIT, so a concurrent DELETE /account touching one
-- of those rows waits and then fails on its own lock_timeout. The header's section on what this
-- file blocks says why that is accepted.
INSERT INTO analytics.identity_links (link_id, anonymous_id, user_id, linked_at, source)
SELECT
  pg_catalog.gen_random_uuid(),
  upgrades.source_guest_user_id::uuid,
  upgrades.target_user_id::uuid,
  pg_catalog.min(upgrades.merged_at),
  'server_derived'
FROM auth.guest_upgrade_history AS upgrades
WHERE pg_catalog.lower(upgrades.source_guest_user_id) <> pg_catalog.lower(upgrades.target_user_id)
  AND upgrades.source_guest_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND upgrades.target_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE pg_catalog.lower(user_settings.user_id) = pg_catalog.lower(upgrades.target_user_id)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM auth.guest_upgrade_history AS chained_upgrades
    WHERE pg_catalog.lower(chained_upgrades.source_guest_user_id)
      = pg_catalog.lower(upgrades.target_user_id)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM auth.guest_upgrade_history AS sibling_upgrades
    WHERE pg_catalog.lower(sibling_upgrades.source_guest_user_id)
        = pg_catalog.lower(upgrades.source_guest_user_id)
      AND pg_catalog.lower(sibling_upgrades.target_user_id)
        <> pg_catalog.lower(upgrades.target_user_id)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM analytics.identity_links AS identity_links
    WHERE identity_links.anonymous_id::text = pg_catalog.lower(upgrades.source_guest_user_id)
      AND identity_links.source = 'server_derived'
      AND identity_links.user_id::text <> pg_catalog.lower(upgrades.target_user_id)
  )
GROUP BY upgrades.source_guest_user_id::uuid, upgrades.target_user_id::uuid
ON CONFLICT (anonymous_id, user_id) DO UPDATE
  SET source = EXCLUDED.source
  WHERE identity_links.source <> 'server_derived'
    AND EXCLUDED.source = 'server_derived';
