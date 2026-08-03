import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { createCatalogPublicRoutes } from "../../routes/catalogPublic";
import type { AppEnv } from "../../server/app";
import { HttpError } from "../../shared/errors";
import { maximumPublicCatalogMediaDownloadBytes } from "../publicMediaDelivery";
import {
  listPublicCatalogPackagesInExecutor,
  loadPublicCatalogSnapshotInExecutor,
  loadPublicCatalogPackageDetailInExecutor,
  loadPublicCatalogPackageMediaForDownloadInExecutor,
  loadPublicCatalogPackageVersionCardPreviewInExecutor,
} from "./public";
import {
  assertPublicPayloadDoesNotContainUnsafeMediaReferences,
  createQueryResult,
  testAuthorId,
  testPackageId,
  testPackageVersionId,
  testTimestamp,
  testWorkspaceMediaAssetId,
} from "../testSupport";
import type { CatalogPublicPackageMediaDownloadSource } from "../types";

const legacyPrivateWorkspacePackageMediaKey = `w-${testWorkspaceMediaAssetId}`;
const unsafeShaPackageMediaKey = "a".repeat(64);
const unsafeStorageKeyLikePackageMediaKey = `media.blobs.sha256.aa.aa.${unsafeShaPackageMediaKey}`;
const unsafeStorageKeyPathDestination = `media/blobs/sha256/aa/aa/${unsafeShaPackageMediaKey}`;
const unsafeDoubleEncodedStorageKeyPathDestination = encodeURIComponent(encodeURIComponent(
  unsafeStorageKeyPathDestination,
));

function createPublicCatalogRouteTestApp(route: Hono<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    context.set("clientAppVersion", null);
    context.set("clientPlatform", null);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({ error: error.message, code: error.code });
    }

    context.status(500);
    return context.json({ error: "internal" });
  });
  app.route("/", route);
  return app;
}

const unsafePublicPackageMediaKeyFixtures = [
  ["legacy workspace-derived", legacyPrivateWorkspacePackageMediaKey],
  ["uuid-shaped", testWorkspaceMediaAssetId],
  ["sha-shaped", unsafeShaPackageMediaKey],
  ["storage-key-shaped", unsafeStorageKeyLikePackageMediaKey],
] as const;
const unsafeMarkdownDestinationFixtures = [
  ["malformed fcasset storage path", `fcasset:${unsafeStorageKeyPathDestination}`],
  ["storage path", unsafeStorageKeyPathDestination],
  ["rooted storage path", `/${unsafeStorageKeyPathDestination}`],
  ["absolute storage URL", `https://bucket.s3.amazonaws.com/${unsafeStorageKeyPathDestination}`],
  ["storage path with query", `${unsafeStorageKeyPathDestination}?download=1`],
  ["storage path with fragment", `${unsafeStorageKeyPathDestination}#preview`],
  ["percent-encoded storage path", `media%2Fblobs%2Fsha256%2Faa%2Faa%2F${unsafeShaPackageMediaKey}`],
  ["double-encoded storage path", unsafeDoubleEncodedStorageKeyPathDestination],
  ["double-encoded absolute storage URL", `https://bucket.s3.amazonaws.com/${unsafeDoubleEncodedStorageKeyPathDestination}`],
  ["sha handle path", `sha256-${unsafeShaPackageMediaKey}`],
] as const;
const unsafeMarkdownVisibleTextFixtures = [
  ["raw storage path", `Prompt ${unsafeStorageKeyPathDestination}`],
  ["raw sha handle", `Prompt sha256-${unsafeShaPackageMediaKey}`],
  ["raw unsafe fcasset reference", `Prompt fcasset:${legacyPrivateWorkspacePackageMediaKey}`],
  ["storage autolink", `Prompt <https://bucket.s3.amazonaws.com/${unsafeStorageKeyPathDestination}>`],
  ["malformed storage link tail", `Prompt ![unsafe](${unsafeStorageKeyPathDestination}`],
  ["malformed fcasset link tail", `Prompt [unsafe](fcasset:${legacyPrivateWorkspacePackageMediaKey}`],
  ["raw percent-encoded storage path", `Prompt media%2Fblobs%2Fsha256%2Faa%2Faa%2F${unsafeShaPackageMediaKey}`],
] as const;
const unsafePublicMetadataFixtures = [
  ["summary storage path", { summary: `Summary ${unsafeStorageKeyPathDestination}` }],
  ["description raw hash", { description: `Description ${unsafeShaPackageMediaKey}` }],
  ["language tag private fcasset", { language_tags: ["en", `fcasset:${legacyPrivateWorkspacePackageMediaKey}`] }],
  ["topic tag storage path", { topic_tags: ["language", unsafeStorageKeyPathDestination] }],
  ["license raw hash", { license: `License ${unsafeShaPackageMediaKey}` }],
  ["author bio private fcasset", { author_bio: `Bio fcasset:${legacyPrivateWorkspacePackageMediaKey}` }],
  ["author website storage path", { author_website_url: `https://example.com/${unsafeStorageKeyPathDestination}` }],
] as const;
const unsafePublicMediaMetadataFixtures = [
  ["media alt text storage path", { alt_text: `Alt ${unsafeStorageKeyPathDestination}` }],
  ["media credit raw hash", { credit: `Credit ${unsafeShaPackageMediaKey}` }],
  ["media license private fcasset", { license: `fcasset:${legacyPrivateWorkspacePackageMediaKey}` }],
] as const;

