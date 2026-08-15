import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { createCatalogPublicRoutes } from "../../../routes/catalog/public";
import { maximumPublicCatalogMediaDownloadBytes } from "../../publicMediaDelivery";
import { loadPublicCatalogSnapshotInExecutor } from "./index";
import {
  createQueryResult,
  testAuthorId,
  testPackageId,
  testPackageVersionId,
  testTimestamp,
  testWorkspaceMediaAssetId,
} from "../../testSupport";
import {
  createPublicCatalogRouteTestApp,
  createPublicMediaAssetRow,
  createPublicPackageRow,
  unsafeStorageKeyPathDestination,
} from "./testSupport";

test("public catalog snapshot resolves Markdown-only media and excludes incomplete relations", async () => {
  const secondAuthorId = "99999999-1111-4111-8111-111111111111";
  const secondPackageId = "99999999-2222-4222-8222-222222222222";
  const draftPackageId = "99999999-3333-4333-8333-333333333333";
  const secondPackageVersionId = "99999999-4444-4444-8444-444444444444";
  const latestPackageVersionId = "99999999-5555-4555-8555-555555555555";
  const packageMediaAssetId = "99999999-6666-4666-8666-666666666666";
  const packageCardId = "99999999-7777-4777-8777-777777777777";
  const missingMediaPackageVersionId = "77777777-1111-4111-8111-111111111111";
  const missingMediaPackageCardId = "77777777-2222-4222-8222-222222222222";
  const missingPackageMediaKey = "missing-diagram";
  const unsafeLatestPackageVersionId = "66666666-1111-4111-8111-111111111111";
  const unsafeLatestPackageCardId = "66666666-2222-4222-8222-222222222222";
  const unsafeOnlyPackageId = "66666666-3333-4333-8333-333333333333";
  const unsafeOnlyPackageVersionId = "66666666-4444-4444-8444-444444444444";
  const unsafeOnlyPackageCardId = "66666666-5555-4555-8555-555555555555";
  const unsafeCollectionId = "66666666-6666-4666-8666-666666666666";
  const firstCollectionId = "99999999-8888-4888-8888-888888888888";
  const secondCollectionId = "99999999-9999-4999-8999-999999999999";
  const collectionCoverSha256 = "b".repeat(64);
  const collectionCoverStorageKey = `media/blobs/sha256/bb/bb/${collectionCoverSha256}`;
  const privateCoverMediaKey = testWorkspaceMediaAssetId;
  const publicApiBaseUrl = "https://api.example.com/v1";
  const publicAppBaseUrl = "https://app.example.com";
  const generatedAt = "2026-04-19T11:00:00.000Z";
  const packageVersionRows = [
    {
      ...createPublicPackageRow(),
      package_slug: "spanish-basics",
      package_published_at: testTimestamp,
      version_slug: "spanish-basics-v1",
    },
    {
      ...createPublicPackageRow(),
      package_version_id: latestPackageVersionId,
      version_number: 2,
      package_slug: "spanish-basics",
      package_published_at: testTimestamp,
      version_slug: "spanish-basics-v2",
      title: "Spanish Basics, second edition",
      cover_package_media_key: null,
      card_count: 0,
    },
    {
      ...createPublicPackageRow(),
      package_id: secondPackageId,
      author_id: secondAuthorId,
      author_slug: "second-author",
      author_display_name: "Second Author",
      package_version_id: secondPackageVersionId,
      package_slug: "german-basics",
      package_published_at: testTimestamp,
      version_slug: "german-basics-v1",
      slug: "german-basics-v1",
      title: "German Basics",
      language_tags: ["de"],
      cover_package_media_key: null,
      card_count: 0,
    },
    {
      ...createPublicPackageRow(),
      package_version_id: missingMediaPackageVersionId,
      version_number: 3,
      package_slug: "spanish-basics",
      package_published_at: testTimestamp,
      version_slug: "spanish-basics-v3",
      title: "Spanish Basics with missing media",
      cover_package_media_key: null,
    },
    {
      ...createPublicPackageRow(),
      package_version_id: unsafeLatestPackageVersionId,
      version_number: 4,
      package_slug: "spanish-basics",
      package_published_at: testTimestamp,
      version_slug: "spanish-basics-v4",
      title: "Spanish Basics with unsafe card text",
      cover_package_media_key: null,
    },
    {
      ...createPublicPackageRow(),
      package_id: unsafeOnlyPackageId,
      package_version_id: unsafeOnlyPackageVersionId,
      package_slug: "unsafe-only-package",
      package_published_at: testTimestamp,
      version_slug: "unsafe-only-package-v1",
      slug: "unsafe-only-package-v1",
      title: "Unsafe-only package",
      cover_package_media_key: null,
    },
  ];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      assert.deepEqual(params, []);
      if (text.includes("WHERE collections.cover_media_blob_id IS NOT NULL")) {
        assert.match(text, /LEFT JOIN content\.media_blobs AS media_blobs/);
        assert.match(text, /collections\.status = 'published'/);
        assert.match(text, /collections\.delisted_at IS NULL/);
        return createQueryResult([{
          collection_id: firstCollectionId,
          cover_media_blob_id: "99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          mime_type: "image/jpeg",
          size_bytes: 1_234,
          storage_key: collectionCoverStorageKey,
          sha256: collectionCoverSha256,
        }] as unknown as ReadonlyArray<Row>);
      }
      if (text.includes("FROM catalog.collection_packages AS memberships")) {
        assert.match(text, /collections\.status = 'published'/);
        assert.match(text, /packages\.status = 'published'/);
        assert.match(text, /EXISTS \( SELECT 1 FROM catalog\.package_versions AS versions/);
        return createQueryResult([
          { collection_id: firstCollectionId, package_id: testPackageId, ordinal: 2 },
          { collection_id: secondCollectionId, package_id: secondPackageId, ordinal: 1 },
          { collection_id: secondCollectionId, package_id: testPackageId, ordinal: 3 },
          { collection_id: secondCollectionId, package_id: draftPackageId, ordinal: 4 },
          { collection_id: secondCollectionId, package_id: unsafeOnlyPackageId, ordinal: 5 },
          { collection_id: unsafeCollectionId, package_id: testPackageId, ordinal: 1 },
        ] as unknown as ReadonlyArray<Row>);
      }

      if (text.includes("FROM catalog.collections AS collections")) {
        assert.match(text, /collections\.status = 'published'/);
        assert.match(text, /collections\.delisted_at IS NULL/);
        return createQueryResult([
          {
            collection_id: firstCollectionId,
            slug: "language-starters",
            title: "Language Starters",
            summary: "Starter language packages.",
            description: "A curated starter collection.",
            language_tags: ["en"],
            cover_package_id: testPackageId,
            status: "published",
            updated_at: testTimestamp,
            published_at: testTimestamp,
          },
          {
            collection_id: secondCollectionId,
            slug: "more-languages",
            title: "More Languages",
            summary: "More language packages.",
            description: "A second curated collection.",
            language_tags: ["en"],
            cover_package_id: draftPackageId,
            status: "published",
            updated_at: testTimestamp,
            published_at: testTimestamp,
          },
          {
            collection_id: unsafeCollectionId,
            slug: "unsafe-collection",
            title: "Unsafe Collection",
            summary: `Unsafe ${unsafeStorageKeyPathDestination}`,
            description: "A legacy collection with unsafe text.",
            language_tags: ["en"],
            cover_package_id: testPackageId,
            status: "published",
            updated_at: testTimestamp,
            published_at: testTimestamp,
          },
        ] as unknown as ReadonlyArray<Row>);
      }

      if (text.includes("FROM catalog.package_cards AS cards")) {
        assert.match(text, /versions\.status = 'published'/);
        assert.match(text, /packages\.status = 'published'/);
        return createQueryResult([
          {
            package_card_id: packageCardId,
            package_version_id: testPackageVersionId,
            ordinal: 1,
            front_text: "Hola ![cover](fcasset:cover)",
            back_text: "Hello [cover details](fcasset:cover)",
            card_type: "basic",
            tags: ["language", "spanish"],
            media_asset_keys: [],
          },
          {
            package_card_id: missingMediaPackageCardId,
            package_version_id: missingMediaPackageVersionId,
            ordinal: 1,
            front_text: `Hola ![diagram](fcasset:${missingPackageMediaKey})`,
            back_text: "Hello",
            card_type: "basic",
            tags: ["language", "spanish"],
            media_asset_keys: [],
          },
          {
            package_card_id: unsafeLatestPackageCardId,
            package_version_id: unsafeLatestPackageVersionId,
            ordinal: 1,
            front_text: `Unsafe ${unsafeStorageKeyPathDestination}`,
            back_text: "Answer",
            card_type: "basic",
            tags: [],
            media_asset_keys: [],
          },
          {
            package_card_id: unsafeOnlyPackageCardId,
            package_version_id: unsafeOnlyPackageVersionId,
            ordinal: 1,
            front_text: `Unsafe ${unsafeStorageKeyPathDestination}`,
            back_text: "Answer",
            card_type: "basic",
            tags: [],
            media_asset_keys: [],
          },
        ] as unknown as ReadonlyArray<Row>);
      }

      if (text.includes("FROM catalog.package_media_assets AS media_assets")) {
        assert.match(text, /versions\.status = 'published'/);
        assert.match(text, /packages\.status = 'published'/);
        assert.doesNotMatch(text, /media_blobs\.storage_key/);
        assert.doesNotMatch(text, /media_blobs\.sha256/);
        return createQueryResult([{
          package_media_asset_id: packageMediaAssetId,
          ...createPublicMediaAssetRow(),
        }] as unknown as ReadonlyArray<Row>);
      }

      if (text.includes("FROM catalog.package_versions AS versions")) {
        assert.match(text, /versions\.status = 'published'/);
        assert.match(text, /versions\.delisted_at IS NULL/);
        assert.match(text, /packages\.status = 'published'/);
        assert.match(text, /packages\.delisted_at IS NULL/);
        assert.doesNotMatch(text, /source_workspace_id|created_by_admin_email|media_blob_id|storage_key|sha256/);
        return createQueryResult(packageVersionRows as unknown as ReadonlyArray<Row>);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const snapshot = await loadPublicCatalogSnapshotInExecutor(executor, {
    publicApiBaseUrl,
    publicAppBaseUrl,
    generatedAt,
  });

  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.generatedAt, generatedAt);
  assert.deepEqual(snapshot.authors.map((author) => author.authorId), [testAuthorId, secondAuthorId]);
  assert.equal(
    snapshot.authors.find((author) => author.authorId === testAuthorId)?.websiteUrl,
    "https://[2001:db8::1]/authors",
  );
  const spanishPackage = snapshot.packages.find((catalogPackage) => catalogPackage.packageId === testPackageId);
  assert.equal(spanishPackage?.latestPackageVersionId, latestPackageVersionId);
  assert.equal(spanishPackage?.versionCount, 2);
  assert.equal(snapshot.packageVersions[0]?.coverMediaAssetId, packageMediaAssetId);
  assert.equal(snapshot.packageVersions[1]?.coverMediaAssetId, null);
  assert.deepEqual(snapshot.cards[0]?.mediaAssetIds, [packageMediaAssetId]);
  assert.equal(
    snapshot.mediaAssets[0]?.downloadUrl,
    `${publicApiBaseUrl}/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
  );
  assert.equal(snapshot.mediaAssets.length, 1);
  for (const packageVersion of snapshot.packageVersions) {
    assert.equal(
      packageVersion.installUrl,
      `${publicAppBaseUrl}/catalog/import/${packageVersion.packageVersionId}`,
    );
  }
  assert.deepEqual(snapshot.collectionPackages, [
    { collectionId: firstCollectionId, packageId: testPackageId, ordinal: 2 },
    { collectionId: secondCollectionId, packageId: secondPackageId, ordinal: 1 },
    { collectionId: secondCollectionId, packageId: testPackageId, ordinal: 3 },
  ]);
  assert.equal(snapshot.collections[0]?.coverPackageId, testPackageId);
  assert.equal(
    snapshot.collections[0]?.coverDownloadUrl,
    `${publicApiBaseUrl}/catalog/collections/${firstCollectionId}/cover/download`,
  );
  assert.equal(snapshot.collections[1]?.coverPackageId, null);
  assert.equal("coverDownloadUrl" in (snapshot.collections[1] ?? {}), false);

  const authorIds = new Set(snapshot.authors.map((author) => author.authorId));
  const packageIds = new Set(snapshot.packages.map((catalogPackage) => catalogPackage.packageId));
  const packageVersionIds = new Set(snapshot.packageVersions.map((version) => version.packageVersionId));
  const mediaAssetIds = new Set(snapshot.mediaAssets.map((mediaAsset) => mediaAsset.packageMediaAssetId));
  const collectionIds = new Set(snapshot.collections.map((collection) => collection.collectionId));
  for (const catalogPackage of snapshot.packages) {
    assert.equal(authorIds.has(catalogPackage.authorId), true);
    assert.equal(packageVersionIds.has(catalogPackage.latestPackageVersionId), true);
  }
  for (const packageVersion of snapshot.packageVersions) {
    assert.equal(packageIds.has(packageVersion.packageId), true);
    assert.equal(
      packageVersion.coverMediaAssetId === null || mediaAssetIds.has(packageVersion.coverMediaAssetId),
      true,
    );
  }
  for (const card of snapshot.cards) {
    assert.equal(packageVersionIds.has(card.packageVersionId), true);
    assert.equal(card.mediaAssetIds.every((mediaAssetId) => mediaAssetIds.has(mediaAssetId)), true);
  }
  for (const membership of snapshot.collectionPackages) {
    assert.equal(collectionIds.has(membership.collectionId), true);
    assert.equal(packageIds.has(membership.packageId), true);
  }
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(draftPackageId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(privateCoverMediaKey));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(missingMediaPackageVersionId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(missingMediaPackageCardId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(missingPackageMediaKey));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(unsafeLatestPackageVersionId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(unsafeLatestPackageCardId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(unsafeOnlyPackageId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(unsafeOnlyPackageVersionId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(unsafeOnlyPackageCardId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(unsafeCollectionId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(unsafeStorageKeyPathDestination));
  assert.doesNotMatch(JSON.stringify(snapshot), /cover_media_blob_id|storage_key|media\/blobs|sha256/);
});

const ineligibleSnapshotPublicRelationFixtures: ReadonlyArray<readonly [
  string,
  Readonly<Partial<{
    package_slug: string;
    author_display_name: string;
    author_bio: string | null;
    author_website_url: string | null;
  }>>,
]> = [
  ["unsafe package slug", { package_slug: "a".repeat(64) }],
  ["unsafe author presentation", { author_bio: `Unsafe ${unsafeStorageKeyPathDestination}` }],
  ["invalid author website URL", { author_website_url: "authors.example.test/profile" }],
  ["author website with invalid URI characters", {
    author_website_url: "https://authors.example.test/author profile",
  }],
  ["author website with malformed percent escaping", {
    author_website_url: "https://authors.example.test/%zz",
  }],
  ["author website with raw path brackets", {
    author_website_url: "https://authors.example.test/profile[1]",
  }],
  ["author website with raw query brackets", {
    author_website_url: "https://authors.example.test/profile?label=[primary]",
  }],
  ["author website with empty username syntax", {
    author_website_url: "https://@authors.example.test/profile",
  }],
  ["author website with empty username and password syntax", {
    author_website_url: "https://:@authors.example.test/profile",
  }],
  ["author website with an empty port", {
    author_website_url: "https://authors.example.test:/profile",
  }],
  ["author website with leading whitespace", {
    author_website_url: " https://authors.example.test/profile",
  }],
  ["author website without a raw authority", {
    author_website_url: "https:///authors.example.test/profile",
  }],
];

for (const [fixtureName, relationPatch] of ineligibleSnapshotPublicRelationFixtures) {
  test(`public catalog snapshot omits legacy packages with ${fixtureName}`, async () => {
    const collectionId = "55555555-1111-4111-8111-111111111111";
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        assert.deepEqual(params, []);
        if (text.includes("WHERE collections.cover_media_blob_id IS NOT NULL")) {
          return createQueryResult([]);
        }
        if (text.includes("FROM catalog.collection_packages AS memberships")) {
          return createQueryResult([{
            collection_id: collectionId,
            package_id: testPackageId,
            ordinal: 1,
          }] as unknown as ReadonlyArray<Row>);
        }
        if (text.includes("FROM catalog.collections AS collections")) {
          return createQueryResult([{
            collection_id: collectionId,
            slug: "language-starters",
            title: "Language Starters",
            summary: "Starter language packages.",
            description: "A curated starter collection.",
            language_tags: ["en"],
            cover_package_id: testPackageId,
            status: "published",
            updated_at: testTimestamp,
            published_at: testTimestamp,
          }] as unknown as ReadonlyArray<Row>);
        }
        if (text.includes("FROM catalog.package_cards AS cards")) {
          return createQueryResult([]);
        }
        if (text.includes("FROM catalog.package_media_assets AS media_assets")) {
          return createQueryResult([]);
        }
        if (text.includes("FROM catalog.package_versions AS versions")) {
          return createQueryResult([{
            ...createPublicPackageRow(),
            package_slug: "spanish-basics",
            package_published_at: testTimestamp,
            version_slug: "spanish-basics-v1",
            cover_package_media_key: null,
            card_count: 0,
            ...relationPatch,
          }] as unknown as ReadonlyArray<Row>);
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    };

    const snapshot = await loadPublicCatalogSnapshotInExecutor(executor, {
      publicApiBaseUrl: "https://api.example.test/v1",
      publicAppBaseUrl: "https://app.example.test",
      generatedAt: testTimestamp,
    });

    assert.deepEqual(snapshot.authors, []);
    assert.deepEqual(snapshot.packages, []);
    assert.deepEqual(snapshot.packageVersions, []);
    assert.deepEqual(snapshot.cards, []);
    assert.deepEqual(snapshot.mediaAssets, []);
    assert.deepEqual(snapshot.collectionPackages, []);
    assert.equal(snapshot.collections[0]?.coverPackageId, null);
  });
}

const ineligibleSnapshotMediaFixtures: ReadonlyArray<readonly [
  string,
  Readonly<{
    mediaPatch: Readonly<{ mime_type: string; size_bytes: string | number }> | null;
    frontText: string;
  }>,
]> = [
  ["unsupported MIME type", {
    mediaPatch: { mime_type: "text/plain", size_bytes: 1_234 },
    frontText: "Adiós ![cover](fcasset:cover)",
  }],
  [
    "oversized content",
    {
      mediaPatch: {
        mime_type: "image/jpeg",
        size_bytes: maximumPublicCatalogMediaDownloadBytes + 1,
      },
      frontText: "Adiós ![cover](fcasset:cover)",
    },
  ],
  ["out-of-range BIGINT media size", {
    mediaPatch: { mime_type: "image/jpeg", size_bytes: "9223372036854775807" },
    frontText: "Adiós ![cover](fcasset:cover)",
  }],
  ["Markdown complexity", {
    mediaPatch: null,
    frontText: "[".repeat(1_001),
  }],
];

for (const [fixtureName, ineligibleFixture] of ineligibleSnapshotMediaFixtures) {
  test(`public catalog snapshot excludes a legacy version with ${fixtureName} and selects the latest eligible version`, async () => {
    const ineligiblePackageVersionId = "99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const eligibleMediaAssetId = "99999999-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const ineligibleMediaAssetId = "99999999-cccc-4ccc-8ccc-cccccccccccc";
    const eligibleCardId = "99999999-dddd-4ddd-8ddd-dddddddddddd";
    const ineligibleCardId = "99999999-eeee-4eee-8eee-eeeeeeeeeeee";
    const collectionId = "99999999-ffff-4fff-8fff-ffffffffffff";
    const fullyIneligiblePackageId = "88888888-1111-4111-8111-111111111111";
    const fullyIneligiblePackageVersionId = "88888888-2222-4222-8222-222222222222";
    const fullyIneligibleMediaAssetId = "88888888-3333-4333-8333-333333333333";
    const fullyIneligibleCardId = "88888888-4444-4444-8444-444444444444";
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        assert.deepEqual(params, []);
        if (text.includes("WHERE collections.cover_media_blob_id IS NOT NULL")) {
          return createQueryResult([]);
        }
        if (text.includes("FROM catalog.collection_packages AS memberships")) {
          return createQueryResult([
            {
              collection_id: collectionId,
              package_id: testPackageId,
              ordinal: 1,
            },
            {
              collection_id: collectionId,
              package_id: fullyIneligiblePackageId,
              ordinal: 2,
            },
          ] as unknown as ReadonlyArray<Row>);
        }

        if (text.includes("FROM catalog.collections AS collections")) {
          return createQueryResult([{
            collection_id: collectionId,
            slug: "language-starters",
            title: "Language Starters",
            summary: "Starter language packages.",
            description: "A curated starter collection.",
            language_tags: ["en"],
            cover_package_id: testPackageId,
            status: "published",
            updated_at: testTimestamp,
            published_at: testTimestamp,
          }] as unknown as ReadonlyArray<Row>);
        }

        if (text.includes("FROM catalog.package_cards AS cards")) {
          return createQueryResult([
            {
              package_card_id: eligibleCardId,
              package_version_id: testPackageVersionId,
              ordinal: 1,
              front_text: "Hola ![cover](fcasset:cover)",
              back_text: "Hello",
              card_type: "basic",
              tags: ["language"],
              media_asset_keys: [],
            },
            {
              package_card_id: ineligibleCardId,
              package_version_id: ineligiblePackageVersionId,
              ordinal: 1,
              front_text: ineligibleFixture.frontText,
              back_text: "Goodbye",
              card_type: "basic",
              tags: ["language"],
              media_asset_keys: [],
            },
            {
              package_card_id: fullyIneligibleCardId,
              package_version_id: fullyIneligiblePackageVersionId,
              ordinal: 1,
              front_text: ineligibleFixture.frontText,
              back_text: "Goodbye",
              card_type: "basic",
              tags: ["language"],
              media_asset_keys: [],
            },
          ] as unknown as ReadonlyArray<Row>);
        }

        if (text.includes("FROM catalog.package_media_assets AS media_assets")) {
          const ineligibleMediaRows = ineligibleFixture.mediaPatch === null
            ? []
            : [
              {
                package_media_asset_id: ineligibleMediaAssetId,
                ...createPublicMediaAssetRow(),
                package_version_id: ineligiblePackageVersionId,
                ...ineligibleFixture.mediaPatch,
              },
              {
                package_media_asset_id: fullyIneligibleMediaAssetId,
                ...createPublicMediaAssetRow(),
                package_version_id: fullyIneligiblePackageVersionId,
                ...ineligibleFixture.mediaPatch,
              },
            ];
          return createQueryResult([
            {
              package_media_asset_id: eligibleMediaAssetId,
              ...createPublicMediaAssetRow(),
            },
            ...ineligibleMediaRows,
          ] as unknown as ReadonlyArray<Row>);
        }

        if (text.includes("FROM catalog.package_versions AS versions")) {
          return createQueryResult([
            {
              ...createPublicPackageRow(),
              package_slug: "spanish-basics",
              package_published_at: testTimestamp,
              version_slug: "spanish-basics-v1",
            },
            {
              ...createPublicPackageRow(),
              package_version_id: ineligiblePackageVersionId,
              version_number: 2,
              package_slug: "spanish-basics",
              package_published_at: testTimestamp,
              version_slug: "spanish-basics-v2",
              title: "Spanish Basics, second edition",
              cover_package_media_key: ineligibleFixture.mediaPatch === null ? null : "cover",
            },
            {
              ...createPublicPackageRow(),
              package_id: fullyIneligiblePackageId,
              package_version_id: fullyIneligiblePackageVersionId,
              package_slug: "ineligible-package",
              slug: "ineligible-package-v1",
              package_published_at: testTimestamp,
              version_slug: "ineligible-package-v1",
              title: "Ineligible package",
              cover_package_media_key: ineligibleFixture.mediaPatch === null ? null : "cover",
            },
          ] as unknown as ReadonlyArray<Row>);
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    };

    const snapshot = await loadPublicCatalogSnapshotInExecutor(executor, {
      publicApiBaseUrl: "https://api.example.com/v1",
      publicAppBaseUrl: "https://app.example.com",
      generatedAt: testTimestamp,
    });

    assert.deepEqual(
      snapshot.packageVersions.map((version) => version.packageVersionId),
      [testPackageVersionId],
    );
    assert.equal(snapshot.packages[0]?.latestPackageVersionId, testPackageVersionId);
    assert.equal(snapshot.packages[0]?.versionCount, 1);
    assert.deepEqual(snapshot.cards.map((card) => card.packageCardId), [eligibleCardId]);
    assert.deepEqual(snapshot.cards[0]?.mediaAssetIds, [eligibleMediaAssetId]);
    assert.deepEqual(
      snapshot.mediaAssets.map((mediaAsset) => mediaAsset.packageMediaAssetId),
      [eligibleMediaAssetId],
    );
    assert.deepEqual(snapshot.collectionPackages, [{
      collectionId,
      packageId: testPackageId,
      ordinal: 1,
    }]);
    const snapshotJson = JSON.stringify(snapshot);
    assert.doesNotMatch(snapshotJson, new RegExp(ineligiblePackageVersionId));
    assert.doesNotMatch(snapshotJson, new RegExp(ineligibleMediaAssetId));
    assert.doesNotMatch(snapshotJson, new RegExp(ineligibleCardId));
    assert.doesNotMatch(snapshotJson, new RegExp(fullyIneligiblePackageId));
    assert.doesNotMatch(snapshotJson, new RegExp(fullyIneligiblePackageVersionId));
    assert.doesNotMatch(snapshotJson, new RegExp(fullyIneligibleMediaAssetId));
    assert.doesNotMatch(snapshotJson, new RegExp(fullyIneligibleCardId));
  });
}

test("public catalog snapshot route serves the exact unversioned catalog path", async () => {
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogSnapshotFn: async (publicApiBaseUrl, publicAppBaseUrl) => {
      assert.equal(publicApiBaseUrl, "https://api.example.com/v1");
      assert.equal(publicAppBaseUrl, "https://app.example.com");
      return {
        schemaVersion: 2,
        generatedAt: testTimestamp,
        authors: [],
        packages: [],
        packageVersions: [],
        cards: [],
        mediaAssets: [],
        collections: [],
        collectionPackages: [],
      };
    },
  }));

  const originalPublicAppBaseUrl = process.env.PUBLIC_APP_BASE_URL;
  const originalPublicApiBaseUrl = process.env.PUBLIC_API_BASE_URL;
  process.env.PUBLIC_APP_BASE_URL = "https://app.example.com";
  process.env.PUBLIC_API_BASE_URL = "https://api.example.com/v1";
  try {
    const response = await app.request("https://api.example.com/catalog");
    const payload = await response.json() as Readonly<Record<string, unknown>>;
    assert.equal(response.status, 200);
    assert.equal(payload.schemaVersion, 2);
  } finally {
    if (originalPublicAppBaseUrl === undefined) {
      delete process.env.PUBLIC_APP_BASE_URL;
    } else {
      process.env.PUBLIC_APP_BASE_URL = originalPublicAppBaseUrl;
    }
    if (originalPublicApiBaseUrl === undefined) {
      delete process.env.PUBLIC_API_BASE_URL;
    } else {
      process.env.PUBLIC_API_BASE_URL = originalPublicApiBaseUrl;
    }
  }
});
