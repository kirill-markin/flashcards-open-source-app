-- Migration status: Current / one-time backfill.
-- Introduces: one reconstructed analytics.product_events row of event_name 'app_opened' per person
--   and UTC day, rebuilt from the production tables that still hold a trace of somebody having been
--   in a client on that day.
-- Schemas touched/read explicitly: analytics, auth, community, content, org, public, support, sync,
--   pg_catalog.
--
-- 0120 put back the eight facts the backend observes itself and said, in its own list of what it
-- does not reconstruct, that app_opened "belongs to the separate synthetic-days backfill and is
-- deliberately untouched". This is that backfill.
--
--
-- WHAT THIS SERIES IS, AND WHY IT IS NOT EXACT
--
-- Every other row in analytics.product_events is a fact somebody observed. These are not. The true
-- signal - a client telling the backend it was opened - is not retained anywhere and never was:
-- sync.workspace_replicas.last_seen_at is overwritten by the next sync, there is no sync-request log
-- and no session table in any of the schemas above, and CloudWatch keeps a week. So this file does
-- the only thing left, which is to ask of every durable table whether it holds a timestamp that
-- could only have been written because a person was in a client, and to take the union of the days
-- those timestamps name.
--
-- Measured against ground truth on one sampled day, that union named 33 of the 39 people who really
-- opened the app, about 85%. That number is stated in details on every row this file writes and the
-- query that reproduces it on any later day is written out in full below, because a reconstructed
-- series whose accuracy nobody can re-measure is worse than no series at all.
--
-- The instruction this file was written under is explicit and is recorded here so the trade is not
-- re-litigated later: fill the history as fully as the data allows and accept that it is not exact.
-- What that buys is a daily-active-people series that starts before the clients could report one.
-- What it costs is stated, source by source, below.
--
--
-- WHAT COUNTS AS EVIDENCE OF A DAY
--
-- Thirteen traces, each named by the table and column it is read from, each carrying that label into
-- details so a later reader can decide for itself which of them to trust. A person-day supported by
-- sync.hot_changes.recorded_at is a write the server timestamped itself; a person-day supported only
-- by content.review_events.reviewed_at_server may rest on a device clock. Both are stored, and the
-- label is what tells them apart afterwards.
--
--   content.review_events.reviewed_at_server
--     A graded answer. The reviewer is read off the row's own reviewed_by_user_id, which is what
--     0058 introduced the column for and what the insert stores from the request scope
--     (apps/backend/src/cards/review/reviews.ts). The column is not always a server clock reading:
--     the review history import takes it from the request body and stores it through
--     COALESCE($8, now()), which apps/backend/src/productAnalytics/reviewAnswers.ts:33-52 documents
--     in full. For a review that is the hazard reviewAnswers.ts names; for an app-open day it is
--     mostly the opposite, because a guest studying offline for a month really was in the app on
--     each of those days and the imported timestamps are the only record of them. What stays wrong
--     is a device whose clock ran behind, which files the day earlier than it happened. That is a
--     property of the value the import route already stored, it cannot be recovered from anything
--     else, and no floor is applied here for the same reason 0120 applied none: an invented floor
--     would collapse a real offline history onto the day it was uploaded.
--
--   sync.hot_changes.recorded_at
--     A mutable-root write. recorded_at is left to its DEFAULT now()
--     (apps/backend/src/sync/replication/changes.ts:96-103), so it is a server clock reading no
--     client can move. The person is the user of the replica that stamped the change.
--
--   sync.applied_operations_current.applied_at
--     A push batch operation. applied_at is written as an explicit now()
--     (apps/backend/src/sync/replication/push.ts:76-83), so it is a server clock reading too. It
--     overlaps sync.hot_changes heavily and is kept anyway: it is the only one of the two that
--     records a pushed review, and the two are independent tables, so a day either of them holds
--     survives the other being wrong.
--
--   sync.workspace_replicas.created_at
--     The first time that install synced into that workspace.
--
--   sync.workspace_replicas.last_seen_at
--     The last day that replica was confirmed active. Earlier research dismissed this column as
--     worthless because a live replica's value is always today. That is right about it as a live
--     signal and wrong about it as a historical one: for a replica that has stopped syncing the
--     value is frozen and permanently true, and it is the only record of the day that install was
--     last used. apps/backend/src/sync/identity/replica.ts:166 is what makes that argument hold:
--     its re-registration UPDATE really does SET last_seen_at = now(), so a value that is not today
--     is a day that install genuinely stopped moving on. Because this file writes no day at or after
--     its own (see the bounds below), what this column actually contributes is exactly the replicas
--     that went quiet before today.
--
--   auth.guest_sessions.created_at
--     A guest credential being minted. Somebody was in a client for that to happen.
--
--     auth.guest_sessions.last_seen_at is deliberately NOT a fourteenth trace, although the
--     freezing argument above looks like it should carry over to it. It does not, because that
--     column is not a liveness signal at all: no code path anywhere updates it - the only two
--     inserts (apps/backend/src/guestAuth/session/index.ts:187-206) name neither created_at nor
--     last_seen_at, so both take DEFAULT now() inside one statement and are byte-identical
--     (0031:27-28), and no UPDATE auth.guest_sessions touches it in db/migrations or in apps/. The
--     reaper's own header states the same thing and stops trusting it for exactly this reason
--     (apps/backend/src/guestAuth/reaper/index.ts:36-38). Reading it would add no person-day, would
--     cost a second full scan of auth.guest_sessions, and - the part nothing could undo - would
--     write the label 'auth.guest_sessions.last_seen_at' into details beside
--     'auth.guest_sessions.created_at' on every guest-mint day, permanently claiming two
--     independent traces where the schema only ever wrote one.
--
--   auth.user_identities.created_at
--     An account being created. Somebody was in a client to do it.
--
--   auth.guest_upgrade_history.merged_at
--     A guest merging into an account, which is a thing only a person in a client can start.
--
--   community.friend_invitations.created_at and community.friend_invitations.accepted_at
--     An invite link being created, and the same link being consumed. These are two different
--     people on two different days and each is read off the row that names them.
--
--   support.feedback_prompt_events.created_at_server and support.feedback_submissions.created_at_server
--     An in-app feedback prompt shown or dismissed, and feedback submitted. Both are
--     server-stamped defaults and both rows carry a NOT NULL platform.
--
--   sync.catalog_package_install_idempotency.completed_at
--     A catalog deck install committing. Redundant with the hot changes the same install wrote, and
--     kept for the same reason applied_operations is: it is a separate table and a separate record.
--
-- community.friendships is deliberately NOT among them, although the plan this file was written from
-- listed it. Accepting an invitation inserts two directed rows at one instant, one for each person,
-- and reading the day off each row's viewer_user_id would place the inviter in a client on the day
-- their invitation happened to be accepted - which is a day they need not have opened anything. The
-- two people are already named exactly by community.friend_invitations: the inviter by created_at,
-- the acceptor by accepted_at and accepted_by_user_id. So nothing is lost and one systematic false
-- day per accepted invitation is avoided.
--
-- ai.chat_runs is not read either, and neither is any replica whose actor_kind is 'ai_chat'. The
-- ai_chat replica is one shared row per workspace (its actor_key is `${devicePlatform}:chat`,
-- apps/backend/src/sync/identity/aiChatIdentity.ts), its user_id is rewritten to whichever member
-- most recently chatted, and its platform is the hardcoded 'web' that
-- apps/backend/src/productAnalytics/serverEvents.ts:48-51 says describes no device. A chat turn
-- happens inside a client whose own replica moves on the same day, so what this costs is close to
-- nothing and what it avoids is dating a shared, rewritten label to a person.
--
-- Replicas whose actor_kind is 'workspace_seed' or 'workspace_reset' are not read for the plainer
-- reason that they are the backend, not a client: their platform is 'system'.
--
--
-- PLATFORM, WHICH IS THE PART OF THIS FILE MOST ABLE TO BE PERMANENTLY WRONG
--
-- 0120 wrote no platform anywhere and said why: every live server-derived producer passes
-- platform: null, so a backfilled row naming one would disagree with the live stream. This file has
-- no such escape, because the whole reason the daily-active-people block needs a platform is that
-- one number would be a lie without it. A mobile guest session is minted when the app opens. A web
-- guest session is minted on the first real interaction with a page, which is a site visit and not
-- app usage. Those two must never be added together, and the platform column is what keeps them
-- apart.
--
-- The rule the producers work under is on ServerDerivedProductAnalyticsEvent
-- (apps/backend/src/productAnalytics/serverEvents.ts:22-65) and it is not a mapping to copy: a
-- producer justifies its own derivation against the rows it actually reads, and null is always a
-- correct answer. So platform is derived once per evidence source, and each derivation is stated
-- here rather than assumed.
--
--   From sync.workspace_replicas, for the five branches that take their person from a replica - the
--   two replica columns themselves, sync.hot_changes and sync.applied_operations_current through
--   their replica_id, and sync.catalog_package_install_idempotency through its
--   last_modified_by_replica_id - platform is
--   read only together with actor_kind on the same row, which is the hard requirement that comment
--   states. A 'client_installation' replica is one physical install: it is created from a
--   sync.installations row whose platform CHECK admits only ios, android and web (0035:10), and
--   apps/backend/src/sync/identity/replica.ts types that path as SyncClientPlatform and keeps
--   platform in the WHERE of its re-registration UPDATE, so the value never changes and never
--   becomes 'system'. That value is used as stored. An 'agent_connection' replica is the terminal
--   and MCP client, and the column does not describe it: every agent connection registers the
--   literal 'web' (apps/backend/src/agent/syncIdentity.ts:18), which names the wrong client
--   outright. So the column is never read for this actor kind and the value written is 'agent',
--   derived from the actor kind exactly as the catalog says it must be, because no stored column
--   anywhere holds it. Every other actor kind contributes no row at all, so no derivation is owed
--   for it.
--
--   A CONSUMER WARNING ON THE 'agent' BUCKET, because this file is the only place it can be given.
--   An agent_connection replica is moved by whatever drives the machine API, and that need not be a
--   person: a polling or scheduled MCP client re-registers and writes hot changes on a timer, so it
--   files a genuine-looking reconstructed app_opened day for its owner on every calendar day it
--   runs. Nothing here can tell that apart from the same person opening the terminal client daily,
--   and the 'agent' platform is the only handle a reader has on it. A daily-active-people chart
--   should therefore split on platform rather than sum over it, and should treat the 'agent' series
--   as an upper bound on human agent use rather than as a count of people.
--
--   The replica is always the one row the fact itself names - a review's replica_id, a hot change's
--   replica_id, a push's replica_id, an install's last_modified_by_replica_id - and never a lookup
--   by workspace, which the same comment warns can return an unrelated replica.
--
--   From auth.guest_sessions, platform is read straight off the session row. That is the one
--   platform column serverEvents.ts:57-60 calls safe to read directly: guest_sessions_platform_check
--   admits ios, android and web and nothing else (0116), so it never holds a non-client value. It is
--   nullable for pre-1.7.0 mobile clients and that null passes through as null.
--
--   From support.feedback_prompt_events and support.feedback_submissions, platform is read off the
--   row. Both columns are TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')) (0052) and are
--   the client's own report of itself on a first-party route.
--
--   From content.review_events the person comes from the row and only the platform comes from the
--   replica, so the replica is joined LEFT: a review whose replica is a backend actor still counts
--   as a day and simply carries no platform.
--
--   From auth.user_identities, auth.guest_upgrade_history and community.friend_invitations, platform
--   is NULL. None of those tables stores one, and none of them can be joined to a client: an account
--   is created through the auth service, and the guest session a merge names is deleted by the
--   merge's own cleanup phase before this file could read its platform
--   (apps/backend/src/guestAuth/delete/index.ts:52). A guess would be a permanent invention on an
--   append-only table, so null is written instead.
--
-- A day may be supported by evidence from more than one platform, because a person can open the
-- phone and the browser on the same day. One row cannot name two, so the row carries a platform only
-- when every piece of evidence for that person-day that names one names the same one, and null
-- otherwise. The count of days that lost their platform that way is announced as a notice below,
-- because it is the honest measure of how much of this series can be split by platform at all.
--
-- Nothing in apps/backend/src/chat/ is touched to make any of this neater. Changing devicePlatform
-- there would mint new replica identities inside existing workspaces, which is a live sync change
-- dressed up as an analytics fix.
--
--
-- SEPARATING THIS SERIES FROM THE CLIENT SERIES, WHICH IS THE LOAD-BEARING PART
--
-- There is no server-side app_opened producer: the clients emit this event themselves through the
-- analytics ingest route, carrying their own UUIDv7 event ids. So unlike
-- every row 0120 wrote, the rows below share no derived-id space with anything live. They cannot
-- collide with a client's row on the primary key, which means ON CONFLICT (event_id) DO NOTHING
-- cannot suppress an overlap and nothing stops a reconstructed day and a reported day for the same
-- person from both being stored and counted twice, permanently, on an append-only table with no
-- repair path.
--
-- THE CLIENT SERIES IS ALREADY LIVE, AND THAT IS THE FACT THIS SECTION IS BUILT ON. The web app
-- emits app_opened cold and warm from apps/web/src/analytics/AnalyticsLifecycle.tsx:23,45;
-- AnalyticsLifecycle is mounted unconditionally at apps/web/src/App.tsx:794; analytics is on unless
-- the person turned it off (apps/web/src/analytics/identity.ts:191); and POST /analytics/events is
-- a deployed route (infra/aws/lib/gateways/api-gateway.ts:1107-1109). The iOS and Android clients
-- emit it too and reach their stores on their own cadence. So "the days between this file running
-- and each client's own app_opened shipping" is NOT the seam this file has to manage. Overlap is
-- present on the day this file runs and on every day before it back to whenever the web client
-- first reported, and one more already-covered day appears for every day this file waits to be
-- released.
--
-- Two bounds are therefore applied, and both are computed from the database rather than written as
-- a date, so this file is correct whatever UTC day the release actually lands on.
--
--   1. Nothing at or after now. No evidence instant at or after this migration's own clock is read
--      at all, and no day at or after the UTC day this migration runs on is written. The reason is
--      no longer only the overlap: the current UTC day is a partial day whose evidence is still
--      being written, so a row for it would understate itself forever.
--
--   2. Nothing the app_opened series already holds - which today means nothing the client series
--      already reports, because nothing else writes that event name. Every (person, UTC day) that
--      already carries an app_opened row in analytics.product_events is collected once into a temp
--      table below, and the insert anti-joins against it. The predicate is deliberately on
--      event_name alone rather than on origin = 'client', so a later server-derived producer, and a
--      replay of this file itself, fall under the same invariant without an edit to a merged
--      migration. This is exact, it is immune to a device clock, and it is
--      the direct expression of the one-row-per-person-day invariant this file already has: a
--      person-day the clients cover is dropped, and a person-day they do not cover is still
--      reconstructed, which is the whole point of running this at all.
--
-- A GLOBAL DATE FLOOR WAS CONSIDERED AND REJECTED, and the reasoning is recorded so it is not
-- proposed later as the simpler answer. Bounding the whole backfill below the first client
-- app_opened day would throw away every reconstructed day inside that window, including the large
-- majority the clients never reported - a mobile install that has not updated yet, a person who
-- turned analytics off, a guest studying offline. Deriving that floor from the client rows'
-- occurred_at would also be deriving it from a column the device influences. occurred_at on a client
-- row is skew-corrected against the server clock and cannot leave
-- [server_received_at - 30 days, server_received_at]
-- (correctClockSkew and productAnalyticsMaxEventAgeMs, apps/backend/src/productAnalytics/
-- validation.ts:24,207-223), so it cannot land years in the past, but a single device that queued
-- events for weeks still drags such a floor a month backwards and truncates the backfill by a month
-- for everyone. The anti-join has no floor to collapse: it compares one person-day against the same
-- person-day, so a skewed or long-queued client row can only ever suppress the single reconstructed
-- day it actually names, which is precisely the day that would have been a duplicate.
--
-- THE RESIDUAL, PLAINLY. The anti-join reads a snapshot, so it cannot see a client row that has not
-- arrived yet. A client that was offline can deliver an app_opened for a day before this migration
-- ran, after this migration ran, and that person-day is then counted twice. The window is bounded
-- rather than open: the ingest route rejects occurred_at_out_of_window beyond 30 days, and the web
-- client's own queue expires records at 14 days (analyticsQueueTtlMs,
-- apps/web/src/analytics/queue.ts:19), so the exposure is the last 30 days before this file runs and
-- nothing older. It is accepted because the alternative - discarding the last 30 days of the
-- reconstruction outright - loses far more real days than the few duplicates it prevents, and
-- because a reader can find them: a duplicated person-day is one row with origin = 'backfill' and
-- one with origin = 'client', and this file's rows all carry backfill_id
-- 2b389b46-2215-4b2f-8e48-81a6499939a4.
--
--
-- ONE ROW PER PERSON AND UTC DAY
--
-- event_id is analytics.derive_server_event_id('app_opened', ARRAY[user_id, day]), where user_id is
-- the canonical lowercase hyphenated hex of the person's id and day is the UTC calendar day rendered
-- as YYYY-MM-DD. Two pieces of evidence for one person-day therefore derive one id and are stored
-- once, and re-running this file inserts nothing.
--
-- That derivation is only unambiguous because both parts are fixed-shape. 0119's function joins the
-- salt, the event name and the key parts with a single ':' and writes no length prefix between them,
-- so two key vectors that differ only in where a boundary falls would derive one id. Here the first
-- part is always exactly 36 characters of canonical UUID text - the regexes below admit nothing else
-- and every value is lowered before it is stored, which on a value already proved to be hyphenated
-- hex is exactly what ::uuid::text would render - and the second is always exactly 10 characters of
-- YYYY-MM-DD. No repositioning of the boundary between a 36-character part and a 10-character part
-- is possible, so no two distinct person-days can collide.
--
-- The day is rendered with pg_catalog.to_char over pg_catalog.timezone('UTC', ...) rather than by
-- casting the timestamp to text, because a cast to text formats in the session's DateStyle and would
-- render 08/29/2026 under 'SQL, MDY'. That would make the derived id depend on a session setting the
-- appliers of this file do not agree on. For the same class of reason the day itself is
-- pg_catalog.date_trunc('day', ..., 'UTC'), whose third argument fixes the zone the truncation
-- happens in instead of taking the session's TimeZone.
--
-- The grouping below already produces exactly one row per person-day, so the ON CONFLICT
-- (event_id) DO NOTHING on the insert is not covering duplicates inside its own statement. It is
-- there for a replay against a database that already holds these rows, where in practice the
-- existing-app-opened-days anti-join gets there first: this file's own earlier rows are app_opened
-- rows carrying a user_id, so they are collected into that set like any other and the replay selects
-- nothing to insert at all.
--
--
-- subject_user_id EQUALS user_id ON EVERY ROW
--
-- Two independent rules force it and they point the same way. analytics.product_events_resolved's
-- first_guest_upgrade_link joins on subject_user_id alone (0115:111-124), so a guest's day with a
-- NULL there would stay stranded on the guest identity for good on an append-only table, counting
-- one person as a guest actor and an account actor both. And anonymizeProductAnalyticsInExecutor
-- selects the rows to rewrite with WHERE user_id = ANY(...) and then rewrites subject_user_id blind
-- (apps/backend/src/auth/accountDeletion.ts:177-195), so an id reachable only through
-- subject_user_id would outlive a deletion the sweep believed it had covered. Writing one id into
-- both columns satisfies both, and it is what the live content and review producers do with their
-- own actor (contentCreations.ts:161-162, reviewAnswers.ts:232-233).
--
-- These rows do name guest identities, deliberately. A guest is a person in the app, and separating
-- the mobile guests from the web guests is the reason the platform column above exists. The guest's
-- own id goes into both columns and the upgrade link 0120 wrote resolves it to the account later,
-- through exactly the same machinery a guest's client events go through.
--
--
-- ACCOUNT DELETION IS ONE-WAY AND NOTHING HERE MAY UNDO IT
--
-- apps/backend/src/auth/accountDeletion.ts anonymizes a departed person's analytics history rather
-- than erasing it: it rewrites user_id and subject_user_id to a pseudonym it stores nowhere, clears
-- every other joinable column, deletes every analytics.identity_links row keyed on their ids and
-- deletes their org.user_settings row. Its own comments say why that is final - no mapping survives
-- anywhere and the anonymization "runs once and can never be reapplied". A row written here after
-- that sweep has run, carrying a real user_id, would re-create precisely what the deletion removed,
-- on an append-only table with no repair path.
--
-- This file reads more tables that outlive that deletion than 0120 did, so the mechanism protecting
-- each of them is named individually:
--
--   * Cascaded away before this file could read them. content.review_events.reviewed_by_user_id is
--     a foreign key ON DELETE SET NULL (0058:11-12) and a NULL fails the regex, so the row drops.
--     auth.guest_sessions.user_id and auth.user_identities.user_id (0031),
--     community.friend_invitations.inviter_user_id (0063:9),
--     support.feedback_prompt_events.user_id and support.feedback_submissions.user_id (0052) are all
--     foreign keys ON DELETE CASCADE, so those rows no longer exist.
--     community.friend_invitations.accepted_by_user_id is ON DELETE SET NULL (0063:15) and a NULL
--     fails the regex too.
--   * Surviving with the person's real id and no foreign key of any kind.
--     sync.workspace_replicas.user_id is plain TEXT (0035:23) and account deletion removes only
--     sole-member workspaces, so a shared workspace that outlives one member keeps that member's id
--     on its replica rows - which reaches sync.hot_changes,
--     sync.applied_operations_current and sync.catalog_package_install_idempotency as well, since
--     all three take their person from that column. auth.guest_upgrade_history has no foreign keys
--     at all (0034) and is append-only, which is exactly the threat accountDeletion.ts documents at
--     its loadAnalyticsUserIdsForPersonInExecutor.
--
-- What stands between that and the row written below is a single EXISTS against the live
-- org.user_settings on the one id every row of this file writes. There is one insert into
-- analytics.product_events here, not seven, so there is one guard, and it covers every evidence
-- source at once - including the cascaded ones, because a cascade only proves a deletion happened
-- before that statement's snapshot and says nothing about one committing after it.
--
-- The guard folds case on both sides. 0120 used raw equality where a foreign key made the column
-- byte-identical to org.user_settings and folded only where none existed; here one predicate covers
-- a union of both kinds, so it has to be correct for the unconstrained ones, and folding an id that
-- a foreign key already made byte-identical changes nothing. The premise is the one 0120's header
-- settles: an unconstrained TEXT id column may hold either hex case, the value written is the id
-- cast to UUID, and account deletion matches its rows in that same UUID space
-- (WHERE user_id = ANY($2::uuid[]), accountDeletion.ts:177-195), so the question the guard must
-- answer is whether a live account exists with that UUID and not with that byte string. Folding is
-- used instead of a cast because a cast the planner may evaluate before the regex would abort the
-- whole release on the first non-UUID id a local AUTH_MODE=none database holds.
--
-- THE RESIDUAL, PLAINLY. Nothing here locks org.user_settings, and that is a decision rather than an
-- omission. 0120's own header records the alternative in full so it is not re-proposed later as an
-- improvement, and the reasoning is unchanged here. Materializing the live ids under a whole-table
-- FOR KEY SHARE does close the race, and simultaneously blocks every authenticated request:
-- loadAuthenticatedRequestContext calls ensureCognitoUserProfileFn or ensureUserProfileFn on every
-- authenticated request on both transports (apps/backend/src/server/requestContext.ts:148-150), and
-- both reach an INSERT ... ON CONFLICT (user_id) DO UPDATE followed by SELECT ... FOR UPDATE on the
-- same row (apps/backend/src/auth/ensureUser.ts:44-68), each of which conflicts with FOR KEY SHARE.
-- That is a certain authenticated-API outage for as long as this migration runs, on every release
-- carrying it, and it can deadlock against a concurrent guest merge. Locking only the
-- ids this backfill touches is not the narrower answer it looks like either: a person whose id is in
-- the backfill would still block on their own request, which is the same harm in a smaller window at
-- much higher complexity. So the race is accepted. The guard reads org.user_settings under this
-- statement's own READ COMMITTED snapshot, and a DELETE /account committing after that read and
-- before this file's COMMIT is invisible to it: the rows written for that person survive carrying
-- their real user_id and subject_user_id, with the anonymization sweep already past. Nothing
-- re-reads them afterwards and no statement of this file deletes from analytics.product_events.
-- That window is one statement wide here, which is the narrowest this shape can be.
--
-- The cost of the guard is an undercount, and it is larger here than it was in 0120. A guest that
-- has already upgraded has no org.user_settings row at all - phase 12 of the merge deletes it
-- (apps/backend/src/guestAuth/upgrade/index.ts calling
-- apps/backend/src/guestAuth/delete/index.ts:52) - so every day that person spent as a guest is
-- dropped, and their guest workspace went with it, taking its replicas and hot changes. The account
-- they became is still covered from the merge day onward. That is the trade this schema makes
-- everywhere: a missing row leaves a fact uncounted, a wrong one is permanent, and here a wrong one
-- would also be a privacy regression.
--
--
-- WRITES THAT LOOK LIKE A PERSON AND ARE NOT
--
-- Three of the sources above are written by things other than a person in a client, and each would
-- otherwise fabricate a day.
--
--   * A migration's own bulk write. 0073 inserted one sync.hot_changes row per card and deck it
--     touched, 0078 one per card it repaired, and 0088 one per media asset that was missing one -
--     all under real client replicas, all with recorded_at left to DEFAULT now(). Left alone, each
--     of those would place every affected person in the app on the single day that migration ran,
--     which in a daily-active-people chart is a wall rather than a blip. Two things exclude them.
--     The first is exact and permanent: every applier of this repository's migrations that a
--     deployed environment uses inserts the public.schema_migrations row inside the same transaction
--     as the file - the migration Lambda's runner does
--     (apps/backend/src/database/migrationRunner.ts, applyPendingMigrations) and so does the
--     PostgreSQL integration harness (apps/backend/scripts/postgresIntegrations/migrations.mjs) -
--     and both that row's applied_at DEFAULT and a migration's own DEFAULT now() resolve to the
--     transaction's start, so they are the same instant to the microsecond. An evidence instant that
--     equals a public.schema_migrations.applied_at was therefore written by a migration, and is
--     dropped below. That predicate fails open rather than closed: on a database migrated by
--     scripts/deploy/migrate.sh the schema_migrations insert is a separate psql invocation in its
--     own transaction, so applied_at is later than the file's now(), the predicate matches nothing
--     and the spike survives there. It cannot invent a row either way. The second exclusion is a
--     belt for that brace and holds on any applier: 0073 and 0078 both wrote a literal
--     'migration-...' operation_id, so hot changes carrying that prefix are dropped outright. The
--     public.schema_migrations dependency is safe to take because the table is created by every
--     applier before any file runs and the runner already reads it under that exact name.
--   * Server-side work settling outside the person's session. A generated-media promotion job
--     carries the replica id of the person who asked for the image
--     (apps/backend/src/chat/cardImages/promotion/jobs.ts) and settles asynchronously, and 0104's
--     access-revocation failure path writes a hot change under that same replica, so either can land
--     on the UTC day after the chat that started it. Neither is excluded: their operation ids are
--     opaque UUIDs, telling them apart from a person's own write means reading further tables, and
--     what it would buy is at most one extra day for one person, occasionally. It is named here so
--     it is not rediscovered later as a defect.
--   * A guest merge. 0120 excluded hot changes stamped by one, because the merge re-inserts a whole
--     guest library in a single transaction and its creations statement would have read that as a
--     burst of authoring. That predicate is deliberately not reused here, and not because it is
--     wrong - it holds for the reason 0120 gives, that merged_at is omitted from the upgrade's own
--     insert column list and takes DEFAULT now() while the history write and the hot changes run on
--     one executor - but because for this file the day it names is true. Somebody performed that
--     upgrade in a client that day, which is why auth.guest_upgrade_history.merged_at is itself one
--     of the sources above. Excluding those hot changes would remove a real day, not a fabricated
--     one.
--
--
-- WHAT IS NOT RECONSTRUCTED
--
--   * Which screen was seen, or how long anything lasted. The catalog entry for app_opened requires
--     no screen, and the session and onboarding events the catalog revision retired are not coming
--     back through this file.
--   * Whether the launch was cold or warm. launch_type is written as 'unknown', which
--     apps/backend/src/productAnalytics/catalog.ts:202-213 added for exactly this and describes as
--     the value for "a day reconstructed from stored activity long after the fact". The property
--     stays present rather than absent so "we do not know" is a stored fact.
--   * How many times a person opened the app on a day. One row per person-day is the whole
--     resolution this evidence has.
--   * workspace_id and guest_session_id, which stay NULL. A day is not workspace-scoped, a person
--     can be in several workspaces and several guest sessions on one day, and picking one would be
--     an invention. Leaving them NULL also keeps two more joinable columns out of a row that account
--     anonymization would otherwise have to clear.
--   * Anybody whose account or guest identity is already gone. The section above says by which
--     mechanism.
--   * The UTC day this file runs on, and every day after it. That day is partial and the clients
--     are already reporting it themselves, for the reason the separation section gives.
--   * Any person-day the client series already reports. Those days are not missing from the data -
--     they are present, once, as the client rows that reported them. This file adds nothing to a
--     day the clients already cover and only fills the days they do not.
--
--
-- THE ROW SHAPE
--
-- Every row carries origin = 'backfill' and trust_level = 'backfill_derived', both admitted by
-- product_events_origin_valid and product_events_trust_level_valid (0114), and the one backfill_id
-- of this run, which product_events_backfill_id_shape requires exactly for that origin. That id is
-- 2b389b46-2215-4b2f-8e48-81a6499939a4, distinct from the 139bd2f2-12b8-44c4-ad17-1081e5ed223f
-- 0120 used, so the two reconstructions stay separable forever. It is a literal rather than
-- gen_random_uuid() so every environment this file replays on names the run by the same value.
--
-- client_occurred_at, client_sent_at, session_id and anonymous_id stay NULL, which
-- product_events_client_columns_shape (0114) requires for any origin but 'client'.
--
-- details carries three keys: the file that wrote the row, a free-text note saying that the row is a
-- reconstruction and what its measured coverage was, and the array of evidence labels that placed
-- this person on this day. It is bound by product_events_details_shape (0119) to
-- a JSON object under 2000 bytes measured on the jsonb text rendering, and by
-- product_events_details_client_shape to origin <> 'client', which holds. The bound is met with room
-- to spare in the worst case: the thirteen evidence labels are 503 characters of text between them,
-- which with their quoting, separators and the array's own key renders to about 570 bytes, and the
-- note and the file name add about 340 more. A row supported by every source at once therefore
-- renders to roughly 910 bytes.
--
-- The note carries no date, deliberately. An earlier draft hardcoded the UTC day the release was
-- expected to land on, which would have been a false claim on every row the moment the release
-- slipped by a day, and would have contradicted the TIMESTAMPS section below: ingested_at is left
-- to its DEFAULT and is the single record of when this backfill ran, so details does not repeat it
-- and must not restate it wrongly. A reader who wants the run date reads ingested_at, or selects on
-- backfill_id = 2b389b46-2215-4b2f-8e48-81a6499939a4.
--
-- Nothing in details identifies a person, which is the rule 0119's column comment states and which
-- matters because this column survives account anonymization untouched. A table name is not a
-- person.
--
--
-- TIMESTAMPS
--
-- occurred_at is the UTC day boundary, which means every row of this series lands at 00:00:00Z. That
-- is a real consequence worth naming: any chart that buckets these rows by hour of day will show the
-- whole reconstruction stacked on midnight UTC. There is nothing better available, because the
-- evidence for one day is several instants and the row is a day rather than any one of them.
--
-- server_received_at is the same value. It is NOT NULL and something has to go in it, and the two
-- honest candidates are this and the last evidence instant of the day. The second is rejected
-- because it would imply a precision the row does not have and would invite a reader to treat it as
-- the moment a session ended. The skew between the two columns, which for a live producer is the
-- recoverable difference between when a thing happened and when the backend learned of it, is simply
-- not defined for a row like this.
--
-- ingested_at is left to its DEFAULT on every row, so it records when this backfill ran, which is
-- what 0114 says that column is for: "A backfilled or long-offline event has an old occurred_at and
-- a new ingested_at, and that is intentional." details therefore does not repeat it.
--
-- All statements in one migration file run inside a single transaction (applyPendingMigrations in
-- apps/backend/src/database/migrationRunner.ts wraps each file in BEGIN/COMMIT), so pg_catalog.now()
-- below is one fixed instant shared by the temp tables, the notices and the insert. That is what
-- makes the two bounds a single consistent line rather than several slightly different ones.
--
--
-- EFFECT ON THE WEB GUEST REAPER, WHICH THIS FILE DOES CHANGE
--
-- The reaper measures a web guest's liveness as GREATEST(MAX(occurred_at), MAX(ingested_at)) over
-- that guest's analytics.product_events rows, falling back to its newest session's created_at when
-- it has none, and permanently deletes the identity once that value is older than 90 days
-- (apps/backend/src/guestAuth/reaper/index.ts:250-275, webGuestInactivityThresholdDays at :42). The
-- job runs cron(30 4 * * ? *) with state ENABLED (infra/aws/lib/scheduled-jobs/web-guest-reaper.ts:
-- 30,140). 0120 cleared this by proving no row it wrote could carry a web
-- guest's user_id. THIS FILE CANNOT MAKE THAT CLAIM, and the interaction is stated here rather than
-- discovered later.
--
-- auth.guest_sessions.created_at is an evidence source, a web guest's user_id has an
-- org.user_settings row - guest_sessions.user_id is a foreign key to it (0031:26) - so it passes the
-- EXISTS guard, and every row this file writes takes ingested_at DEFAULT now(). So for every web
-- guest that gets a row, GREATEST(...) becomes the migration instant and its permanent deletion is
-- pushed out to migration-run + 90 days.
--
-- The size of it, and its shape. A web guest is refused on every authenticated surface except
-- analytics ingest (apps/backend/src/guestAuth/webPlatform.ts through the default-deny gate in
-- apps/backend/src/server/requestContext.ts), so it answers no review, writes no card, holds no
-- client-installation or agent-connection replica, creates no invitation and never upgrades:
-- auth.guest_sessions.created_at is the only one of the thirteen traces that can name one. It is
-- stated that way rather than as "no replica at all" because a web guest does own an auto-created
-- workspace, and workspace bootstrap writes a 'workspace_seed' replica into every workspace in the
-- same transaction as org.workspaces (apps/backend/src/guestAuth/reaper/index.ts:56-58). What keeps
-- that row out of this file is the actor_kind IN ('client_installation', 'agent_connection') filter
-- that every one of the five replica-sourced branches below carries. That makes the effect exactly
-- one reconstructed row per web guest per UTC day on which that guest minted a session - at most
-- one row per auth.guest_sessions row with platform = 'web', and usually one row per web guest in
-- total. It is a ONE-TIME SHIFT rather than a standing reprieve: this file runs once, writes each
-- such row once, and nothing re-stamps ingested_at afterwards, so 90 days after this migration
-- every affected web guest becomes reapable again on the same terms it would have been. No guest is
-- made un-reapable, none is made reapable earlier, and the identity links 0120 wrote are untouched.
--
-- Excluding web guests to avoid this was considered and rejected. Separating web-guest site visits
-- from mobile-guest app opens is the stated reason the platform column above exists at all, so
-- dropping the web guests would remove the very rows that make that split measurable. A 90-day
-- delay on deleting an already-empty identity is a much smaller cost than a permanently
-- unmeasurable series, and unlike the series it repairs itself.
--
--
-- CALIBRATION, WHICH IS THE ONLY HONEST WAY TO STATE THIS SERIES' ACCURACY
--
-- The query below reproduces the 85% measurement on any later day, and it stays runnable forever
-- because it depends on nothing this file writes. Run it as the migration owner; several of these
-- tables are not readable by reporting_readonly, which does not matter for a calibration.
--
-- It works because sync.workspace_replicas.last_seen_at is a true statement about today for every
-- replica that is syncing today. So today, and only today, that column is ground truth: it names the
-- people who were actually in a client. The comparison set is the same union this file builds,
-- minus that one column, which is exactly the position a past day is in once last_seen_at has been
-- overwritten. The ratio of the second output to the first is this series' coverage.
--
-- The third output is the other direction and is not a defect count: it is the people this union
-- names whom the replicas do not, which is mostly web guests, who hold no client-installation or
-- agent-connection replica and so are absent from the ground-truth set the query above builds.
--
-- WITH measured_day AS (
--   SELECT pg_catalog.date_trunc('day', pg_catalog.now(), 'UTC') AS utc_day
-- ),
-- ground_truth AS (
--   SELECT DISTINCT pg_catalog.lower(replicas.user_id) AS user_id
--   FROM sync.workspace_replicas AS replicas
--   CROSS JOIN measured_day
--   WHERE replicas.actor_kind IN ('client_installation', 'agent_connection')
--     AND pg_catalog.date_trunc('day', replicas.last_seen_at, 'UTC') = measured_day.utc_day
-- ),
-- recovered AS (
--   SELECT DISTINCT observations.user_id
--   FROM (
--     SELECT pg_catalog.lower(review_events.reviewed_by_user_id) AS user_id,
--            review_events.reviewed_at_server AS observed_at
--       FROM content.review_events AS review_events
--     UNION ALL
--     SELECT pg_catalog.lower(replicas.user_id), hot_changes.recorded_at
--       FROM sync.hot_changes AS hot_changes
--       JOIN sync.workspace_replicas AS replicas ON replicas.replica_id = hot_changes.replica_id
--      WHERE replicas.actor_kind IN ('client_installation', 'agent_connection')
--        AND hot_changes.operation_id NOT LIKE 'migration-%'
--     UNION ALL
--     SELECT pg_catalog.lower(replicas.user_id), applied_operations.applied_at
--       FROM sync.applied_operations_current AS applied_operations
--       JOIN sync.workspace_replicas AS replicas ON replicas.replica_id = applied_operations.replica_id
--      WHERE replicas.actor_kind IN ('client_installation', 'agent_connection')
--     UNION ALL
--     SELECT pg_catalog.lower(replicas.user_id), replicas.created_at
--       FROM sync.workspace_replicas AS replicas
--      WHERE replicas.actor_kind IN ('client_installation', 'agent_connection')
--     UNION ALL
--     SELECT pg_catalog.lower(guest_sessions.user_id), guest_sessions.created_at
--       FROM auth.guest_sessions AS guest_sessions
--     UNION ALL
--     SELECT pg_catalog.lower(user_identities.user_id), user_identities.created_at
--       FROM auth.user_identities AS user_identities
--     UNION ALL
--     SELECT pg_catalog.lower(upgrades.target_user_id), upgrades.merged_at
--       FROM auth.guest_upgrade_history AS upgrades
--     UNION ALL
--     SELECT pg_catalog.lower(invitations.inviter_user_id), invitations.created_at
--       FROM community.friend_invitations AS invitations
--     UNION ALL
--     SELECT pg_catalog.lower(invitations.accepted_by_user_id), invitations.accepted_at
--       FROM community.friend_invitations AS invitations
--      WHERE invitations.accepted_at IS NOT NULL
--        AND invitations.accepted_by_user_id IS NOT NULL
--     UNION ALL
--     SELECT pg_catalog.lower(prompt_events.user_id), prompt_events.created_at_server
--       FROM support.feedback_prompt_events AS prompt_events
--     UNION ALL
--     SELECT pg_catalog.lower(submissions.user_id), submissions.created_at_server
--       FROM support.feedback_submissions AS submissions
--     UNION ALL
--     SELECT pg_catalog.lower(replicas.user_id), installs.completed_at
--       FROM sync.catalog_package_install_idempotency AS installs
--       JOIN sync.workspace_replicas AS replicas
--         ON replicas.replica_id = installs.last_modified_by_replica_id
--      WHERE replicas.actor_kind IN ('client_installation', 'agent_connection')
--   ) AS observations
--   CROSS JOIN measured_day
--   WHERE observations.user_id IS NOT NULL
--     AND pg_catalog.date_trunc('day', observations.observed_at, 'UTC') = measured_day.utc_day
--     AND NOT EXISTS (
--       SELECT 1
--       FROM public.schema_migrations AS migrations
--       WHERE migrations.applied_at = observations.observed_at
--     )
-- )
-- SELECT
--   (SELECT pg_catalog.count(*) FROM ground_truth) AS people_the_replicas_saw,
--   (
--     SELECT pg_catalog.count(*)
--     FROM ground_truth AS truth
--     WHERE EXISTS (SELECT 1 FROM recovered WHERE recovered.user_id = truth.user_id)
--   ) AS people_this_union_recovers,
--   (
--     SELECT pg_catalog.count(*)
--     FROM recovered AS found
--     WHERE NOT EXISTS (SELECT 1 FROM ground_truth AS truth WHERE truth.user_id = found.user_id)
--   ) AS people_only_this_union_names;
--
--
-- WHY sync.hot_changes IS ALLOWED TO BE EVIDENCE AT ALL
--
-- Because it is never pruned, and that is load-bearing rather than incidental. The retention floor
-- the schema provides for it, sync.workspace_sync_metadata.min_available_hot_change_id (0028), is
-- only ever written as the literal 0 - every INSERT that names that column, in db/migrations and in
-- apps/backend/src/ alike, writes 0 into it, and no UPDATE of it exists anywhere - and there is no
-- DELETE FROM sync.hot_changes anywhere in the application, in a scheduled job or in a migration. The table is partitioned by
-- recorded_at with a DEFAULT partition, so nothing ages out of it either. If that ever changes, this
-- source silently stops covering the pruned window and the calibration query above is what would
-- show it. The same holds for sync.applied_operations_current, whose table comment calls it a
-- bounded ledger but which nothing in this repository bounds.

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
-- statement and not this file. At the scale this file was measured against - about 124k
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
CREATE TEMP TABLE migration_0121_app_open_evidence (
  user_id         TEXT        NOT NULL,
  occurred_on     TIMESTAMPTZ NOT NULL,
  platform        TEXT,
  evidence_source TEXT        NOT NULL
) ON COMMIT DROP;

