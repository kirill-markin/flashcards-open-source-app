import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { updateCatalogPackageDraftInExecutor } from "./drafts";
import { publishCatalogPackageVersionInExecutor } from "./versions";

type ActivityRow = Readonly<{
  wait_event_type: string | null;
}>;

function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("TEST_DATABASE_ADMIN_URL is required for the catalog authoring lock-order integration test.");
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

function isLockNotAvailable(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "55P03";
}

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
        "(package_id, author_id, slug, title, summary, description, language_tags, topic_tags, license, status, published_at)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', now())",
      ].join(" "),
      [
        packageId,
        originalAuthorId,
        `lock-order-package-${suffix}`,
        "Lock order package",
        "Lock order summary",
        "Lock order description",
        ["en"],
        ["testing"],
        "CC-BY-4.0",
      ],
    );
    await pool.query(
      [
        "INSERT INTO catalog.package_versions",
        "(package_version_id, package_id, version_number, status, slug, title, summary, description,",
        "language_tags, topic_tags, license, card_count, created_by_admin_email, reviewed_by_admin_email, submitted_at, reviewed_at)",
        "VALUES ($1, $2, 1, 'approved', $3, $4, $5, $6, $7, $8, $9, 0, $10, $10, now(), now())",
      ].join(" "),
      [
        packageVersionId,
        packageId,
        `lock-order-package-${suffix}-v1`,
        "Lock order package",
        "Lock order summary",
        "Lock order description",
        ["en"],
        ["testing"],
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
        topicTags: ["testing"],
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
