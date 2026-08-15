import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { updateCatalogPackageDraftInExecutor } from "./drafts";
import {
  publishCatalogPackageVersionInExecutor,
  updateCatalogPackageVersionReviewStatusInExecutor,
} from "./versions";

type ActivityRow = Readonly<{
  wait_event_type: string | null;
}>;

type PersistedReviewStatusRow = Readonly<{
  status: string;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  reviewed_by_admin_email: string | null;
}>;

function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("TEST_DATABASE_ADMIN_URL is required for the catalog authoring lock-order integration test.");
  }
  return databaseUrl;
}

function requireRuntimeDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL is required for the catalog authoring lock-order integration test.");
  }
  return databaseUrl;
}

function createClientExecutor(client: pg.PoolClient): DatabaseExecutor {
  return {
    query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      return client.query<Row>(text, [...params]);
    },
  };
}

async function waitForLockWait(
  observerPool: pg.Pool,
  backendPid: number,
  operationName: string,
): Promise<void> {
  const deadlineAt = Date.now() + 5_000;
  while (Date.now() < deadlineAt) {
    const result = await observerPool.query<ActivityRow>(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [backendPid],
    );
    if (result.rows[0]?.wait_event_type === "Lock") {
      return;
    }
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${operationName} to reach a PostgreSQL lock wait.`);
}

function hasPostgresCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

function isLockNotAvailable(error: unknown): boolean {
  return hasPostgresCode(error, "55P03");
}

test("catalog review transitions use the package-status enum parameter consistently", async () => {
  const pool = new pg.Pool({
    connectionString: requireRuntimeDatabaseUrl(),
    application_name: "catalog-review-status-integration",
    max: 1,
  });
  const client = await pool.connect();
  const suffix = randomUUID().replaceAll("-", "");
  const authorId = randomUUID();
  const packageId = randomUUID();
  const packageVersionId = randomUUID();
  const adminEmail = "catalog-review@example.test";
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(
      [
        "INSERT INTO catalog.authors (author_id, slug, display_name)",
        "VALUES ($1, $2, $3)",
      ].join(" "),
      [authorId, `review-status-author-${suffix}`, "Review status author"],
    );
    await client.query(
      [
        "INSERT INTO catalog.packages",
        "(package_id, author_id, slug, title, summary, description, language_tags, license)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      ].join(" "),
      [
        packageId,
        authorId,
        `review-status-package-${suffix}`,
        "Review status package",
        "Review status summary",
        "Review status description",
        ["en"],
        "CC-BY-4.0",
      ],
    );
    await client.query(
      [
        "INSERT INTO catalog.package_versions",
        "(package_version_id, package_id, version_number, slug, title, summary, description,",
        "language_tags, license, card_count, created_by_admin_email)",
        "VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, 0, $9)",
      ].join(" "),
      [
        packageVersionId,
        packageId,
        `review-status-package-${suffix}-v1`,
        "Review status package",
        "Review status summary",
        "Review status description",
        ["en"],
        "CC-BY-4.0",
        adminEmail,
      ],
    );

    const executor = createClientExecutor(client);
    const submittedVersion = await updateCatalogPackageVersionReviewStatusInExecutor(
      executor,
      packageVersionId,
      { status: "submitted", note: null },
      adminEmail,
    );
    assert.equal(submittedVersion.status, "submitted");
    assert.notEqual(submittedVersion.submittedAt, null);
    assert.equal(submittedVersion.reviewedAt, null);
    assert.equal(submittedVersion.reviewedByAdminEmail, null);

    const approvedVersion = await updateCatalogPackageVersionReviewStatusInExecutor(
      executor,
      packageVersionId,
      { status: "approved", note: null },
      adminEmail,
    );
    assert.equal(approvedVersion.status, "approved");
    assert.equal(approvedVersion.submittedAt, submittedVersion.submittedAt);
    assert.notEqual(approvedVersion.reviewedAt, null);
    assert.equal(approvedVersion.reviewedByAdminEmail, adminEmail);

    const persistedResult = await client.query<PersistedReviewStatusRow>(
      [
        "SELECT status::text AS status, submitted_at, reviewed_at, reviewed_by_admin_email",
        "FROM catalog.package_versions",
        "WHERE package_version_id = $1",
      ].join(" "),
      [packageVersionId],
    );
    const persistedRow = persistedResult.rows[0];
    assert.ok(persistedRow !== undefined);
    assert.equal(persistedRow.status, "approved");
    assert.ok(persistedRow.submitted_at instanceof Date);
    assert.ok(persistedRow.reviewed_at instanceof Date);
    assert.equal(persistedRow.reviewed_by_admin_email, adminEmail);
  } finally {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    client.release();
    await pool.end();
  }
});

test("catalog package update locks the package before its selected author", async () => {
  const pool = new pg.Pool({
    connectionString: requireTestDatabaseUrl(),
    application_name: "catalog-authoring-lock-order-integration",
    max: 4,
  });
  const blockerClient = await pool.connect();
  const updateClient = await pool.connect();
  const publishClient = await pool.connect();
  const suffix = randomUUID().replaceAll("-", "");
  const originalAuthorId = randomUUID();
  const selectedAuthorId = randomUUID();
  const packageId = randomUUID();
  const packageVersionId = randomUUID();
  let updatePromise: Promise<unknown> | null = null;
  let publishPromise: Promise<unknown> | null = null;
  let blockerTransactionOpen = false;
  let updateTransactionOpen = false;
  let publishTransactionOpen = false;

  try {
    await pool.query(
      [
        "INSERT INTO catalog.authors (author_id, slug, display_name)",
        "VALUES ($1, $2, $3), ($4, $5, $6)",
      ].join(" "),
      [
        originalAuthorId,
        `lock-order-original-${suffix}`,
        "Original author",
        selectedAuthorId,
        `lock-order-selected-${suffix}`,
        "Selected author",
      ],
    );
    await pool.query(
      [
        "INSERT INTO catalog.packages",
        "(package_id, author_id, slug, title, summary, description, language_tags, license, status, published_at)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', now())",
      ].join(" "),
      [
        packageId,
        originalAuthorId,
        `lock-order-package-${suffix}`,
        "Lock order package",
        "Lock order summary",
        "Lock order description",
        ["en"],
        "CC-BY-4.0",
      ],
    );
    await pool.query(
      [
        "INSERT INTO catalog.package_versions",
        "(package_version_id, package_id, version_number, status, slug, title, summary, description,",
        "language_tags, license, card_count, created_by_admin_email, reviewed_by_admin_email, submitted_at, reviewed_at)",
        "VALUES ($1, $2, 1, 'approved', $3, $4, $5, $6, $7, $8, 0, $9, $9, now(), now())",
      ].join(" "),
      [
        packageVersionId,
        packageId,
        `lock-order-package-${suffix}-v1`,
        "Lock order package",
        "Lock order summary",
        "Lock order description",
        ["en"],
        "CC-BY-4.0",
        "catalog-lock-order@example.test",
      ],
    );

    await blockerClient.query("BEGIN");
    blockerTransactionOpen = true;
    await blockerClient.query(
      "SELECT author_id FROM catalog.authors WHERE author_id = $1 FOR UPDATE",
      [selectedAuthorId],
    );

    await updateClient.query("BEGIN");
    updateTransactionOpen = true;
    await updateClient.query("SET LOCAL statement_timeout = '10s'");
    const updatePid = Number((await updateClient.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    )).rows[0]?.pid);
    updatePromise = updateCatalogPackageDraftInExecutor(
      createClientExecutor(updateClient),
      {
        packageId,
        authorId: selectedAuthorId,
        slug: `lock-order-package-${suffix}`,
        title: "Lock order package",
        summary: "Lock order summary",
        description: "Lock order description",
        languageTags: ["en"],
        license: "CC-BY-4.0",
        contentWarning: null,
        coverPackageMediaKey: null,
      },
    );
    await waitForLockWait(pool, updatePid, "catalog package update");

    await assert.rejects(
      pool.query(
        "SELECT package_id FROM catalog.packages WHERE package_id = $1 FOR UPDATE NOWAIT",
        [packageId],
      ),
      isLockNotAvailable,
    );

    await publishClient.query("BEGIN");
    publishTransactionOpen = true;
    await publishClient.query("SET LOCAL statement_timeout = '10s'");
    const publishPid = Number((await publishClient.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    )).rows[0]?.pid);
    publishPromise = publishCatalogPackageVersionInExecutor(
      createClientExecutor(publishClient),
      packageVersionId,
      "catalog-lock-order@example.test",
      null,
    );
    await waitForLockWait(pool, publishPid, "catalog package publication");

    await blockerClient.query("COMMIT");
    blockerTransactionOpen = false;
    await updatePromise;
    await updateClient.query("COMMIT");
    updateTransactionOpen = false;
    await publishPromise;
    await publishClient.query("COMMIT");
    publishTransactionOpen = false;

    const persistedResult = await pool.query<Readonly<{
      author_id: string;
      package_status: string;
      version_status: string;
    }>>(
      [
        "SELECT packages.author_id, packages.status::text AS package_status,",
        "package_versions.status::text AS version_status",
        "FROM catalog.packages AS packages",
        "INNER JOIN catalog.package_versions AS package_versions",
        "ON package_versions.package_id = packages.package_id",
        "WHERE packages.package_id = $1",
      ].join(" "),
      [packageId],
    );
    assert.deepEqual(persistedResult.rows[0], {
      author_id: selectedAuthorId,
      package_status: "published",
      version_status: "published",
    });
  } finally {
    if (blockerTransactionOpen) {
      await blockerClient.query("ROLLBACK");
    }
    if (updateTransactionOpen) {
      await updateClient.query("ROLLBACK");
    }
    if (publishTransactionOpen) {
      await publishClient.query("ROLLBACK");
    }
    await Promise.allSettled([
      updatePromise ?? Promise.resolve(),
      publishPromise ?? Promise.resolve(),
    ]);
    blockerClient.release();
    updateClient.release();
    publishClient.release();
    await pool.query("DELETE FROM catalog.packages WHERE package_id = $1", [packageId]);
    await pool.query(
      "DELETE FROM catalog.authors WHERE author_id = ANY($1::uuid[])",
      [[originalAuthorId, selectedAuthorId]],
    );
    await pool.end();
  }
});

test("package-version and cover-swap contracts prelock reverse-ordered lifecycle rows by SHA", async () => {
  const adminPool = new pg.Pool({
    connectionString: requireTestDatabaseUrl(),
    application_name: "catalog-version-lifecycle-lock-order-admin-integration",
    max: 3,
  });
  const runtimePool = new pg.Pool({
    connectionString: requireRuntimeDatabaseUrl(),
    application_name: "catalog-version-lifecycle-lock-order-runtime-integration",
    max: 2,
  });
  const blockerClient = await adminPool.connect();
  const versionClient = await runtimePool.connect();
  const coverClient = await runtimePool.connect();
  const firstSha256 = randomUUID().replaceAll("-", "").repeat(2);
  const secondSha256 = randomUUID().replaceAll("-", "").repeat(2);
  const [lowSha256, highSha256] = firstSha256 < secondSha256
    ? [firstSha256, secondSha256] as const
    : [secondSha256, firstSha256] as const;
  const lowMediaBlobId = randomUUID();
  const highMediaBlobId = randomUUID();
  const packageId = randomUUID();
  const storageKey = (sha256: string): string => (
    `media/blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`
  );
  let versionLockPromise: Promise<unknown> | null = null;
  let coverLockPromise: Promise<unknown> | null = null;
  let blockerTransactionOpen = false;
  let versionTransactionOpen = false;
  let coverTransactionOpen = false;

  try {
    await adminPool.query(
      [
        "INSERT INTO content.media_blob_lifecycles",
        "(sha256,storage_key,mime_type,size_bytes,normalization_version)",
        "VALUES($1,$2,'image/jpeg',42,'passthrough-v1'),",
        "($3,$4,'image/jpeg',42,'passthrough-v1')",
      ].join(" "),
      [lowSha256, storageKey(lowSha256), highSha256, storageKey(highSha256)],
    );
    await adminPool.query(
      [
        "INSERT INTO content.media_blobs",
        "(media_blob_id,sha256,mime_type,size_bytes,storage_key,normalization_version)",
        "VALUES($1,$2,'image/jpeg',42,$3,'passthrough-v1'),",
        "($4,$5,'image/jpeg',42,$6,'passthrough-v1')",
      ].join(" "),
      [
        lowMediaBlobId,
        lowSha256,
        storageKey(lowSha256),
        highMediaBlobId,
        highSha256,
        storageKey(highSha256),
      ],
    );

    await blockerClient.query("BEGIN");
    blockerTransactionOpen = true;
    await blockerClient.query(
      "SELECT 1 FROM content.media_blob_lifecycles WHERE sha256=$1 FOR UPDATE",
      [lowSha256],
    );

    await versionClient.query("BEGIN");
    versionTransactionOpen = true;
    await versionClient.query("SET LOCAL statement_timeout = '10s'");
    const versionPid = Number((await versionClient.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    )).rows[0]?.pid);
    versionLockPromise = versionClient.query(
      "SELECT content.lock_catalog_package_version_media_blob_lifecycles($1,$2::uuid[])",
      [packageId, [highMediaBlobId, lowMediaBlobId]],
    );
    await waitForLockWait(adminPool, versionPid, "reverse-ordered package-version prelock");

    await coverClient.query("BEGIN");
    coverTransactionOpen = true;
    await coverClient.query("SET LOCAL statement_timeout = '10s'");
    const coverPid = Number((await coverClient.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    )).rows[0]?.pid);
    coverLockPromise = coverClient.query(
      "SELECT content.lock_media_blob_lifecycles_for_reference_swap($1,$2)",
      [highMediaBlobId, lowMediaBlobId],
    );
    await waitForLockWait(adminPool, coverPid, "concurrent cover-swap prelock");

    const unlockedHighSha = await adminPool.query<{ sha256: string }>(
      "SELECT sha256 FROM content.media_blob_lifecycles WHERE sha256=$1 FOR UPDATE NOWAIT",
      [highSha256],
    );
    assert.equal(unlockedHighSha.rows[0]?.sha256, highSha256);

    await blockerClient.query("COMMIT");
    blockerTransactionOpen = false;
    const firstCompleted = await Promise.race([
      versionLockPromise.then(() => "version" as const),
      coverLockPromise.then(() => "cover" as const),
    ]);
    if (firstCompleted === "version") {
      await versionClient.query("COMMIT");
      versionTransactionOpen = false;
      await coverLockPromise;
      await coverClient.query("COMMIT");
      coverTransactionOpen = false;
    } else {
      await coverClient.query("COMMIT");
      coverTransactionOpen = false;
      await versionLockPromise;
      await versionClient.query("COMMIT");
      versionTransactionOpen = false;
    }

    await assert.rejects(
      versionClient.query(
        "SELECT content.lock_catalog_package_version_media_blob_lifecycles($1,$2::uuid[])",
        [packageId, [lowMediaBlobId, randomUUID()]],
      ),
      (error: unknown) => hasPostgresCode(error, "23503"),
    );
    await adminPool.query(
      "DELETE FROM content.media_blob_lifecycles WHERE sha256=$1",
      [highSha256],
    );
    await assert.rejects(
      versionClient.query(
        "SELECT content.lock_catalog_package_version_media_blob_lifecycles($1,$2::uuid[])",
        [packageId, [highMediaBlobId]],
      ),
      (error: unknown) => hasPostgresCode(error, "23514"),
    );
  } finally {
    if (blockerTransactionOpen) {
      await blockerClient.query("ROLLBACK");
    }
    if (versionTransactionOpen) {
      await versionClient.query("ROLLBACK");
    }
    if (coverTransactionOpen) {
      await coverClient.query("ROLLBACK");
    }
    await Promise.allSettled([
      versionLockPromise ?? Promise.resolve(),
      coverLockPromise ?? Promise.resolve(),
    ]);
    blockerClient.release();
    versionClient.release();
    coverClient.release();
    await adminPool.query(
      "DELETE FROM content.media_blobs WHERE media_blob_id=ANY($1::uuid[])",
      [[lowMediaBlobId, highMediaBlobId]],
    );
    await adminPool.query(
      "DELETE FROM content.media_blob_lifecycles WHERE sha256=ANY($1::text[])",
      [[lowSha256, highSha256]],
    );
    await runtimePool.end();
    await adminPool.end();
  }
});
