import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import pg from "pg";

type SubjectRow = Readonly<{
  educational_subject: string | null;
  educational_framework: string | null;
  educational_level: string | null;
  status: string;
  updated_at: Date;
}>;

type MissingSubjectCountRow = Readonly<{
  packages: number;
  package_versions: number;
}>;

// The deterministic catalog test fixture: seeded by 0105, delisted by 0111, absent from 0130's
// approved alignment table, and therefore the one package row 0130 left with a NULL subject.
const fixturePackageId = "00000000-0000-4000-a105-000000000002";
const fixturePackageVersionId = "00000000-0000-4000-a105-000000000003";
const fixtureSubject = "Test";
// The in-flight row seedMigration0131InFlightCatalogAlignment adds to the package the 0129 hook
// creates. 0130 filled that package's draft row with the approved Civics triple; this version was
// created before it and carries NULL, exactly like a version created before the backfill in
// production.
const inFlightPackageVersionId = "13100000-0000-4000-8000-000000000001";
const inFlightSubject = "Civics";
const migration0131 = readFileSync(resolve(
  __dirname, "../../../../../../db/migrations/0131_require_catalog_educational_subject.sql",
), "utf8");

function requireTestDatabaseAdminUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required for the required catalog educational subject integration test.",
    );
  }

  return databaseUrl;
}

function isPostgresFailure(code: string, messageFragment: string) {
  return (error: unknown): boolean => (
    error instanceof Error
    && "code" in error
    && error.code === code
    && error.message.includes(messageFragment)
  );
}

async function readPackage(pool: pg.Pool, packageId: string): Promise<SubjectRow> {
  const result = await pool.query<SubjectRow>(
    [
      "SELECT educational_subject, educational_framework, educational_level,",
      "status::TEXT AS status, updated_at",
      "FROM catalog.packages",
      "WHERE package_id = $1",
    ].join(" "),
    [packageId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Expected catalog package ${packageId} to exist.`);
  }

  return row;
}

async function readPackageVersion(
  pool: pg.Pool,
  packageVersionId: string,
): Promise<SubjectRow> {
  const result = await pool.query<SubjectRow>(
    [
      "SELECT educational_subject, educational_framework, educational_level,",
      "status::TEXT AS status, updated_at",
      "FROM catalog.package_versions",
      "WHERE package_version_id = $1",
    ].join(" "),
    [packageVersionId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Expected catalog package version ${packageVersionId} to exist.`);
  }

  return row;
}

async function readMissingSubjectCounts(
  pool: pg.Pool,
): Promise<ReadonlyArray<number>> {
  const result = await pool.query<MissingSubjectCountRow>(`
    SELECT
      (
        SELECT count(*)::int
        FROM catalog.packages
        WHERE educational_subject IS NULL OR btrim(educational_subject) = ''
      ) AS packages,
      (
        SELECT count(*)::int
        FROM catalog.package_versions
        WHERE educational_subject IS NULL OR btrim(educational_subject) = ''
      ) AS package_versions
  `);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Expected the missing educational subject count query to return a row.");
  }

  return [row.packages, row.package_versions];
}