function createPublicPackageRow(): Readonly<Record<string, unknown>> {
  return {
    package_id: testPackageId,
    author_id: testAuthorId,
    author_slug: "open-authors",
    author_display_name: "Open Authors",
    author_bio: null,
    author_website_url: "https://[2001:db8::1]/authors",
    package_version_id: testPackageVersionId,
    version_number: 1,
    status: "published",
    slug: "spanish-basics",
    title: "Spanish Basics",
    summary: "Core Spanish prompts.",
    description: "Core Spanish flashcards for beginners.",
    language_tags: ["en", "es"],
    topic_tags: ["language"],
    license: "CC-BY-4.0",
    content_warning: null,
    cover_package_media_key: "cover",
    card_count: 1,
    updated_at: testTimestamp,
    published_at: testTimestamp,
  };
}

function createPublicMediaAssetRow(): Readonly<Record<string, unknown>> {
  return {
    package_version_id: testPackageVersionId,
    package_media_key: "cover",
    alt_text: "Cover image",
    credit: null,
    license: "CC-BY-4.0",
    mime_type: "image/jpeg",
    size_bytes: 1234,
    sha256: unsafeShaPackageMediaKey,
  };
}

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
            topic_tags: ["language"],
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
            topic_tags: ["language"],
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
            topic_tags: ["language"],
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

  assert.equal(snapshot.schemaVersion, 1);
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
  assert.equal(snapshot.collections[1]?.coverPackageId, null);

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
            topic_tags: ["language"],
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
            topic_tags: ["language"],
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
        schemaVersion: 1,
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
    assert.equal(payload.schemaVersion, 1);
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

test("public catalog list reads only published, non-delisted package snapshots", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      assert.match(text, /FROM catalog\.package_versions/);
      assert.match(text, /WHERE status = 'published'/);
      assert.match(text, /AND delisted_at IS NULL/);
      assert.match(text, /packages\.status = 'published'/);
      assert.match(text, /packages\.delisted_at IS NULL/);
      assert.match(text, /packages\.slug AS slug/);
      assert.match(text, /lower\(packages\.slug\)/);
      assert.doesNotMatch(text, /versions\.slug AS slug/);
      assert.doesNotMatch(text, /lower\(versions\.slug\)/);
      assert.doesNotMatch(text, /\bmedia_blob_id\b/);
      assert.doesNotMatch(text, /\bstorage_key\b/);
      assert.doesNotMatch(text, /\bsha256\b/);
      assert.deepEqual(params, ["%spanish%", "es", "language", 10]);
      return createQueryResult([createPublicPackageRow() as unknown as Row]);
    },
  };

  const catalogPackages = await listPublicCatalogPackagesInExecutor(executor, {
    limit: 10,
    search: "Spanish",
    languageTag: "ES",
    topicTag: "Language",
  });

  assert.equal(catalogPackages.length, 1);
  assert.equal(catalogPackages[0]?.status, "published");
  assert.equal(catalogPackages[0]?.latestVersion.status, "published");
  assert.equal(catalogPackages[0]?.latestVersion.packageVersionId, testPackageVersionId);
  assert.doesNotMatch(JSON.stringify(catalogPackages), /mediaBlobId|storageKey|sha256|createdByAdminEmail|sourceWorkspaceId/);
});

