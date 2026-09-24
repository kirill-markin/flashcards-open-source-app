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
  //
  // The other two files here have nothing to do with billing. Each exists to pin what production runs
  // rather than to cover an older schema, so each belongs at whichever entry is newest; both moved up
  // from 0149 because this entry landed above it, and leaving them behind would have made that stated
  // reason untrue. Nothing ties the three files in this entry together, so moving any one of them later
  // does not free the others.
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
  // this one, which is what their own floors ask for; what 0149 loses is a pass at exactly 0149.
  Object.freeze({
    migrationFileName: "0151_billing_schema.sql",
    expectedMigrationCount: 153,
    testFiles: Object.freeze([
      "src/billing/entitlement.postgres.integration.ts",
      "src/cards/managedMedia/managedImageSnapshotMerge.postgres.integration.ts",
      "src/productAnalytics/serverFacts/authoringUpdates.postgres.integration.ts",
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
  Object.freeze({
    migrationFileName: "0149_product_analytics_off_switch.sql",
    expectedMigrationCount: 151,
    //
    // The two files that used to sit here to pin what production runs - serverFacts/authoringUpdates
    // and managedMedia/managedImageSnapshotMerge - moved to the 0151 entry above when that became the
    // newest boundary. Neither is here for the profile read: they authenticate nothing.
    testFiles: Object.freeze([
      "src/agent/reviews.postgres.integration.ts",
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
  // reads are the two listed here - freshBootstrap (the /sync/bootstrap replica claim) and
  // jobsSettlement (which verifies a promoted asset through a real processSyncPull), both moved
  // here from 0107 - plus every test the 0151 and 0149 entries above pin further forward, which
  // satisfies this migration too: agent/reviews (processSyncPull, processSyncReviewHistoryPull, and
  // the post-commit content-write resolution), which came here from 0138 and is pinned at 0149, and
  // serverFacts/authoringUpdates, which was written above this boundary, never sat at it, and is now
  // pinned at 0151.
  // Moving a test retires the older-schema coverage it used to give, because each test runs only at
  // its pinned boundary and there is no full-schema pass.
  Object.freeze({
    migrationFileName: "0141_sync_installation_automation_marker.sql",
    expectedMigrationCount: 143,
    testFiles: Object.freeze([
      "src/chat/cardImages/promotion/jobsSettlement.postgres.integration.ts",
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
      "src/chat/cardImages/operation.postgres.integration.ts",
      "src/chat/runs/generatedImageAttemptBudget.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0135_generated_media_promotion_job_created_at_select.sql",
    expectedMigrationCount: 137,
    testFiles: Object.freeze([
      "src/chat/cardImages/generationBudget.postgres.integration.ts",
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
    migrationFileName: "0111_delist_catalog_test_fixture.sql",
    expectedMigrationCount: 113,
    testFiles: Object.freeze([
      "src/mediaAssets/blobLifecycle/cleanup/reconciliation.postgres.integration.ts",
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
      "src/chat/cardImages/promotion/jobsLeasing.postgres.integration.ts",
      "src/chat/cardImages/promotion/jobsRevocation.postgres.integration.ts",
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