// Migration 0131 closes the educational alignment contract: every catalog package and every
// package version must carry a non-blank educational subject. Both blocked row shapes only exist
// against a real PostgreSQL that has replayed the whole migration chain, so this boundary is where
// the ALTER is rehearsed before a release runs it.
test("migration 0131 requires a non-blank educational subject on every catalog row", async () => {
  const pool = new pg.Pool({
    connectionString: requireTestDatabaseAdminUrl(),
    application_name: "catalog-required-educational-subject-integration",
  });

  try {
    // Blocker 1: the delisted test fixture gets the plainly non-content subject the migration
    // invents for it, on both its package row and its version row.
    const fixturePackage = await readPackage(pool, fixturePackageId);
    assert.equal(fixturePackage.status, "delisted");
    assert.equal(fixturePackage.educational_subject, fixtureSubject);
    const fixtureVersion = await readPackageVersion(pool, fixturePackageVersionId);
    assert.equal(fixtureVersion.status, "delisted");
    assert.equal(fixtureVersion.educational_subject, fixtureSubject);

    // Blocker 2: the in-flight version row is filled from its catalog.packages parent, whatever its
    // status. Only the subject is copied down; framework and level stay NULL on purpose, because a
    // NULL there is a legitimate value rather than an absence.
    const inFlightVersion = await readPackageVersion(pool, inFlightPackageVersionId);
    assert.equal(inFlightVersion.status, "draft");
    assert.equal(inFlightVersion.educational_subject, inFlightSubject);
    assert.equal(inFlightVersion.educational_framework, null);
    assert.equal(inFlightVersion.educational_level, null);

    assert.deepEqual(await readMissingSubjectCounts(pool), [0, 0]);

    // The constraints are armed over both tables afterwards. Every probe runs inside a savepoint of
    // a transaction that is rolled back, so the boundary database keeps the shape the next
    // assertions read.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const probeAuthorId = "13100000-0000-4000-8000-000000000101";
      const probePackageId = "13100000-0000-4000-8000-000000000102";
      await client.query(
        "INSERT INTO catalog.authors (author_id, slug, display_name) VALUES ($1, $2, $3)",
        [probeAuthorId, "migration-0131-constraint-probe", "Migration 0131 constraint probe"],
      );
      await client.query(
        `INSERT INTO catalog.packages (
           package_id, author_id, slug, title, summary, description, language_tags,
           educational_subject, license
         ) VALUES (
           $1, $2, 'migration-0131-constraint-probe', 'Constraint probe',
           'Constraint probe package.', 'Constraint probe package description.',
           ARRAY['en']::TEXT[], 'Constraint probe subject', 'CC0-1.0'
         )`,
        [probePackageId, probeAuthorId],
      );

      const probes = [
        {
          label: "package with a NULL subject",
          sql: `INSERT INTO catalog.packages (
                  package_id, author_id, slug, title, summary, description, language_tags, license
                ) VALUES (
                  $1, $2, 'migration-0131-null-subject', 'Null subject',
                  'Null subject package.', 'Null subject package description.',
                  ARRAY['en']::TEXT[], 'CC0-1.0'
                )`,
          params: ["13100000-0000-4000-8000-000000000103", probeAuthorId],
          code: "23502",
          messageFragment: "educational_subject",
        },
        {
          label: "package with a blank subject",
          sql: `INSERT INTO catalog.packages (
                  package_id, author_id, slug, title, summary, description, language_tags,
                  educational_subject, license
                ) VALUES (
                  $1, $2, 'migration-0131-blank-subject', 'Blank subject',
                  'Blank subject package.', 'Blank subject package description.',
                  ARRAY['en']::TEXT[], '   ', 'CC0-1.0'
                )`,
          params: ["13100000-0000-4000-8000-000000000104", probeAuthorId],
          code: "23514",
          messageFragment: "packages_educational_subject_nonempty",
        },
        {
          label: "package version with a NULL subject",
          sql: `INSERT INTO catalog.package_versions (
                  package_version_id, package_id, version_number, slug, title, summary,
                  description, language_tags, license, created_by_admin_email
                ) VALUES (
                  $1, $2, 1, 'migration-0131-constraint-probe', 'Constraint probe',
                  'Constraint probe version.', 'Constraint probe version description.',
                  ARRAY['en']::TEXT[], 'CC0-1.0', 'migration-0131@example.test'
                )`,
          params: ["13100000-0000-4000-8000-000000000105", probePackageId],
          code: "23502",
          messageFragment: "educational_subject",
        },
        {
          label: "package version with a blank subject",
          sql: `INSERT INTO catalog.package_versions (
                  package_version_id, package_id, version_number, slug, title, summary,
                  description, language_tags, educational_subject, license,
                  created_by_admin_email
                ) VALUES (
                  $1, $2, 2, 'migration-0131-constraint-probe', 'Constraint probe',
                  'Constraint probe version.', 'Constraint probe version description.',
                  ARRAY['en']::TEXT[], '   ', 'CC0-1.0', 'migration-0131@example.test'
                )`,
          params: ["13100000-0000-4000-8000-000000000106", probePackageId],
          code: "23514",
          messageFragment: "package_versions_educational_subject_nonempty",
        },
      ] as const;

      for (const probe of probes) {
        await client.query("SAVEPOINT constraint_probe");
        await assert.rejects(
          client.query(probe.sql, [...probe.params]),
          isPostgresFailure(probe.code, probe.messageFragment),
          `Expected the ${probe.label} to be rejected.`,
        );
        await client.query("ROLLBACK TO SAVEPOINT constraint_probe");
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    // A second application must write nothing and must leave the same schema: every UPDATE is
    // guarded on educational_subject IS NULL, SET NOT NULL is idempotent, and each CHECK is dropped
    // by name before it is added.
    await pool.query(migration0131);

    assert.deepEqual(
      [
        (await readPackage(pool, fixturePackageId)).updated_at.getTime(),
        (await readPackageVersion(pool, fixturePackageVersionId)).updated_at.getTime(),
        (await readPackageVersion(pool, inFlightPackageVersionId)).updated_at.getTime(),
      ],
      [
        fixturePackage.updated_at.getTime(),
        fixtureVersion.updated_at.getTime(),
        inFlightVersion.updated_at.getTime(),
      ],
    );
    assert.deepEqual(await readMissingSubjectCounts(pool), [0, 0]);
  } finally {
    await pool.end();
  }
});