test("legacy catalog list and detail preserve existing author website presentation", async () => {
  const legacyAuthorWebsiteUrl = "authors.example.test/profile";
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("FROM catalog.package_media_assets")) {
        assert.deepEqual(params, [testPackageVersionId]);
        return createQueryResult([]);
      }

      if (text.includes("packages.slug = $1")) {
        assert.deepEqual(params, ["spanish-basics"]);
      } else {
        assert.deepEqual(params, [1]);
      }
      return createQueryResult([{
        ...createPublicPackageRow(),
        author_website_url: legacyAuthorWebsiteUrl,
      } as unknown as Row]);
    },
  };

  const catalogPackages = await listPublicCatalogPackagesInExecutor(executor, {
    limit: 1,
    search: null,
    languageTag: null,
    topicTag: null,
  });
  const catalogPackage = await loadPublicCatalogPackageDetailInExecutor(
    executor,
    "spanish-basics",
  );

  assert.equal(catalogPackages[0]?.author.websiteUrl, legacyAuthorWebsiteUrl);
  assert.equal(catalogPackage.author.websiteUrl, legacyAuthorWebsiteUrl);
});

for (const [unsafeMetadataLabel, unsafeMetadataPatch] of unsafePublicMetadataFixtures) {
  test(`public catalog list rejects ${unsafeMetadataLabel} before response`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        _text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        assert.deepEqual(params, [1]);
        return createQueryResult([{
          ...createPublicPackageRow(),
          ...unsafeMetadataPatch,
        } as unknown as Row]);
      },
    };

    await assert.rejects(
      listPublicCatalogPackagesInExecutor(executor, {
        limit: 1,
        search: null,
        languageTag: null,
        topicTag: null,
      }),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
        assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
        return true;
      },
    );
  });
}

for (const [unsafeKeyLabel, unsafePackageMediaKey] of unsafePublicPackageMediaKeyFixtures) {
  test(`public catalog list rejects ${unsafeKeyLabel} cover media keys before response`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        _text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        assert.deepEqual(params, [1]);
        return createQueryResult([{
          ...createPublicPackageRow(),
          cover_package_media_key: unsafePackageMediaKey,
        } as unknown as Row]);
      },
    };

    await assert.rejects(
      listPublicCatalogPackagesInExecutor(executor, {
        limit: 1,
        search: null,
        languageTag: null,
        topicTag: null,
      }),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
        assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
        return true;
      },
    );
  });
}

test("public catalog detail resolves by package slug and excludes unpublished or delisted snapshots", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      assert.match(text, /packages\.slug = \$1/);
      assert.doesNotMatch(text, /versions\.slug = \$1/);
      assert.match(text, /packages\.status = 'published'/);
      assert.match(text, /packages\.delisted_at IS NULL/);
      assert.deepEqual(params, ["spanish-basics"]);
      return createQueryResult([]);
    },
  };

  await assert.rejects(
    loadPublicCatalogPackageDetailInExecutor(executor, "spanish-basics"),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 404);
      assert.equal((error as HttpError).code, "CATALOG_PUBLIC_PACKAGE_NOT_FOUND");
      return true;
    },
  );
});

