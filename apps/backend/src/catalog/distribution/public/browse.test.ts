import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { HttpError } from "../../../shared/errors";
import {
  listPublicCatalogPackagesInExecutor,
  loadPublicCatalogPackageDetailInExecutor,
  loadPublicCatalogPackageVersionCardPreviewInExecutor,
} from "./index";
import {
  assertPublicPayloadDoesNotContainUnsafeMediaReferences,
  createQueryResult,
  testPackageVersionId,
} from "../../testSupport";
import {
  createPublicMediaAssetRow,
  createPublicPackageRow,
  unsafeMarkdownDestinationFixtures,
  unsafeMarkdownVisibleTextFixtures,
  unsafePublicMediaMetadataFixtures,
  unsafePublicMetadataFixtures,
  unsafePublicPackageMediaKeyFixtures,
  unsafeStorageKeyPathDestination,
} from "./testSupport";

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

