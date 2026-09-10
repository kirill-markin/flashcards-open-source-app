import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import pg from "pg";

type PackageAlignmentRow = Readonly<{
  educational_subject: string | null;
  educational_framework: string | null;
  educational_level: string | null;
  created_at: Date;
  updated_at: Date;
}>;

type PackageVersionAlignmentRow = Readonly<{
  package_version_id: string;
  version_number: number;
  title: string;
  educational_subject: string | null;
  educational_framework: string | null;
  educational_level: string | null;
  created_at: Date;
  updated_at: Date;
}>;

const backfilledPackageSlug = "us-citizenship-test";
const expectedSubject = "Civics";
const expectedFramework = "USCIS Naturalization Test";
const expectedLevel = "Civics test";
const expectedVersionNumbers = [1, 2, 3, 4];
// 0129's seed hook leaves version 4 alone and 0129's own boundary test asserts that, so anything
// that moved version 4's updated_at at this boundary is migration 0130 and nothing else.
const versionUntouchedBefore0130 = 4;
const migration0130 = readFileSync(resolve(
  __dirname, "../../../../../../db/migrations/0130_backfill_catalog_educational_alignment.sql",
), "utf8");

function requireTestDatabaseAdminUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the catalog educational alignment backfill integration test.",
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

async function readPackage(pool: pg.Pool): Promise<PackageAlignmentRow> {
  const result = await pool.query<PackageAlignmentRow>(
    [
      "SELECT packages.educational_subject, packages.educational_framework,",
      "packages.educational_level, packages.created_at, packages.updated_at",
      "FROM catalog.packages AS packages",
      "WHERE packages.slug = $1",
    ].join(" "),
    [backfilledPackageSlug],
  );
  const catalogPackage = result.rows[0];
  if (result.rows.length !== 1 || catalogPackage === undefined) {
    throw new Error(
      `Expected exactly one catalog package with slug ${backfilledPackageSlug}, found ${result.rows.length}.`,
    );
  }

  return catalogPackage;
}

async function readPublishedVersions(
  pool: pg.Pool,
): Promise<ReadonlyArray<PackageVersionAlignmentRow>> {
  const result = await pool.query<PackageVersionAlignmentRow>(
    [
      "SELECT package_versions.package_version_id, package_versions.version_number,",
      "package_versions.title, package_versions.educational_subject,",
      "package_versions.educational_framework, package_versions.educational_level,",
      "package_versions.created_at, package_versions.updated_at",
      "FROM catalog.package_versions AS package_versions",
      "JOIN catalog.packages AS packages",
      "ON packages.package_id = package_versions.package_id",
      "WHERE packages.slug = $1 AND package_versions.status = 'published'",
      "ORDER BY package_versions.version_number",
    ].join(" "),
    [backfilledPackageSlug],
  );

  return result.rows;
}

function comparableVersions(
  versions: ReadonlyArray<PackageVersionAlignmentRow>,
): ReadonlyArray<ReadonlyArray<string | number | null>> {
  return versions.map((version) => [
    version.version_number,
    version.title,
    version.educational_subject,
    version.educational_framework,
    version.educational_level,
    version.updated_at.getTime(),
  ]);
}

// Migration 0130 backfills the educational alignment of every deck that was published before those
// fields became part of the deck-publishing standard. The seed hook 0129 installs is the only
// approved slug a non-production database holds - package us-citizenship-test with four published
// versions and NULL alignment columns, which is that deck's production shape - so this boundary is
// the one place where the backfill's UPDATE of a published version row runs against a real
// PostgreSQL before a release runs it.
test("migration 0130 backfills the approved educational alignment onto a published deck", async () => {
  const pool = new pg.Pool({
    connectionString: requireTestDatabaseAdminUrl(),
    application_name: "catalog-educational-alignment-backfill-integration",
  });

  try {
    const catalogPackage = await readPackage(pool);
    assert.equal(catalogPackage.educational_subject, expectedSubject);
    assert.equal(catalogPackage.educational_framework, expectedFramework);
    assert.equal(catalogPackage.educational_level, expectedLevel);
    assert.ok(
      catalogPackage.updated_at.getTime() > catalogPackage.created_at.getTime(),
      "The catalog.packages draft row was not written by the backfill.",
    );

    const versions = await readPublishedVersions(pool);
    assert.deepEqual(
      versions.map((version) => version.version_number),
      expectedVersionNumbers,
    );
    for (const version of versions) {
      assert.equal(version.educational_subject, expectedSubject);
      assert.equal(version.educational_framework, expectedFramework);
      assert.equal(version.educational_level, expectedLevel);
    }
    const untouchedVersion = versions.find(
      (version) => version.version_number === versionUntouchedBefore0130,
    );
    assert.ok(
      untouchedVersion !== undefined
        && untouchedVersion.updated_at.getTime() > untouchedVersion.created_at.getTime(),
      `Version ${versionUntouchedBefore0130} was not written by the backfill.`,
    );

    // The three columns sit outside catalog.prevent_published_package_version_update() on purpose,
    // so the backfill needs no trigger manipulation at all. This proves the guard it never touched
    // is still armed over the very rows the backfill just wrote.
    await assert.rejects(
      pool.query(
        "UPDATE catalog.package_versions SET title = $2 WHERE package_version_id = $1",
        [versions[0]?.package_version_id, "Rejected title edit"],
      ),
      isPublishedVersionImmutable,
    );

    // A second application must write nothing. Every UPDATE in the migration carries an
    // IS DISTINCT FROM guard, so catalog.set_updated_at() never fires on a row that already holds
    // the approved triple, and an unchanged updated_at is what proves it: any write would move it.
    // The migration is applied as one transaction because its ON COMMIT DROP temp table needs one.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration0130);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const rerunPackage = await readPackage(pool);
    assert.deepEqual(
      [
        rerunPackage.educational_subject,
        rerunPackage.educational_framework,
        rerunPackage.educational_level,
        rerunPackage.updated_at.getTime(),
      ],
      [
        expectedSubject,
        expectedFramework,
        expectedLevel,
        catalogPackage.updated_at.getTime(),
      ],
    );
    assert.deepEqual(
      comparableVersions(await readPublishedVersions(pool)),
      comparableVersions(versions),
    );
  } finally {
    await pool.end();
  }
});