for (const [unsafeMetadataLabel, unsafeMetadataPatch] of unsafePublicMetadataFixtures) {
  test(`public catalog detail rejects ${unsafeMetadataLabel} before response`, async () => {
    let mediaAssetQueryCount = 0;
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        if (text.includes("FROM catalog.package_media_assets")) {
          mediaAssetQueryCount += 1;
          throw new Error("Unsafe public package metadata should be rejected before media asset lookup");
        }

        assert.match(text, /packages\.slug = \$1/);
        assert.deepEqual(params, ["spanish-basics"]);
        return createQueryResult([{
          ...createPublicPackageRow(),
          ...unsafeMetadataPatch,
        } as unknown as Row]);
      },
    };

    await assert.rejects(
      loadPublicCatalogPackageDetailInExecutor(executor, "spanish-basics"),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
        assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
        return true;
      },
    );
    assert.equal(mediaAssetQueryCount, 0);
  });
}

for (const [unsafeMediaMetadataLabel, unsafeMediaMetadataPatch] of unsafePublicMediaMetadataFixtures) {
  test(`public catalog detail rejects ${unsafeMediaMetadataLabel} before response`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        if (text.includes("FROM catalog.package_media_assets")) {
          assert.deepEqual(params, [testPackageVersionId]);
          return createQueryResult([{
            ...createPublicMediaAssetRow(),
            ...unsafeMediaMetadataPatch,
          } as unknown as Row]);
        }

        assert.match(text, /packages\.slug = \$1/);
        assert.deepEqual(params, ["spanish-basics"]);
        return createQueryResult([createPublicPackageRow() as unknown as Row]);
      },
    };

    await assert.rejects(
      loadPublicCatalogPackageDetailInExecutor(executor, "spanish-basics"),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
        assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
        return true;
      },
    );
  });
}

