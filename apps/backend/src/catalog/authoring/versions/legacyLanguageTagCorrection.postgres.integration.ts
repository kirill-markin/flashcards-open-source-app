import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

type PackageVersionLanguageTagRow = Readonly<{
  package_version_id: string;
  version_number: number;
  language_tags: readonly string[];
  created_at: Date;
  updated_at: Date;
}>;

const legacyPackageSlug = "us-citizenship-test";
const untouchedVersionNumber = 4;

function requireTestDatabaseAdminUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the legacy catalog language tag integration test.",
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

// Migration 0129 is the only migration in this repository that disables a trigger. The postgres
// integration runner seeds production's shape - three published ARRAY['en-us'] versions plus the
// already-correct published version 4 - so the DISABLE TRIGGER, the UPDATE and the ENABLE TRIGGER
// are parsed and executed against a real PostgreSQL before the production release runs them. Only
// a real database can prove that the guard the migration turns off is armed again afterwards.
//
// The exact-array WHERE is not what this test proves. A package-wide WHERE is rejected by the
// migration's own updated_count <> expected_version_count abort in
// db/migrations/0129_correct_legacy_catalog_language_tag.sql, which fails the migration run before
// this file executes, and language_tags alone could not tell the two apart afterwards: every
// version reads ARRAY['en'] either way. What this test can observe is that version 4 was never
// written at all. package_versions_set_updated_at stamps updated_at on every row the UPDATE
// touches, and the seed and the migration commit in separate transactions, so the corrected
// versions end with updated_at past created_at while version 4 keeps the two equal.
test("migration 0129 normalizes the legacy catalog language tag and rearms the published version guard", async () => {
  const pool = new pg.Pool({
    connectionString: requireTestDatabaseAdminUrl(),
    application_name: "catalog-legacy-language-tag-integration",
  });

  try {
    const versions = await pool.query<PackageVersionLanguageTagRow>(
      [
        "SELECT package_versions.package_version_id, package_versions.version_number,",
        "package_versions.language_tags, package_versions.created_at,",
        "package_versions.updated_at",
        "FROM catalog.package_versions AS package_versions",
        "JOIN catalog.packages AS packages",
        "ON packages.package_id = package_versions.package_id",
        "WHERE packages.slug = $1",
        "ORDER BY package_versions.version_number",
      ].join(" "),
      [legacyPackageSlug],
    );
    assert.deepEqual(
      versions.rows.map((version) => version.version_number),
      [1, 2, 3, 4],
    );
    for (const version of versions.rows) {
      assert.deepEqual(version.language_tags, ["en"]);
      if (version.version_number === untouchedVersionNumber) {
        assert.equal(
          version.updated_at.getTime(),
          version.created_at.getTime(),
          `Version ${version.version_number} was written by the migration but must not be.`,
        );
        continue;
      }
      assert.ok(
        version.updated_at.getTime() > version.created_at.getTime(),
        `Version ${version.version_number} was not stamped by package_versions_set_updated_at.`,
      );
    }

    const correctedVersion = versions.rows[0];
    await assert.rejects(
      pool.query(
        "UPDATE catalog.package_versions SET title = $2 WHERE package_version_id = $1",
        [correctedVersion?.package_version_id, "Rejected title edit"],
      ),
      isPublishedVersionImmutable,
    );
  } finally {
    await pool.end();
  }
});
