import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

type PackageVersionAlignmentRow = Readonly<{
  title: string;
  educational_subject: string | null;
  educational_framework: string | null;
  educational_level: string | null;
}>;

function requireTestDatabaseAdminUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the catalog educational alignment integration test.",
    );
  }

  return databaseUrl;
}

function isPublishedVersionImmutable(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "23514"
    && error.message.includes("Published catalog package versions are immutable");
}

// The educational alignment columns are deliberately outside
// catalog.prevent_published_package_version_update(), so a migration can correct a wrong subject in
// place instead of forcing a new version. No admin endpoint writes them after version creation.
// Only a real database can tell that exclusion apart from an oversight.
test("published catalog package versions accept alignment edits and still refuse content edits", async () => {
  const pool = new pg.Pool({
    connectionString: requireTestDatabaseAdminUrl(),
    application_name: "catalog-educational-alignment-integration",
  });
  const suffix = randomUUID().replaceAll("-", "");
  const authorId = randomUUID();
  const packageId = randomUUID();
  const packageVersionId = randomUUID();
  const adminEmail = "educational-alignment@example.test";

  try {
    await pool.query(
      [
        "INSERT INTO catalog.authors (author_id, slug, display_name)",
        "VALUES ($1, $2, $3)",
      ].join(" "),
      [authorId, `alignment-author-${suffix}`, "Alignment Author"],
    );
    await pool.query(
      [
        "INSERT INTO catalog.packages",
        "(package_id, author_id, slug, title, summary, description, language_tags, license,",
        "educational_subject, educational_framework, educational_level)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      ].join(" "),
      [
        packageId,
        authorId,
        `alignment-package-${suffix}`,
        "Alignment Package",
        "Integration-owned alignment package.",
        "Catalog package created by the educational alignment integration test.",
        ["en"],
        "CC0-1.0",
        "Statistics",
        null,
        "High school",
      ],
    );
    await pool.query(
      [
        "INSERT INTO catalog.package_versions",
        "(package_version_id, package_id, version_number, slug, title, summary, description,",
        "language_tags, license, created_by_admin_email,",
        "educational_subject, educational_framework, educational_level)",
        "VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
      ].join(" "),
      [
        packageVersionId,
        packageId,
        `alignment-version-${suffix}`,
        "Alignment Package",
        "Integration-owned alignment package.",
        "Catalog package created by the educational alignment integration test.",
        ["en"],
        "CC0-1.0",
        adminEmail,
        "Statistics",
        null,
        "High school",
      ],
    );
    for (const status of ["submitted", "approved", "published"] as const) {
      await pool.query(
        [
          "UPDATE catalog.package_versions",
          "SET status = $2::catalog.package_status",
          "WHERE package_version_id = $1",
        ].join(" "),
        [packageVersionId, status],
      );
    }

    await pool.query(
      [
        "UPDATE catalog.package_versions",
        "SET educational_subject = $2, educational_framework = $3, educational_level = $4",
        "WHERE package_version_id = $1",
      ].join(" "),
      [packageVersionId, "Statistics and probability", "AP Statistics", "Undergraduate"],
    );
    await assert.rejects(
      pool.query(
        "UPDATE catalog.package_versions SET title = $2 WHERE package_version_id = $1",
        [packageVersionId, "Corrected Alignment Package"],
      ),
      isPublishedVersionImmutable,
    );

    const result = await pool.query<PackageVersionAlignmentRow>(
      [
        "SELECT title, educational_subject, educational_framework, educational_level",
        "FROM catalog.package_versions",
        "WHERE package_version_id = $1",
      ].join(" "),
      [packageVersionId],
    );
    const persistedVersion = result.rows[0];
    assert.equal(persistedVersion?.title, "Alignment Package");
    assert.equal(persistedVersion?.educational_subject, "Statistics and probability");
    assert.equal(persistedVersion?.educational_framework, "AP Statistics");
    assert.equal(persistedVersion?.educational_level, "Undergraduate");
  } finally {
    await pool.end();
  }
});
