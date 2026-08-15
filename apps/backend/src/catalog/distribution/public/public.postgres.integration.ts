import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { loadPublicCatalogSnapshotInExecutor } from "./public";

const delistedFixturePackageId = "00000000-0000-4000-a105-000000000002";
const delistedFixturePackageVersionId = "00000000-0000-4000-a105-000000000003";
const delistedFixtureCollectionId = "00000000-0000-4000-a107-000000000001";

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

test("latest migrations delist deterministic fixtures and expose test-owned public catalog data", async () => {
  const pool = new pg.Pool({
    connectionString: requireTestDatabaseAdminUrl(),
    application_name: "public-catalog-snapshot-integration",
  });
  const suffix = randomUUID().replaceAll("-", "");
  const authorId = randomUUID();
  const packageId = randomUUID();
  const packageVersionId = randomUUID();
  const cardIds = [randomUUID(), randomUUID()] as const;
  const collectionId = randomUUID();
  const authorSlug = `public-snapshot-author-${suffix}`;
  const packageSlug = `public-snapshot-package-${suffix}`;
  const packageVersionSlug = `public-snapshot-version-${suffix}`;
  const collectionSlug = `public-snapshot-collection-${suffix}`;
  const adminEmail = "public-snapshot@example.test";

  try {
    const setupClient = await pool.connect();
    try {
      await setupClient.query("BEGIN");
      await setupClient.query(
        [
          "INSERT INTO catalog.authors",
          "(author_id, slug, display_name, bio, website_url)",
          "VALUES ($1, $2, $3, $4, NULL)",
        ].join(" "),
        [authorId, authorSlug, "Public Snapshot Author", "Integration-owned catalog author."],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.packages",
          "(package_id, author_id, slug, title, summary, description, language_tags, license)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        ].join(" "),
        [
          packageId,
          authorId,
          packageSlug,
          "Public Snapshot Package",
          "Integration-owned snapshot package.",
          "Valid public catalog data created by the snapshot integration test.",
          ["en"],
          "CC0-1.0",
        ],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.package_versions",
          "(package_version_id, package_id, version_number, slug, title, summary, description,",
          "language_tags, license, card_count, created_by_admin_email)",
          "VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, 2, $9)",
        ].join(" "),
        [
          packageVersionId,
          packageId,
          packageVersionSlug,
          "Public Snapshot Package",
          "Integration-owned snapshot package.",
          "Valid public catalog data created by the snapshot integration test.",
          ["en"],
          "CC0-1.0",
          adminEmail,
        ],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.package_cards",
          "(package_card_id, package_version_id, stable_card_key, ordinal, front_text, back_text,",
          "card_type, metadata, tags, media_asset_keys)",
          "VALUES",
          "($1, $3, 'snapshot-1', 1, 'What does the first snapshot card verify?',",
          "'The first ordered card.', 'basic', '{\"version\":1,\"source\":null}'::jsonb, ARRAY['integration'], ARRAY[]::text[]),",
          "($2, $3, 'snapshot-2', 2, 'What does the second snapshot card verify?',",
          "'The second ordered card.', 'basic', '{\"version\":1,\"source\":null}'::jsonb, ARRAY['integration'], ARRAY[]::text[])",
        ].join(" "),
        [cardIds[0], cardIds[1], packageVersionId],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.package_review_events",
          "(package_id, package_version_id, from_status, to_status, actor_admin_email, note)",
          "VALUES ($1, $2, NULL, 'draft', $3, NULL)",
        ].join(" "),
        [packageId, packageVersionId, adminEmail],
      );
      await setupClient.query(
        [
          "UPDATE catalog.package_versions",
          "SET status = 'submitted', submitted_at = now()",
          "WHERE package_version_id = $1 AND status = 'draft'",
        ].join(" "),
        [packageVersionId],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.package_review_events",
          "(package_id, package_version_id, from_status, to_status, actor_admin_email, note)",
          "VALUES ($1, $2, 'draft', 'submitted', $3, NULL)",
        ].join(" "),
        [packageId, packageVersionId, adminEmail],
      );
      await setupClient.query(
        [
          "UPDATE catalog.package_versions",
          "SET status = 'approved', reviewed_by_admin_email = $2, reviewed_at = now()",
          "WHERE package_version_id = $1 AND status = 'submitted'",
        ].join(" "),
        [packageVersionId, adminEmail],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.package_review_events",
          "(package_id, package_version_id, from_status, to_status, actor_admin_email, note)",
          "VALUES ($1, $2, 'submitted', 'approved', $3, NULL)",
        ].join(" "),
        [packageId, packageVersionId, adminEmail],
      );
      await setupClient.query(
        [
          "UPDATE catalog.package_versions",
          "SET status = 'published', published_at = now()",
          "WHERE package_version_id = $1 AND status = 'approved'",
        ].join(" "),
        [packageVersionId],
      );
      await setupClient.query(
        [
          "UPDATE catalog.packages",
          "SET status = 'published', published_at = now()",
          "WHERE package_id = $1 AND status = 'draft'",
        ].join(" "),
        [packageId],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.package_review_events",
          "(package_id, package_version_id, from_status, to_status, actor_admin_email, note)",
          "VALUES ($1, $2, 'approved', 'published', $3, NULL)",
        ].join(" "),
        [packageId, packageVersionId, adminEmail],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.collections",
          "(collection_id, slug, title, summary, description, language_tags, cover_package_id)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        ].join(" "),
        [
          collectionId,
          collectionSlug,
          "Public Snapshot Collection",
          "Integration-owned snapshot collection.",
          "Valid ordered catalog collection created by the snapshot integration test.",
          ["en"],
          packageId,
        ],
      );
      await setupClient.query(
        [
          "UPDATE catalog.collections",
          "SET status = 'published', published_at = now()",
          "WHERE collection_id = $1 AND status = 'draft'",
        ].join(" "),
        [collectionId],
      );
      await setupClient.query(
        [
          "INSERT INTO catalog.collection_packages (collection_id, package_id, ordinal)",
          "VALUES ($1, $2, 1)",
        ].join(" "),
        [collectionId, packageId],
      );
      await setupClient.query("COMMIT");
    } catch (error) {
      await setupClient.query("ROLLBACK");
      throw error;
    } finally {
      setupClient.release();
    }

    const snapshot = await loadPublicCatalogSnapshotInExecutor(createPoolExecutor(pool), {
      publicApiBaseUrl: "https://api.flashcards-open-source-app.com/v1",
      publicAppBaseUrl: "https://flashcards-open-source-app.com",
      generatedAt: "2026-08-14T00:00:00.000Z",
    });

    const author = snapshot.authors.find((candidate) => candidate.authorId === authorId);
    const catalogPackage = snapshot.packages.find((candidate) => candidate.packageId === packageId);
    const packageVersion = snapshot.packageVersions.find(
      (candidate) => candidate.packageVersionId === packageVersionId,
    );
    const cards = snapshot.cards.filter(
      (candidate) => candidate.packageVersionId === packageVersionId,
    );
    const collection = snapshot.collections.find(
      (candidate) => candidate.collectionId === collectionId,
    );
    const collectionPackage = snapshot.collectionPackages.find(
      (candidate) => candidate.collectionId === collectionId
        && candidate.packageId === packageId,
    );

    assert.equal(snapshot.schemaVersion, 2);
    assert.deepEqual(author, {
      authorId,
      slug: authorSlug,
      displayName: "Public Snapshot Author",
      bio: "Integration-owned catalog author.",
      websiteUrl: null,
    });
    assert.equal(catalogPackage?.authorId, authorId);
    assert.equal(catalogPackage?.slug, packageSlug);
    assert.equal(catalogPackage?.status, "published");
    assert.equal(catalogPackage?.latestPackageVersionId, packageVersionId);
    assert.equal(catalogPackage?.versionCount, 1);
    assert.equal(packageVersion?.packageId, packageId);
    assert.equal(packageVersion?.versionNumber, 1);
    assert.equal(packageVersion?.status, "published");
    assert.equal(packageVersion?.slug, packageVersionSlug);
    assert.equal(packageVersion?.title, "Public Snapshot Package");
    assert.equal(packageVersion?.summary, "Integration-owned snapshot package.");
    assert.equal(
      packageVersion?.description,
      "Valid public catalog data created by the snapshot integration test.",
    );
    assert.deepEqual(packageVersion?.languageTags, ["en"]);
    assert.equal(packageVersion?.license, "CC0-1.0");
    assert.equal(packageVersion?.contentWarning, null);
    assert.equal(packageVersion?.coverMediaAssetId, null);
    assert.equal(packageVersion?.cardCount, 2);
    assert.equal(
      packageVersion?.installUrl,
      `https://flashcards-open-source-app.com/catalog/import/${packageVersionId}`,
    );
    assert.deepEqual(cards, [
      {
        packageCardId: cardIds[0],
        packageVersionId,
        ordinal: 1,
        frontText: "What does the first snapshot card verify?",
        backText: "The first ordered card.",
        cardType: "basic",
        tags: ["integration"],
        mediaAssetIds: [],
      },
      {
        packageCardId: cardIds[1],
        packageVersionId,
        ordinal: 2,
        frontText: "What does the second snapshot card verify?",
        backText: "The second ordered card.",
        cardType: "basic",
        tags: ["integration"],
        mediaAssetIds: [],
      },
    ]);
    assert.equal(collection?.slug, collectionSlug);
    assert.equal(collection?.title, "Public Snapshot Collection");
    assert.equal(collection?.status, "published");
    assert.equal(collection?.coverPackageId, packageId);
    assert.equal("coverDownloadUrl" in (collection ?? {}), false);
    assert.deepEqual(collectionPackage, {
      collectionId,
      packageId,
      ordinal: 1,
    });
    assert.equal(
      snapshot.packages.some((candidate) => candidate.packageId === delistedFixturePackageId),
      false,
    );
    assert.equal(
      snapshot.packageVersions.some(
        (candidate) => candidate.packageVersionId === delistedFixturePackageVersionId,
      ),
      false,
    );
    assert.equal(
      snapshot.collections.some(
        (candidate) => candidate.collectionId === delistedFixtureCollectionId,
      ),
      false,
    );
  } finally {
    await pool.end();
  }
});