test("public catalog card previews omit source card identifiers", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);

      if (text.includes("FROM catalog.package_versions AS versions")) {
        assert.match(text, /versions\.status = 'published'/);
        assert.match(text, /packages\.status = 'published'/);
        assert.deepEqual(params, [testPackageVersionId]);
        return createQueryResult([{ package_version_id: testPackageVersionId } as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_cards")) {
        assert.doesNotMatch(text, /\bpackage_card_id\b/);
        assert.doesNotMatch(text, /\bstable_card_key\b/);
        assert.deepEqual(params, [testPackageVersionId, 5]);
        return createQueryResult([{
          ordinal: 1,
          front_text: "Hola [guide](https://example.com/cards/guide)",
          back_text: "Hello",
          card_type: "basic",
          tags: ["language"],
          media_asset_keys: ["cover"],
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const cards = await loadPublicCatalogPackageVersionCardPreviewInExecutor(executor, {
    packageVersionId: testPackageVersionId,
    limit: 5,
  });

  assert.deepEqual(cards, [
    {
      ordinal: 1,
      frontText: "Hola [guide](https://example.com/cards/guide)",
      backText: "Hello",
      cardType: "basic",
      tags: ["language"],
      mediaAssetKeys: ["cover"],
    },
  ]);
  assert.equal(queries.length, 2);
  assert.doesNotMatch(JSON.stringify(cards), /packageCardId|stableCardKey/);
});

for (const [unsafeKeyLabel, unsafePackageMediaKey] of unsafePublicPackageMediaKeyFixtures) {
  test(`public catalog card previews reject ${unsafeKeyLabel} media keys before response`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        if (text.includes("FROM catalog.package_versions AS versions")) {
          assert.deepEqual(params, [testPackageVersionId]);
          return createQueryResult([{ package_version_id: testPackageVersionId } as unknown as Row]);
        }

        if (text.includes("FROM catalog.package_cards")) {
          assert.deepEqual(params, [testPackageVersionId, 5]);
          return createQueryResult([{
            ordinal: 1,
            front_text: `Prompt ![diagram](fcasset:${unsafePackageMediaKey})`,
            back_text: "Answer",
            card_type: "basic",
            tags: [],
            media_asset_keys: [unsafePackageMediaKey],
          } as unknown as Row]);
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    };

    await assert.rejects(
      loadPublicCatalogPackageVersionCardPreviewInExecutor(executor, {
        packageVersionId: testPackageVersionId,
        limit: 5,
      }),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
        assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
        return true;
      },
    );
  });
}

test("public catalog card previews reject unsafe card types before response", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("FROM catalog.package_versions AS versions")) {
        assert.deepEqual(params, [testPackageVersionId]);
        return createQueryResult([{ package_version_id: testPackageVersionId } as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_cards")) {
        assert.deepEqual(params, [testPackageVersionId, 5]);
        return createQueryResult([{
          ordinal: 1,
          front_text: "Prompt",
          back_text: "Answer",
          card_type: `type ${unsafeStorageKeyPathDestination}`,
          tags: [],
          media_asset_keys: ["cover"],
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    loadPublicCatalogPackageVersionCardPreviewInExecutor(executor, {
      packageVersionId: testPackageVersionId,
      limit: 5,
    }),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
      assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
      return true;
    },
  );
});

for (const [unsafeDestinationLabel, unsafeDestination] of unsafeMarkdownDestinationFixtures) {
  test(`public catalog card previews reject ${unsafeDestinationLabel} markdown destinations before response`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        if (text.includes("FROM catalog.package_versions AS versions")) {
          assert.deepEqual(params, [testPackageVersionId]);
          return createQueryResult([{ package_version_id: testPackageVersionId } as unknown as Row]);
        }

        if (text.includes("FROM catalog.package_cards")) {
          assert.deepEqual(params, [testPackageVersionId, 5]);
          return createQueryResult([{
            ordinal: 1,
            front_text: `Prompt ![unsafe](${unsafeDestination})`,
            back_text: "Answer",
            card_type: "basic",
            tags: [],
            media_asset_keys: ["cover"],
          } as unknown as Row]);
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    };

    await assert.rejects(
      loadPublicCatalogPackageVersionCardPreviewInExecutor(executor, {
        packageVersionId: testPackageVersionId,
        limit: 5,
      }),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
        assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
        return true;
      },
    );
  });
}

for (const [unsafeTextLabel, unsafeText] of unsafeMarkdownVisibleTextFixtures) {
  test(`public catalog card previews reject ${unsafeTextLabel} in visible markdown before response`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        text: string,
        params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        if (text.includes("FROM catalog.package_versions AS versions")) {
          assert.deepEqual(params, [testPackageVersionId]);
          return createQueryResult([{ package_version_id: testPackageVersionId } as unknown as Row]);
        }

        if (text.includes("FROM catalog.package_cards")) {
          assert.deepEqual(params, [testPackageVersionId, 5]);
          return createQueryResult([{
            ordinal: 1,
            front_text: unsafeText,
            back_text: "Answer",
            card_type: "basic",
            tags: [],
            media_asset_keys: ["cover"],
          } as unknown as Row]);
        }

        throw new Error(`Unexpected query: ${text}`);
      },
    };

    await assert.rejects(
      loadPublicCatalogPackageVersionCardPreviewInExecutor(executor, {
        packageVersionId: testPackageVersionId,
        limit: 5,
      }),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
        assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
        return true;
      },
    );
  });
}

test("public catalog media download lookup authorizes by package media key and keeps storage internal", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      assert.match(text, /media_assets\.package_version_id = \$1/);
      assert.match(text, /media_assets\.package_media_key = \$2/);
      assert.match(text, /versions\.status = 'published'/);
      assert.match(text, /packages\.status = 'published'/);
      assert.match(text, /media_blobs\.sha256 AS sha256/);
      assert.deepEqual(params, [testPackageVersionId, "cover"]);
      return createQueryResult([{
        ...createPublicMediaAssetRow(),
        storage_key: realisticBlobStorageKey,
        sha256: realisticBlobSha256,
      } as unknown as Row]);
    },
  };

  const mediaDownloadSource = await loadPublicCatalogPackageMediaForDownloadInExecutor(
    executor,
    testPackageVersionId,
    "cover",
  );

  assert.equal(mediaDownloadSource.storageKey, realisticBlobStorageKey);
  assert.equal(mediaDownloadSource.sha256, realisticBlobSha256);
  assert.deepEqual(mediaDownloadSource.mediaAsset, {
    packageVersionId: testPackageVersionId,
    packageMediaKey: "cover",
    altText: "Cover image",
    credit: null,
    license: "CC-BY-4.0",
    mimeType: "image/jpeg",
    sizeBytes: 1234,
    downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
  });
  assert.doesNotMatch(JSON.stringify(mediaDownloadSource.mediaAsset), /mediaBlobId|storageKey|storage_key|sha256/);
});

