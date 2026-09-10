import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { HttpError } from "../../../shared/errors";
import type { CorrectCatalogPackageEducationalAlignmentInput } from "../../types";
import { correctCatalogPackageEducationalAlignmentInExecutor } from "./educationalAlignment";

type PackageVersionAlignmentRow = Readonly<{
  title: string;
  educational_subject: string | null;
  educational_framework: string | null;
  educational_level: string | null;
}>;

type PackageVersionCorrectionRow = Readonly<{
  version_number: number;
  status: string;
  educational_subject: string | null;
  educational_framework: string | null;
  educational_level: string | null;
  updated_at: string;
}>;

// The framework is deliberately multi-word: interior single spaces are the normal case for a real
// framework name and must survive the screen that rejects control and format characters.
const correctedAlignment: CorrectCatalogPackageEducationalAlignmentInput = {
  educationalSubject: "Estadística",
  educationalFramework: "Selectividad de Andalucía",
  educationalLevel: "Bachillerato",
};

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

function isEducationalAlignmentRejected(error: unknown): boolean {
  return error instanceof HttpError
    && error.statusCode === 400
    && error.code === "CATALOG_PACKAGE_EDUCATIONAL_ALIGNMENT_NOT_PUBLICLY_ELIGIBLE";
}

/**
 * Seeds one published package carrying two published versions and one draft version, so a
 * correction has to cross the status boundary the immutability trigger cares about.
 */
async function seedCorrectionFixture(pool: pg.Pool, suffix: string): Promise<string> {
  const authorId = randomUUID();
  const packageId = randomUUID();
  const packageVersionIds = [randomUUID(), randomUUID(), randomUUID()];
  await pool.query(
    [
      "INSERT INTO catalog.authors (author_id, slug, display_name)",
      "VALUES ($1, $2, $3)",
    ].join(" "),
    [authorId, `correction-author-${suffix}`, "Correction Author"],
  );
  await pool.query(
    [
      "INSERT INTO catalog.packages",
      "(package_id, author_id, slug, title, summary, description, language_tags, license, status,",
      "published_at, educational_subject, educational_framework, educational_level)",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', now(), $9, $10, $11)",
    ].join(" "),
    [
      packageId,
      authorId,
      `correction-package-${suffix}`,
      "Correction Package",
      "Integration-owned correction package.",
      "Catalog package created by the educational alignment correction integration test.",
      ["es"],
      "CC0-1.0",
      "Statistics",
      null,
      "High school",
    ],
  );
  for (const [index, packageVersionId] of packageVersionIds.entries()) {
    await pool.query(
      [
        "INSERT INTO catalog.package_versions",
        "(package_version_id, package_id, version_number, slug, title, summary, description,",
        "language_tags, license, created_by_admin_email,",
        "educational_subject, educational_framework, educational_level)",
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
      ].join(" "),
      [
        packageVersionId,
        packageId,
        index + 1,
        `correction-version-${suffix}-v${index + 1}`,
        "Correction Package",
        "Integration-owned correction package.",
        "Catalog package created by the educational alignment correction integration test.",
        ["es"],
        "CC0-1.0",
        "correction@example.test",
        "Statistics",
        null,
        "High school",
      ],
    );
    // The last version stays a draft. A correction must reach it too: nothing re-copies the three
    // columns onto a version row after creation, so a draft left behind would silently revert the
    // correction the moment it is approved and published.
    if (index === packageVersionIds.length - 1) {
      continue;
    }

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
  }

  return packageId;
}

async function readCorrectionVersions(
  pool: pg.Pool,
  packageId: string,
): Promise<ReadonlyArray<PackageVersionCorrectionRow>> {
  const result = await pool.query<PackageVersionCorrectionRow>(
    [
      "SELECT version_number, status::text AS status, educational_subject,",
      "educational_framework, educational_level, updated_at::text AS updated_at",
      "FROM catalog.package_versions",
      "WHERE package_id = $1",
      "ORDER BY version_number ASC",
    ].join(" "),
    [packageId],
  );

  return result.rows;
}

// The educational alignment columns are deliberately outside
// catalog.prevent_published_package_version_update(), so a correction can fix a wrong subject in
// place instead of forcing a new version. Only a real database can tell that exclusion apart from
// an oversight.
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

