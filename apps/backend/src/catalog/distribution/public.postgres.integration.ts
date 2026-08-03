import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { loadPublicCatalogSnapshotInExecutor } from "./public";

const fixtureAuthorId = "00000000-0000-4000-a105-000000000001";
const fixturePackageId = "00000000-0000-4000-a105-000000000002";
const fixturePackageVersionId = "00000000-0000-4000-a105-000000000003";
const fixtureCardIds = [
  "00000000-0000-4000-a105-000000000004",
  "00000000-0000-4000-a105-000000000005",
] as const;
const fixtureCollectionId = "00000000-0000-4000-a107-000000000001";

type CollectionFixtureRow = Readonly<{
  collection_id: string;
  package_id: string;
  ordinal: number;
}>;

function requireTestDatabaseAdminUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("TEST_DATABASE_ADMIN_URL is required for the public catalog snapshot integration test.");
  }

  return databaseUrl;
}

function createPoolExecutor(pool: pg.Pool): DatabaseExecutor {
  return {
    query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      return pool.query<Row>(text, [...params]);
    },
  };
}

test("latest migrations expose the deterministic collection through the public catalog snapshot", async () => {
  const pool = new pg.Pool({
    connectionString: requireTestDatabaseAdminUrl(),
    application_name: "public-catalog-snapshot-integration",
  });

  try {
    const fixtureResult = await pool.query<CollectionFixtureRow>(
      `SELECT
         collections.collection_id::text AS collection_id,
         memberships.package_id::text AS package_id,
         memberships.ordinal
       FROM catalog.collections AS collections
       INNER JOIN catalog.collection_packages AS memberships
         ON memberships.collection_id = collections.collection_id
       WHERE collections.collection_id = $1
         AND collections.status = 'published'
         AND collections.delisted_at IS NULL`,
      [fixtureCollectionId],
    );
    assert.deepEqual(fixtureResult.rows, [{
      collection_id: fixtureCollectionId,
      package_id: fixturePackageId,
      ordinal: 1,
    }]);

    const snapshot = await loadPublicCatalogSnapshotInExecutor(createPoolExecutor(pool), {
      publicApiBaseUrl: "https://api.flashcards-open-source-app.com/v1",
      publicAppBaseUrl: "https://flashcards-open-source-app.com",
      generatedAt: "2026-08-03T00:02:00.000Z",
    });

    const author = snapshot.authors.find((candidate) => candidate.authorId === fixtureAuthorId);
    const catalogPackage = snapshot.packages.find((candidate) => candidate.packageId === fixturePackageId);
    const packageVersion = snapshot.packageVersions.find(
      (candidate) => candidate.packageVersionId === fixturePackageVersionId,
    );
    const cards = snapshot.cards.filter(
      (candidate) => candidate.packageVersionId === fixturePackageVersionId,
    );
    const collection = snapshot.collections.find(
      (candidate) => candidate.collectionId === fixtureCollectionId,
    );
    const collectionPackage = snapshot.collectionPackages.find(
      (candidate) => candidate.collectionId === fixtureCollectionId,
    );

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(author?.authorId, fixtureAuthorId);
    assert.equal(catalogPackage?.authorId, fixtureAuthorId);
    assert.equal(catalogPackage?.latestPackageVersionId, fixturePackageVersionId);
    assert.equal(packageVersion?.packageId, fixturePackageId);
    assert.equal(
      packageVersion?.installUrl,
      `https://flashcards-open-source-app.com/catalog/import/${fixturePackageVersionId}`,
    );
    assert.deepEqual(cards.map((card) => card.packageCardId), fixtureCardIds);
    assert.deepEqual(cards.map((card) => card.ordinal), [1, 2]);
    assert.equal(collection?.coverPackageId, fixturePackageId);
    assert.deepEqual(collectionPackage, {
      collectionId: fixtureCollectionId,
      packageId: fixturePackageId,
      ordinal: 1,
    });
  } finally {
    await pool.end();
  }
});
