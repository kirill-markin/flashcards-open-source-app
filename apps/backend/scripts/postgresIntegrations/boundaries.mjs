import { randomBytes } from "node:crypto";

export const administrativeDatabaseName = "postgres";
export const disposableDatabaseName = "flashcards";
export const lifecycleLockKeys = Object.freeze([1196572995, 1886546277]);
export const lifecycleCleanupMaximumAttempts = 2;
export const lifecycleCleanupTimeoutMilliseconds = 5_000;
export const lifecycleRecoveryPollMilliseconds = 100;
export const mutableWorkShutdownPollMilliseconds = 50;
export const databaseTerminationPollMilliseconds = 100;
export const cleanupClientTeardownReserveMilliseconds = 1_000;
export const emergencyClientTeardownReserveMilliseconds = 50;
export const databaseOidMinimum = 16_384;
export const databaseOidSelectionMaximumAttempts = 64;
export const postgresConnectionTimeoutMilliseconds = 5_000;
export const postgresStartupOptions =
  "-c standard_conforming_strings=on -c client_encoding=UTF8";
export const integrationChildDatabaseEnvironmentVariableNames = Object.freeze([
  "DATABASE_URL",
  "DB_AUTH_SECRET_ARN",
  "DB_BACKEND_SECRET_ARN",
  "DB_HOST",
  "DB_NAME",
  "DB_OWNER_SECRET_ARN",
  "DB_REPORTING_SECRET_ARN",
  "DB_SECRET_ARN",
  "NODE_PG_FORCE_NATIVE",
  "PGCLIENT_ENCODING",
  "PGCLIENTENCODING",
  "PGCONNECT_TIMEOUT",
  "PGDATABASE",
  "PGHOST",
  "PGHOSTADDR",
  "PGOPTIONS",
  "PGPASSFILE",
  "PGPASSWORD",
  "PGPORT",
  "PGREPLICATION",
  "PGREQUIRESSL",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLCRL",
  "PGSSLCRLDIR",
  "PGSSLCERT",
  "PGSSLKEY",
  "PGSSLMODE",
  "PGSSLNEGOTIATION",
  "PGSSLROOTCERT",
  "PGTARGETSESSIONATTRS",
  "PGUSER",
  "POSTGRES_INTEGRATION_ADMIN_URL",
  "POSTGRES_INTEGRATION_EXPECTED_CLIENT_ENCODING",
  "POSTGRES_INTEGRATION_EXPECTED_DATABASE_NAME",
  "POSTGRES_INTEGRATION_EXPECTED_DATABASE_OID",
  "POSTGRES_INTEGRATION_EXPECTED_OWNER_USERNAME",
  "POSTGRES_INTEGRATION_EXPECTED_RUNTIME_USERNAME",
  "REPORTING_DATABASE_URL",
  "REPORTING_DB_SECRET_ARN",
  "TEST_DATABASE_ADMIN_URL",
]);
export const managedRoleNames = Object.freeze([
  "app",
  "backend_app",
  "auth_app",
  "reporting_readonly",
]);
export const createdRolesByMigration = new Map([
  ["0001_initial_schema.sql", Object.freeze(["app"])],
  ["0024_auth_runtime_roles.sql", Object.freeze(["backend_app", "auth_app"])],
  ["0044_reporting_readonly_role.sql", Object.freeze(["reporting_readonly"])],
]);
export const boundaryDefinitions = Object.freeze([
  // 0162 adds content.generated_media_promotion_jobs.user_supplied_key, which the card-image path now
  // writes and reads: the enqueue INSERT in chat/cardImages/promotion/jobs.ts names it on every job, and
  // the daily and monthly platform generation counts in chat/cardImages/generationBudget.ts skip the jobs
  // where it is true. Boundaries run current backend code against their own older schema, so a test that
  // executes the enqueue or either count below this migration fails because the column does not exist.
  // Six pinned tests execute one of them, re-derived from the two statements rather than from the tests
  // that would fail, and each moved here from the entry it used to sit at:
  // - chat/cardImages/generationBudget, from 0135, runs both counts against real jobs.
  // - chat/cardImages/operation, from 0136, drives the real enqueue through the card-image operation.
  // - chat/cardImages/promotion/jobsLeasing and jobsRevocation, from 0107, and jobsSettlement, from 0141,
  //   enqueue real jobs before leasing, revoking and settling them.
  // - mediaAssets/blobLifecycle/cleanup/reconciliation, from 0111, enqueues real jobs to race cleanup
  //   admission.
  // The 0135 and 0111 entries are gone, because each held one of these files and nothing else. No other
  // pinned test reaches either statement: the chat image tool is the only runtime caller of the card-image
  // operation and no pinned test drives it, and chat/runs/generatedImageAttemptBudget stays at 0136
  // because the attempt budget it drives sits before the generation budget and the enqueue.
  //
  // The other two files here have nothing to do with card images. Each exists to pin what production runs
  // rather than to cover an older schema, so each belongs at whichever entry is newest; both moved up
  // from 0151 through 0152, 0154 and 0161 to here for the same reason, and leaving them behind would have
  // made that stated reason untrue.
  // - serverFacts/authoringUpdates authenticates nothing. It drives the real exported card and deck
  //   mutations through the real post-commit drain and the real analytics writer, so its floor is 0141,
  //   whose sync.installations.is_automation the drain's replica resolution names in its LEFT JOIN.
  //   Above that floor it wants the newest schema rather than an older one: the statement in
  //   updateCardInExecutor that captures a card's authored fields before its own UPDATE is executed
  //   nowhere else in the repository, and an ambiguous column or a RETURNING list that stopped matching
  //   CARD_COLUMNS would otherwise first be seen in production.
  // - managedMedia/managedImageSnapshotMerge runs the real managed-image settlement and the real
  //   snapshot upsert against one card in sequence, which is the only way to prove a rule whose inputs
  //   are the stored front_text/back_text and the stored last_modified_by_replica_id rather than
  //   anything in the request. Its own floor is far below this migration - it names no column newer
  //   than the card and replica tables have had for a long time - but it is pinned at the newest
  //   boundary on purpose, for the same reason: the snapshot UPDATE it drives has to keep matching
  //   CARD_COLUMNS.
  // Moving a test retires the older-schema coverage it used to give, because each test runs only at its
  // pinned boundary and there is no full-schema pass. Both files keep covering every migration below
  // this one, which is what their own floors ask for; what 0151, 0152, 0154 and 0161 lose is a pass at
  // exactly their own schema.
  Object.freeze({
    migrationFileName: "0162_generated_media_promotion_job_user_supplied_key.sql",
    // Every migration file sorting at or below the boundary.
    expectedMigrationCount: 164,
    testFiles: Object.freeze([
      "src/cards/managedMedia/managedImageSnapshotMerge.postgres.integration.ts",
      "src/chat/cardImages/generationBudget.postgres.integration.ts",
      "src/chat/cardImages/operation.postgres.integration.ts",
      "src/chat/cardImages/promotion/jobsLeasing.postgres.integration.ts",
      "src/chat/cardImages/promotion/jobsRevocation.postgres.integration.ts",
      "src/chat/cardImages/promotion/jobsSettlement.postgres.integration.ts",
      "src/mediaAssets/blobLifecycle/cleanup/reconciliation.postgres.integration.ts",
      "src/productAnalytics/serverFacts/authoringUpdates.postgres.integration.ts",
    ]),
  }),
  // 0161 adds ai.usage_events.user_supplied_key, which the AI metering module now writes and reads:
  // aiUsage/record.ts inserts it on every row, and aiUsage/cap.ts counts this UTC month's chat messages
  // and sums its weighted tokens over the rows where it is false. 0154 grants backend_app UPDATE
  // (user_id, workspace_id, request_id) on ai.usage_events and adds the row level security policy that
  // grant needs, which is what lets account deletion anonymise a usage row and a guest upgrade transfer
  // one (aiUsage/identity.ts). db/migrations/0152_ai_usage_facts.sql created the table itself along with
  // ai.model_prices. Boundaries run current backend code against their own older schema, so a test that
  // executes the append below 0152 fails with `relation "ai.usage_events" does not exist`, one that
  // executes either identity rewrite below 0154 fails with `permission denied for table usage_events`,
  // and one that executes the append, the count or the sum below this migration fails with
  // `column "user_supplied_key" does not exist`.
  // aiUsage/aiUsage is the only test that executes any of them, and it is listed here rather than left
  // unlisted because an unlisted integration file is never executed by any workflow: it drives the real
  // append against the real grants - backend_app holds SELECT and INSERT on the table, from 0152, and
  // UPDATE on the three columns that name somebody and nothing else, from 0154; the insert is table-wide
  // because otherwise the append below could not write a counter at all - the real monthly count and sum
  // across a UTC month boundary, and the two rewrites, which
  // is the only way to see that the insert matches the shipped columns, that the window really excludes
  // the month before, and that the grant and the policy 0154 adds are both present, since a missing
  // UPDATE policy would leave either rewrite matching no row and reporting success.
  // The file moved up from the 0152 entry and then from the 0154 entry it used to sit at, both gone: each
  // held these same three files and nothing else, and an entry with no test file left would still build
  // a database to run nothing in. What 0152 and 0154 lose is a pass at exactly their own schema, which is
  // the standing consequence of moving a test here.
  // No pinned test moves here for the metering reads, re-derived from scratch rather than assumed:
  // - chat/cardImages/operation: the card-image operation now appends a usage fact, but it appends it
  //   through an injected dependency, and every external dependency set this test builds stubs it, so
  //   no request in it reaches ai.usage_events. It is pinned at 0162 for the promotion-job column.
  // - chat/cardImages/promotion/jobsSettlement and chat/runs/generatedImageAttemptBudget: neither
  //   drives the card-image operation at all. The first settles promotion jobs and reads them back
  //   through processSyncPull; the second drives the attempt budget, which sits below the provider call
  //   a usage fact belongs to.
  // - every other pinned test: none of them executes a metering statement. The chat route is where the
  //   allowance is enforced and the dictation route appends a fact, and no pinned test drives either of
  //   them; several do pull src/aiUsage into their module graph through the chat modules, which loads
  //   the code without running a statement against it.
  // - auth/accountDeletion and guestAuth/upgrade are the two callers of the identity rewrites, and
  //   neither has an integration file at all: both are covered by node:test files driving a recorded
  //   fake executor, which never reaches a database and is therefore not pinned anywhere.
  // Nothing pins the billing read the allowance resolves through either, for the same reason.
  Object.freeze({
    migrationFileName: "0161_ai_usage_user_supplied_key.sql",
    // Every migration file sorting at or below the boundary.
    expectedMigrationCount: 163,
    testFiles: Object.freeze([
      "src/aiUsage/aiUsage.postgres.integration.ts",
    ]),
  }),
  // 0151 creates the billing schema, and the sync pull route now reads it: the route assembly point in
  // routes/sync/index.ts resolves the caller's entitlement through billing/snapshot.ts, which selects
  // from billing.purchases and billing.grants and upserts billing.entitlement_snapshots. Boundaries run
  // current backend code against their own older schema, so a test that executes that read below this
  // migration fails with `relation "billing.purchases" does not exist`. billing/entitlement is the only
  // test that executes it, and it is listed here rather than left unlisted because an unlisted
  // integration file is never executed by any workflow: it drives the real /sync/pull route for the
  // wire field, and the resolver and its snapshot cache against the real tables, which is the only way
  // to see that the reads match the shipped schema and that an unchanged entitlement is not rewritten
  // on every pull. It also drives the real analytics writer for the entitlement_changed fact the
  // refresh emits, whose own floor is far below this entry, so nothing about the placement changes:
  // that fact exists only where the resolver, the snapshot upsert and the writer run together.
  // No pinned test moves here for the billing read. Re-derived from scratch rather than taken from the
  // plan, which expected two of them to move while the read was still going to sit inside
  // processSyncPull:
  // - sync/freshBootstrap: value-imports createSyncRoutes and therefore now value-imports the billing
  //   module, but it only requests /sync/bootstrap. The entitlement is attached to /sync/pull alone, so
  //   nothing in that request reaches a billing table, and it stays at 0141.
  // - agent/reviews and chat/cardImages/promotion/jobsSettlement: both call processSyncPull directly,
  //   which is below the route and resolves no entitlement. The HTTP half of agent/reviews drives
  //   createAgentRoutes, which does not mount the sync routes.
  // - every other pinned test: no import path to routes/sync/index.ts or to src/billing at all.
  // Attaching the read at the route instead of inside the shared authenticated-request profile read is
  // what keeps that list this short: a billing read inside ensureUserProfileInExecutor would pin every
  // boundary in this file to this migration, exactly as 0149 below had to.
  // billing/entitlement stays here rather than moving up with the AI usage file, even though it now also
  // drives the two billing identity rewrites that account deletion and guest upgrade perform
  // (billing/identity.ts). Those statements need no privilege 0151 did not already grant - UPDATE on the
  // four durable tables, DELETE on the snapshot cache alone - so this is the earliest schema they run
  // against, and they are exactly what this schema has to be pinned for: the partial unique indexes on
  // the three provider handles, the trial-shape CHECK and the primary key on user_billing_state are all
  // rules only a real transaction can refuse.
  //
  // The two files that used to sit here to pin what production runs - serverFacts/authoringUpdates and
  // managedMedia/managedImageSnapshotMerge - moved to the newest entry above when 0152 landed, and moved
  // with it to 0154, 0161 and 0162. Neither was ever here for the billing read: they authenticate nothing.
  Object.freeze({
    migrationFileName: "0151_billing_schema.sql",
    expectedMigrationCount: 153,
    testFiles: Object.freeze([
      "src/billing/entitlement.postgres.integration.ts",
    ]),
  }),
  // 0149 adds org.user_settings.product_analytics_enabled, and the shared profile read now names
  // that column as well: the SELECT in ensureUserProfileInExecutor (auth/ensureUser.ts), which
  // loadAuthenticatedRequestContext runs for every authenticated request on every transport.
  // Boundaries run current backend code against their own older schema, so every test whose path
  // reaches that read has to be pinned at or after this migration or it fails with
  // `column "product_analytics_enabled" does not exist`. This entry replaces 0142's, which named
  // the same single test file for the same read, when that read first grew analytics_consent:
  // agent/reviews, which serves its requests through a real createAgentRoutes app on the unmocked
  // loadRequestContextFromRequest. Its createMcpServer half is still not the reason: that call
  // takes an already-built AuthenticatedMcpAccessToken and never loads a request context.
  // Import-reachable but unaffected, re-derived from scratch on this re-pin as on the five before
  // it, so recorded here again:
  // - admin/authz: value-imports ensureCognitoUserProfile through authz.ts, but the test only calls
  //   loadAdminProfileEmail and never enters requireSessionAdminRequest.
  // - the three mediaAssets/multipart tests: reach requestContext.ts only through
  //   requestBoundary.ts's `import type { RequestContext }`, which tsx/esbuild erases.
  // - sync/freshBootstrap: injects its own loadRequestContextFromRequestFn.
  // - chat/cardImages/promotion/jobsSettlement: no import path to requestContext.ts at all.
  // - guestAuthTestHarness/handlers/userSettings.ts is a third SQL site naming both columns, but no
  //   pinned test imports it.
  // The guest half of the migration adds no test of its own: auth.guest_sessions
  // .product_analytics_enabled is named only by the guest credential lookup
  // (guestAuth/session/index.ts) and the guest preference write, and no pinned test authenticates a
  // real guest session against its boundary database.
  // Moving a test retires the older-schema coverage it used to give, because each test runs only at
  // its pinned boundary and there is no full-schema pass.
  // accountPreferences joins this boundary rather than an older one because it exercises both
  // analytics columns of org.user_settings in one statement: analytics_consent, which 0142 added,
  // and product_analytics_enabled, which this migration adds, so 0149 is the earliest schema its
  // SQL can run against at all. It is pinned here rather than left unlisted because an unlisted
  // integration file is never executed by any workflow, and the stickiness guards it covers are
  // invisible to the route's unit tests, which hold a mock of the update function.
  // auth/surrogateUserId joins it for the first of those two reasons alone: it calls
  // ensureCognitoUserProfile, so it runs the same shared profile read this entry exists for and
  // cannot go below this migration. Nothing in it names a column any later migration added - the
  // mint it proves writes org.user_settings and auth.user_identities, both far older - so this is
  // the earliest schema it can run against rather than a pin on what production runs. It covers
  // what only a database can show about a minted account id: that a first-ever subject is bound to
  // an id that is not itself, that a second request resolves through that binding instead of
  // minting again, and that a subject already holding an unmapped account adopts it. The
  // profile-before-mapping order all three rest on is a foreign key
  // (db/migrations/0031_guest_ai_identity_and_quota.sql), which no fake executor enforces.
  Object.freeze({
    migrationFileName: "0149_product_analytics_off_switch.sql",
    expectedMigrationCount: 151,
    //
    // The two files that used to sit here to pin what production runs - serverFacts/authoringUpdates
    // and managedMedia/managedImageSnapshotMerge - now sit at the newest entry in this file, which is
    // 0162. Neither is here for the profile read: they authenticate nothing.
    testFiles: Object.freeze([
      "src/agent/reviews.postgres.integration.ts",
      "src/auth/surrogateUserId.postgres.integration.ts",
      "src/routes/system/account/accountPreferences.postgres.integration.ts",
    ]),
  }),
  // 0145 adds analytics.product_events.automated_client, beside the daily_visitor_hash and
  // analytics.daily_visitor_hash_salts 0144 added. Only the credential-free collector's insert names
  // any of them, which is why the shared writer column list leaves both columns out and no test
  // pinned below this migration moves here. This entry replaces 0144's, which listed the same one
  // test file: that collector insert now names automated_client on every row it writes, so a test
  // calling insertAnonymousProductAnalyticsEvent against 0144's database would fail with
  // `column "automated_client" of relation "product_events" does not exist`. The test covers both
  // columns here, and 0144's schema keeps no coverage of its own, as with every earlier re-pin.
  Object.freeze({
    migrationFileName: "0145_anonymous_client_automated_marker.sql",
    expectedMigrationCount: 147,
    testFiles: Object.freeze([
      "src/productAnalytics/dailyVisitorHash.postgres.integration.ts",
    ]),
  }),
  // 0141 adds sync.installations.is_automation and recreates sync.claim_installation with it as an
  // extra output column, and the shared replica reads now name that column: the claim SELECT in
  // sync/identity/replica.ts, and the LEFT JOIN behind the product analytics content-write and
  // review-answer producers. Boundaries run current backend code against their own older schema, so
  // every test whose path reaches one of those reads has to be pinned at or after this migration or
  // it fails with `column installations.is_automation does not exist`. The tests that reach those
  // reads are freshBootstrap (the /sync/bootstrap replica claim), listed here, and jobsSettlement
  // (which verifies a promoted asset through a real processSyncPull), both moved here from 0107 -
  // plus every test the 0162, 0161, 0151 and 0149 entries above pin further forward, which satisfies
  // this migration too: jobsSettlement, which is now pinned at 0162, agent/reviews (processSyncPull,
  // processSyncReviewHistoryPull, and the post-commit content-write resolution), which came here from
  // 0138 and is pinned at 0149, and serverFacts/authoringUpdates, which was written above this
  // boundary, never sat at it, and is now pinned at 0162.
  // Moving a test retires the older-schema coverage it used to give, because each test runs only at
  // its pinned boundary and there is no full-schema pass.
  Object.freeze({
    migrationFileName: "0141_sync_installation_automation_marker.sql",
    expectedMigrationCount: 143,
    testFiles: Object.freeze([
      "src/sync/freshBootstrap.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0138_feedback_connection_country.sql",
    expectedMigrationCount: 140,
    testFiles: Object.freeze([
      "src/catalog/distribution/install/install.postgres.integration.ts",
      "src/productAnalytics/writer.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0136_ai_chat_run_client_platform.sql",
    expectedMigrationCount: 138,
    testFiles: Object.freeze([
      "src/chat/runs/generatedImageAttemptBudget.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0132_direct_writer_absolute_lease_target.sql",
    expectedMigrationCount: 134,
    testFiles: Object.freeze([
      "src/mediaAssets/blobLifecycle/lifecycle.postgres.integration.ts",
      "src/mediaAssets/ingestion/directIngestionApply.postgres.integration.ts",
    ]),
  }),
  // 0131 needs its own boundary rather than an extra test file on 0130's: it turns
  // educational_subject NOT NULL, and 0130's database stops one migration short of that schema. The
  // two row shapes that would abort that ALTER exist only here - the delisted 0105 test fixture
  // 0130 deliberately never reached, and the in-flight version row this boundary's own seed hook
  // creates just before the migration runs.
  Object.freeze({
    migrationFileName: "0131_require_catalog_educational_subject.sql",
    expectedMigrationCount: 133,
    testFiles: Object.freeze([
      "src/catalog/authoring/versions/requiredEducationalSubject.postgres.integration.ts",
    ]),
  }),
  // 0130 needs its own boundary rather than an extra test file on 0129's: it writes the educational
  // alignment columns of every published version of the package 0129's seed hook creates, including
  // version 4, whose untouched updated_at is exactly what
  // legacyLanguageTagCorrection.postgres.integration.ts asserts. Boundaries stop at their own
  // migration, so 0129's database never sees this file.
  Object.freeze({
    migrationFileName: "0130_backfill_catalog_educational_alignment.sql",
    expectedMigrationCount: 132,
    testFiles: Object.freeze([
      "src/catalog/authoring/versions/educationalAlignmentBackfill.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0129_correct_legacy_catalog_language_tag.sql",
    expectedMigrationCount: 131,
    testFiles: Object.freeze([
      "src/catalog/authoring/versions/legacyLanguageTagCorrection.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0128_catalog_educational_alignment.sql",
    expectedMigrationCount: 130,
    testFiles: Object.freeze([
      "src/catalog/authoring/lockOrder.postgres.integration.ts",
      "src/catalog/authoring/versions/publishedVersionAlignment.postgres.integration.ts",
      "src/catalog/distribution/public/public.postgres.integration.ts",
      "src/mediaAssets/blobLifecycle/cleanup/sharedProvenance.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0123_backfill_live_review_answered_platform.sql",
    expectedMigrationCount: 125,
    testFiles: Object.freeze([
      "src/productAnalytics/serverFacts/serverEvents.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0108_multipart_absolute_lease_target.sql",
    expectedMigrationCount: 110,
    testFiles: Object.freeze([
      "src/admin/authz.postgres.integration.ts",
      "src/mediaAssets/multipart/creation/atomicWriterCreation.postgres.integration.ts",
      "src/mediaAssets/multipart/completion/atomicWriterCompletion.postgres.integration.ts",
      "src/mediaAssets/multipart/writerLifecycle/atomicWriterLease.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0107_catalog_test_collection.sql",
    expectedMigrationCount: 109,
    testFiles: Object.freeze([
      "src/cards/managedMedia/generatedImageAppend.postgres.integration.ts",
      "src/database/aiChatInitiatingAuthClassification.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0101_multipart_foreground_completion_fencing.sql",
    expectedMigrationCount: 103,
    testFiles: Object.freeze([
      "src/mediaAssets/multipart/writerLifecycle/foregroundFencing.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0100_multipart_replacement_creation_claim.sql",
    expectedMigrationCount: 102,
    testFiles: Object.freeze([
      "src/mediaAssets/multipart/creation/replacementCreationClaim.postgres.integration.ts",
      "src/mediaAssets/multipart/creation/uploadSessionCreation.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0099_durable_multipart_completion_reconciliation.sql",
    expectedMigrationCount: 101,
    testFiles: Object.freeze([
      "src/database/deadline.postgres.integration.ts",
      "src/mediaAssets/multipart/completion/completionReconciliation.postgres.integration.ts",
      "src/mediaAssets/multipart/writerLifecycle/writerAbortReplay.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0098_multipart_writer_abort_and_terminal_replay.sql",
    expectedMigrationCount: 100,
    testFiles: Object.freeze([
      "src/database/deadline.postgres.integration.ts",
      "src/mediaAssets/multipart/writerLifecycle/writerAbortReplay.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0097_direct_multipart_writer_attempt_fencing.sql",
    expectedMigrationCount: 99,
    testFiles: Object.freeze([
      "src/mediaAssets/multipart/writerLifecycle/writerAbortReplay.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0096_atomic_multipart_completion_resolution.sql",
    expectedMigrationCount: 98,
    testFiles: Object.freeze([
      "src/mediaAssets/multipart/writerLifecycle/writerAttempts.postgres.integration.ts",
    ]),
  }),
]);
export const backendRolePassword =
  `postgres-integration-${randomBytes(18).toString("hex")}`;