// The admin correction path is the product-level use of that exclusion: one transaction rewrites
// the classification of the package row and of every version row of it, whatever its status,
// because nothing re-copies these columns onto a version row after it is created. Only a real
// database shows the write the trigger permits is the write this function performs, and that
// replaying the identical correction writes no row at all and so leaves every updated_at - the
// artifact's per-version updatedAt - exactly where it was.
test("correcting educational alignment writes the package and every version, then replays as a no-op", async () => {
  const pool = new pg.Pool({
    connectionString: requireTestDatabaseAdminUrl(),
    application_name: "catalog-educational-alignment-correction-integration",
    max: 2,
  });
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    const packageId = await seedCorrectionFixture(pool, randomUUID().replaceAll("-", ""));

    await client.query("BEGIN");
    transactionOpen = true;
    const correction = await correctCatalogPackageEducationalAlignmentInExecutor(
      createClientExecutor(client),
      packageId,
      correctedAlignment,
    );
    await client.query("COMMIT");
    transactionOpen = false;

    assert.deepEqual(
      correction.packageVersions.map((packageVersion) => [
        packageVersion.versionNumber,
        packageVersion.status,
      ]),
      [[1, "published"], [2, "published"], [3, "draft"]],
    );
    assert.equal(correction.catalogPackage.educationalSubject, "Estadística");
    assert.equal(correction.catalogPackage.educationalFramework, "Selectividad de Andalucía");
    assert.equal(correction.catalogPackage.educationalLevel, "Bachillerato");
    const correctedVersions = await readCorrectionVersions(pool, packageId);
    assert.deepEqual(
      correctedVersions.map((row) => [
        row.version_number,
        row.status,
        row.educational_subject,
        row.educational_framework,
        row.educational_level,
      ]),
      [
        [1, "published", "Estadística", "Selectividad de Andalucía", "Bachillerato"],
        [2, "published", "Estadística", "Selectividad de Andalucía", "Bachillerato"],
        [3, "draft", "Estadística", "Selectividad de Andalucía", "Bachillerato"],
      ],
    );

    await client.query("BEGIN");
    transactionOpen = true;
    const replay = await correctCatalogPackageEducationalAlignmentInExecutor(
      createClientExecutor(client),
      packageId,
      correctedAlignment,
    );
    await client.query("COMMIT");
    transactionOpen = false;

    assert.deepEqual(replay.packageVersions, []);
    assert.equal(replay.catalogPackage.educationalSubject, "Estadística");
    assert.equal(replay.catalogPackage.educationalFramework, "Selectividad de Andalucía");
    assert.equal(replay.catalogPackage.educationalLevel, "Bachillerato");
    assert.deepEqual(
      (await readCorrectionVersions(pool, packageId)).map((row) => row.updated_at),
      correctedVersions.map((row) => row.updated_at),
    );
  } finally {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    client.release();
    await pool.end();
  }
});

// Publication is a one-shot gate: a published version can only move to delisted, so it never
// re-enters the publish path and nothing revalidates a value written after publication. The
// correction therefore screens the submitted values itself, before it writes anything.
test("correcting educational alignment refuses values the public catalog cannot present", async () => {
  const pool = new pg.Pool({
    connectionString: requireTestDatabaseAdminUrl(),
    application_name: "catalog-educational-alignment-rejection-integration",
    max: 2,
  });
  const client = await pool.connect();
  const rejectedAlignments: ReadonlyArray<CorrectCatalogPackageEducationalAlignmentInput> = [
    { educationalSubject: "", educationalFramework: null, educationalLevel: null },
    { educationalSubject: "   ", educationalFramework: null, educationalLevel: null },
    { educationalSubject: " Estadística", educationalFramework: null, educationalLevel: null },
    {
      educationalSubject: "Estad\u200Bística",
      educationalFramework: null,
      educationalLevel: null,
    },
    {
      educationalSubject: "Estadística",
      educationalFramework: "Selectividad\u00AD",
      educationalLevel: null,
    },
    // Trimming reaches the ends of a value only, so an interior control character or line
    // separator would otherwise be printed verbatim into the visible deck row and into the
    // schema.org educationalAlignment target name. The interior single spaces of the multi-word
    // framework this file corrects to are what the same screen must not catch.
    {
      educationalSubject: "Estadística\nAplicada",
      educationalFramework: null,
      educationalLevel: null,
    },
    {
      educationalSubject: "Estadística\tAplicada",
      educationalFramework: null,
      educationalLevel: null,
    },
    {
      educationalSubject: "Estadística",
      educationalFramework: "Selectividad\u2028de Andalucía",
      educationalLevel: null,
    },
    {
      educationalSubject: "Estadística",
      educationalFramework: null,
      educationalLevel: "Bachillerato\u2029Segundo",
    },
    {
      educationalSubject: "Estadística",
      educationalFramework: null,
      educationalLevel: `media/blobs/sha256/${"a".repeat(64)}`,
    },
  ];

  try {
    const packageId = await seedCorrectionFixture(pool, randomUUID().replaceAll("-", ""));

    for (const rejectedAlignment of rejectedAlignments) {
      await assert.rejects(
        correctCatalogPackageEducationalAlignmentInExecutor(
          createClientExecutor(client),
          packageId,
          rejectedAlignment,
        ),
        isEducationalAlignmentRejected,
      );
    }

    assert.deepEqual(
      (await readCorrectionVersions(pool, packageId)).map((row) => [
        row.educational_subject,
        row.educational_framework,
        row.educational_level,
      ]),
      [
        ["Statistics", null, "High school"],
        ["Statistics", null, "High school"],
        ["Statistics", null, "High school"],
      ],
    );
  } finally {
    client.release();
    await pool.end();
  }
});