INSERT INTO migration_0121_app_open_evidence (user_id, occurred_on, platform, evidence_source)
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
CREATE TEMP TABLE migration_0121_existing_app_opened_days (
  user_id     TEXT        NOT NULL,
  occurred_on TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, occurred_on)
) ON COMMIT DROP;

INSERT INTO migration_0121_existing_app_opened_days (user_id, occurred_on)
SELECT DISTINCT
  pg_catalog.lower(reported_events.user_id::text),
  pg_catalog.date_trunc('day', reported_events.occurred_at, 'UTC')
FROM analytics.product_events AS reported_events
WHERE reported_events.event_name = 'app_opened'
  AND reported_events.user_id IS NOT NULL;

-- What this file leaves out, measured rather than assumed, and announced rather than left silent.
--
-- Nothing below branches on these counts and nothing raises. This file is about to become the
-- --require-migration value in .github/workflows/aws-web-release.yml and the databaseMigrationGate
-- argument in infra/aws/lib/stack.ts, so a RAISE EXCEPTION here would not cost a rerun - it would
-- block AWS/Web Release, and every unrelated change riding it, until somebody edited a merged
-- migration file or hand-inserted a schema_migrations row, both out-of-band database operations this
-- repository's CI/CD-only rule forbids and neither of them something a rerun can do for itself.
-- Every condition measured here is also permanent rather than transient: a day is either before this
-- migration's own day or it is not, and an account is either gone or it is not, so a retry would
-- find the same thing. Skipping and reporting is the only response that makes sense.
--
-- PostgreSQL sends a notice to the client rather than to any log a release could read afterwards,
-- and node-postgres drops one that nothing listens for, so the migration client subscribes to the
-- 'notice' event and writes each one to stdout, which is the migration Lambda's CloudWatch log, as a
-- database_migration_notice record carrying the name of the file that raised it
-- (apps/backend/src/database/migrationRunner.ts). 0120 added that subscription; this file is the
-- second to rely on it.
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
-- backfill_id = '2b389b46-2215-4b2f-8e48-81a6499939a4'.
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
      FROM migration_0121_app_open_evidence AS evidence
      GROUP BY evidence.user_id, evidence.occurred_on
    ) AS grouped_days
    LEFT JOIN (
      SELECT DISTINCT pg_catalog.lower(user_settings.user_id) AS user_id
      FROM org.user_settings AS user_settings
    ) AS live_people
      ON live_people.user_id = grouped_days.user_id
    LEFT JOIN migration_0121_existing_app_opened_days AS reported
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
-- The NOT EXISTS against migration_0121_existing_app_opened_days is what separates this series from
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
  '2b389b46-2215-4b2f-8e48-81a6499939a4'::uuid,
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
    'backfill', '0121_backfill_synthetic_app_opened_days',
    -- No date is written here. ingested_at records when this backfill ran, and a hardcoded day would
    -- be a false claim on every row the moment the release lands on a different one.
    'note', 'Reconstructed app-open day, not an event a client reported. Written by migration 0121 from durable production traces; on one sampled day this union recovered about 85% of the people who really opened the app. evidence names every trace that placed this person on this day.',
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
  FROM migration_0121_app_open_evidence AS evidence
  GROUP BY evidence.user_id, evidence.occurred_on
) AS reconstructed_days
WHERE reconstructed_days.occurred_on < pg_catalog.date_trunc('day', pg_catalog.now(), 'UTC')
  AND NOT EXISTS (
    SELECT 1
    FROM migration_0121_existing_app_opened_days AS reported
    WHERE reported.user_id = reconstructed_days.user_id
      AND reported.occurred_on = reconstructed_days.occurred_on
  )
  AND EXISTS (
    SELECT 1
    FROM org.user_settings AS user_settings
    WHERE pg_catalog.lower(user_settings.user_id) = reconstructed_days.user_id
  )
ON CONFLICT (event_id) DO NOTHING;