for (const [unsafeKeyLabel, unsafePackageMediaKey] of unsafePublicPackageMediaKeyFixtures) {
  test(`public catalog media download lookup rejects ${unsafeKeyLabel} media keys before query`, async () => {
    let queryCount = 0;
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        _text: string,
        _params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        queryCount += 1;
        throw new Error("Unsafe public package media keys should be rejected before query");
      },
    };

    await assert.rejects(
      loadPublicCatalogPackageMediaForDownloadInExecutor(
        executor,
        testPackageVersionId,
        unsafePackageMediaKey,
      ),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
        assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
        return true;
      },
    );
    assert.equal(queryCount, 0);
  });
}

test("public catalog media download URL route returns only a backend API URL without storage internals", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  const oldLeakySignedS3Url = `https://media-bucket.s3.amazonaws.com/${realisticBlobStorageKey}?X-Amz-Signature=abc`;
  let requestedPackageMediaKey: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 1234,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      assert.equal(packageVersionId, testPackageVersionId);
      requestedPackageMediaKey = packageMediaKey;
      return mediaDownloadSource;
    },
  }));

  const response = await app.request(
    `http://localhost:8080/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
  );
  const payload = await response.json() as Readonly<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(requestedPackageMediaKey, "cover");
  const payloadJson = JSON.stringify(payload);
  assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId|sha256/);
  assert.doesNotMatch(payloadJson, new RegExp(realisticBlobSha256));
  assert.doesNotMatch(payloadJson, new RegExp(oldLeakySignedS3Url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(payload, {
    mediaAsset: mediaDownloadSource.mediaAsset,
    download: {
      method: "GET",
      url: `http://localhost:8080/v1/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
      expiresAt: null,
      rangeRequests: false,
    },
  });
});

test("public catalog media routes reject unsafe media keys without echoing private values", async () => {
  let lookupCount = 0;
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async () => {
      lookupCount += 1;
      throw new Error("Private workspace-derived package media keys should be rejected before lookup");
    },
  }));

  for (const [, unsafePackageMediaKey] of unsafePublicPackageMediaKeyFixtures) {
    for (const routeSuffix of ["download-url", "download"]) {
      const response = await app.request(
        `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/${unsafePackageMediaKey}/${routeSuffix}`,
      );
      const payload = await response.json() as Readonly<Record<string, unknown>>;

      assert.equal(response.status, 400);
      assert.equal(payload.code, "CATALOG_PUBLIC_PARAM_INVALID");
      assertPublicPayloadDoesNotContainUnsafeMediaReferences(payload);
    }
  }
  assert.equal(lookupCount, 0);
});

