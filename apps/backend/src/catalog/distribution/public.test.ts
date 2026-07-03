import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { createCatalogPublicRoutes } from "../../routes/catalogPublic";
import type { AppEnv } from "../../server/app";
import { HttpError } from "../../shared/errors";
import {
  listPublicCatalogPackagesInExecutor,
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
    author_website_url: "https://example.com",
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
