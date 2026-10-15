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
  Object.freeze({
    migrationFileName: "0193_account_provider_browser_handoffs.sql",
    expectedMigrationCount: 195,
    testFiles: Object.freeze([
      "src/auth/accountProviderBrowserHandoffs.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0192_account_provider_methods.sql",
    expectedMigrationCount: 194,
    testFiles: Object.freeze([
      "src/auth/accountProviderMethods.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0191_email_auth_attempt_proofs.sql",
    expectedMigrationCount: 193,
    testFiles: Object.freeze([
      "src/auth/emailAuthAttempt.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0190_principal_session_invalidation.sql",
    expectedMigrationCount: 192,
    testFiles: Object.freeze([
      "src/auth/principalSessions.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0189_social_sign_in_completion_results.sql",
    expectedMigrationCount: 191,
    testFiles: Object.freeze([
      "src/auth/socialSignIn.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0188_auth_attempts_and_completions.sql",
    expectedMigrationCount: 190,
    testFiles: Object.freeze([
      "src/auth/authAttempt.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0187_apple_provider_lifecycle.sql",
    expectedMigrationCount: 189,
    testFiles: Object.freeze([
      "src/auth/appleLifecycle.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0186_real_email_principal_enrollment.sql",
    expectedMigrationCount: 188,
    testFiles: Object.freeze([
      "src/auth/principalEnrollment.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0185_apple_revocation_credentials.sql",
    expectedMigrationCount: 187,
    testFiles: Object.freeze([
      "src/auth/appleCredential.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0184_cognito_native_proof_grants.sql",
    expectedMigrationCount: 186,
    testFiles: Object.freeze([
      "src/auth/nativeProofGrant.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0183_verified_auth_identity_lifecycle.sql",
    expectedMigrationCount: 185,
    testFiles: Object.freeze([
      "src/auth/surrogateUserId.postgres.integration.ts",
      "src/guestAuth/upgrade/boundGuestSession.postgres.integration.ts",
      "src/aiConsent/consent.postgres.integration.ts",
      "src/routes/system/account/accountPreferences.postgres.integration.ts",
      "src/agent/reviews.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0181_store_analytics_schema.sql",
    expectedMigrationCount: 183,
    testFiles: Object.freeze([
      "src/admin/reportingDb.postgres.integration.ts",
      "src/chat/cardImages/operation.postgres.integration.ts",
      "src/chat/runs/generatedImageAttemptBudget.postgres.integration.ts",
      "src/chat/store/historyService.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0176_client_os_name_device_type.sql",
    expectedMigrationCount: 178,
    testFiles: Object.freeze([
      "src/billing/entitlement.postgres.integration.ts",
      "src/chat/cardImages/promotion/jobsSettlement.postgres.integration.ts",
      "src/productAnalytics/serverFacts/authoringUpdates.postgres.integration.ts",
      "src/productAnalytics/writer.postgres.integration.ts",
      "src/sync/freshBootstrap.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0175_analytics_os_name_device_type.sql",
    expectedMigrationCount: 177,
    testFiles: Object.freeze([
      "src/catalog/distribution/install/install.postgres.integration.ts",
      "src/productAnalytics/dailyVisitorHash.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0171_probable_android_burst_actors.sql",
    expectedMigrationCount: 173,
    testFiles: Object.freeze([
      "src/productAnalytics/androidBurstReporting.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0167_stripe_email_deliveries.sql",
    expectedMigrationCount: 169,
    testFiles: Object.freeze([
      "src/cards/managedMedia/managedImageSnapshotMerge.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0162_generated_media_promotion_job_user_supplied_key.sql",
    expectedMigrationCount: 164,
    testFiles: Object.freeze([
      "src/chat/cardImages/generationBudget.postgres.integration.ts",
      "src/chat/cardImages/promotion/jobsLeasing.postgres.integration.ts",
      "src/chat/cardImages/promotion/jobsRevocation.postgres.integration.ts",
      "src/mediaAssets/blobLifecycle/cleanup/reconciliation.postgres.integration.ts",
    ]),
  }),
  Object.freeze({
    migrationFileName: "0161_ai_usage_user_supplied_key.sql",
    expectedMigrationCount: 163,
    testFiles: Object.freeze([
      "src/aiUsage/aiUsage.postgres.integration.ts",
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