test("public catalog media download route serves bytes through the backend", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  let loadedStorageKey: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "cover");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async (input) => {
      loadedStorageKey = input.storageKey;
      assert.equal(input.workspaceId, testPackageVersionId);
      assert.equal(input.mediaAssetId, "cover");
      assert.equal(input.mimeType, "image/jpeg");
      assert.equal(input.sizeBytes, 3);
      assert.equal(input.sha256, realisticBlobSha256);
      return {
        bytes: Buffer.from([1, 2, 3]),
        mimeType: "image/jpeg",
        sizeBytes: 3,
        sha256: realisticBlobSha256,
      };
    },
  }));

  const response = await app.request(
    `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
  );

  assert.equal(response.status, 200);
  assert.equal(loadedStorageKey, realisticBlobStorageKey);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("content-length"), "3");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([1, 2, 3]));
});

test("public catalog media download route serves supported non-image bytes through the backend", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  let loadedMimeType: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "guide",
      altText: "PDF guide",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "application/pdf",
      sizeBytes: 4,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/guide/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "guide");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async (input) => {
      loadedMimeType = input.mimeType;
      assert.equal(input.sha256, realisticBlobSha256);
      return {
        bytes: Buffer.from([0x25, 0x50, 0x44, 0x46]),
        mimeType: "application/pdf",
        sizeBytes: 4,
        sha256: realisticBlobSha256,
      };
    },
  }));

  const response = await app.request(
    `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/guide/download`,
  );

  assert.equal(response.status, 200);
  assert.equal(loadedMimeType, "application/pdf");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0x25, 0x50, 0x44, 0x46]));
});

test("public catalog media routes reject unsupported MIME types before download", async () => {
  const realisticBlobStorageKey = "media/blobs/sha256/aa/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let lookupCount = 0;
  let bytesLoaded = false;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "notes",
      altText: "Notes",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "text/plain",
      sizeBytes: 4,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/notes/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: "a".repeat(64),
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      lookupCount += 1;
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "notes");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async () => {
      bytesLoaded = true;
      throw new Error("Unsupported public catalog media should fail before object byte load");
    },
  }));

  for (const routeSuffix of ["download-url", "download"]) {
    const response = await app.request(
      `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/notes/${routeSuffix}`,
    );
    const payload = await response.json() as Readonly<Record<string, unknown>>;
    const payloadJson = JSON.stringify(payload);

    assert.equal(response.status, 415);
    assert.equal(payload.code, "CATALOG_PUBLIC_MEDIA_DOWNLOAD_UNSUPPORTED_TYPE");
    assert.match(String(payload.error), /mimeType=text\/plain/);
    assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId|sha256/);
  }
  assert.equal(lookupCount, 2);
  assert.equal(bytesLoaded, false);
});

test("public catalog media download route rejects hash mismatches without exposing hashes", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  let receivedSha256: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async () => mediaDownloadSource,
    loadMediaAssetObjectBytesFn: async (input) => {
      receivedSha256 = input.sha256;
      throw new HttpError(
        409,
        "Media asset object bytes do not match expected metadata workspaceId=public mediaAssetId=cover mismatchedFields=sha256",
        "MEDIA_ASSET_OBJECT_BYTES_MISMATCH",
      );
    },
  }));

  const response = await app.request(
    `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
  );
  const payload = await response.json() as Readonly<Record<string, unknown>>;
  const payloadJson = JSON.stringify(payload);

  assert.equal(response.status, 409);
  assert.equal(receivedSha256, realisticBlobSha256);
  assert.equal(payload.code, "MEDIA_ASSET_OBJECT_BYTES_MISMATCH");
  assert.doesNotMatch(payloadJson, new RegExp(realisticBlobSha256));
  assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId/);
});

test("public catalog media routes reject objects too large for backend proxy delivery", async () => {
  const realisticBlobStorageKey = "media/blobs/sha256/aa/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let lookupCount = 0;
  let bytesLoaded = false;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 4_500_001,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: "a".repeat(64),
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      lookupCount += 1;
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "cover");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async () => {
      bytesLoaded = true;
      throw new Error("Oversized public catalog media should fail before object byte load");
    },
  }));

  for (const routeSuffix of ["download-url", "download"]) {
    const response = await app.request(
      `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/cover/${routeSuffix}`,
    );
    const payload = await response.json() as Readonly<Record<string, unknown>>;
    const payloadJson = JSON.stringify(payload);

    assert.equal(response.status, 413);
    assert.equal(payload.code, "CATALOG_PUBLIC_MEDIA_DOWNLOAD_TOO_LARGE");
    assert.match(String(payload.error), /maxBytes=4500000/);
    assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId|sha256/);
  }
  assert.equal(lookupCount, 2);
  assert.equal(bytesLoaded, false);
});
