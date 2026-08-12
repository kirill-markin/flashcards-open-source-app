import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { HttpError } from "../../shared/errors";
import {
  createQueryResult,
  testAuthorId,
  testMediaBlobId,
  testPackageId,
  testPackageMediaAssetId,
  testPackageMediaKey,
  testTimestamp,
} from "../testSupport";
import type {
  CatalogAuthorRow,
  CatalogPackageMediaAssetRow,
  CreateCatalogPackageDraftInput,
  UpdateCatalogPackageDraftInput,
} from "../types";
import {
  createPackageRow,
  unsafePublicCatalogStorageReference,
} from "./authoringTestSupport";
import { createCatalogAuthorInExecutor, updateCatalogAuthorInExecutor } from "./authors";
import {
  attachCatalogPackageDraftMediaAssetInExecutor,
  createOrReplayCatalogPackageDraftCardImageInExecutor,
  replaceCatalogPackageDraftCoverInExecutor,
} from "./media/draftMedia";
import { createCatalogPackageDraftInExecutor, updateCatalogPackageDraftInExecutor } from "./drafts";

function createAuthorRow(websiteUrl: string | null): CatalogAuthorRow {
  return {
    author_id: testAuthorId,
    slug: "open-authors",
    display_name: "Open Authors",
    bio: "Community-maintained study material.",
    website_url: websiteUrl,
    created_at: testTimestamp,
    updated_at: testTimestamp,
  };
}

const ineligibleAuthorWriteFixtures: ReadonlyArray<Readonly<{
  label: string;
  operation: "create" | "update";
  patch: Readonly<Partial<{
    displayName: string;
    bio: string | null;
    websiteUrl: string | null;
  }>>;
}>> = [
  {
    label: "private display name content",
    operation: "create",
    patch: { displayName: unsafePublicCatalogStorageReference },
  },
  {
    label: "private bio content",
    operation: "update",
    patch: { bio: unsafePublicCatalogStorageReference },
  },
  {
    label: "private website content",
    operation: "create",
    patch: { websiteUrl: `https://example.test/${unsafePublicCatalogStorageReference}` },
  },
  {
    label: "relative website URL",
    operation: "update",
    patch: { websiteUrl: "example.test/authors" },
  },
  {
    label: "non-HTTP website URL",
    operation: "create",
    patch: { websiteUrl: "ftp://example.test/authors" },
  },
  {
    label: "website URL with invalid URI characters",
    operation: "create",
    patch: { websiteUrl: "https://example.test/author profile" },
  },
  {
    label: "website URL with a malformed percent escape",
    operation: "update",
    patch: { websiteUrl: "https://example.test/authors/%zz" },
  },
  {
    label: "website URL with raw path brackets",
    operation: "create",
    patch: { websiteUrl: "https://example.test/authors/[primary]" },
  },
  {
    label: "website URL with raw query brackets",
    operation: "update",
    patch: { websiteUrl: "https://example.test/authors?label=[primary]" },
  },
  {
    label: "website URL with empty username syntax",
    operation: "create",
    patch: { websiteUrl: "https://@example.test/authors" },
  },
  {
    label: "website URL with empty username and password syntax",
    operation: "update",
    patch: { websiteUrl: "https://:@example.test/authors" },
  },
  {
    label: "website URL with leading whitespace",
    operation: "create",
    patch: { websiteUrl: " https://example.test/authors" },
  },
  {
    label: "website URL with trailing whitespace",
    operation: "update",
    patch: { websiteUrl: "https://example.test/authors " },
  },
  {
    label: "website URL with an empty port",
    operation: "create",
    patch: { websiteUrl: "https://example.test:/authors" },
  },
  {
    label: "website URL without a raw authority",
    operation: "update",
    patch: { websiteUrl: "https:///example.test/authors" },
  },
];

for (const fixture of ineligibleAuthorWriteFixtures) {
  test(`catalog author ${fixture.operation} rejects ${fixture.label} before persistence`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(): Promise<pg.QueryResult<Row>> {
        throw new Error("Ineligible catalog author must be rejected before persistence");
      },
    };
    const input = {
      authorId: testAuthorId,
      slug: "open-authors",
      displayName: "Open Authors",
      bio: "Community-maintained study material.",
      websiteUrl: "https://authors.example.test/profile",
      ...fixture.patch,
    };
    const operation = fixture.operation === "create"
      ? createCatalogAuthorInExecutor
      : updateCatalogAuthorInExecutor;

    await assert.rejects(
      operation(executor, input),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 400);
        assert.equal((error as HttpError).code, "CATALOG_AUTHOR_NOT_PUBLICLY_ELIGIBLE");
        return true;
      },
    );
  });
}

test("catalog author create accepts an absolute website and update accepts null", async () => {
  const queries: Array<Readonly<{ text: string; params: ReadonlyArray<SqlValue> }>> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push({ text, params });
      const websiteUrl = params[4] as string | null;
      return createQueryResult([createAuthorRow(websiteUrl) as unknown as Row]);
    },
  };
  const baseInput = {
    authorId: testAuthorId,
    slug: "open-authors",
    displayName: "Open Authors",
    bio: "Community-maintained study material.",
  };

  const createdAuthor = await createCatalogAuthorInExecutor(executor, {
    ...baseInput,
    websiteUrl: "HtTpS://[2001:db8::1]/profile?source=catalog",
  });
  const updatedAuthor = await updateCatalogAuthorInExecutor(executor, {
    ...baseInput,
    websiteUrl: null,
  });

  assert.equal(createdAuthor.websiteUrl, "HtTpS://[2001:db8::1]/profile?source=catalog");
  assert.equal(updatedAuthor.websiteUrl, null);
  assert.match(queries[0]?.text ?? "", /INSERT INTO catalog\.authors/);
  assert.match(queries[1]?.text ?? "", /UPDATE catalog\.authors/);
});
function createPackageDraftInput(): CreateCatalogPackageDraftInput {
  return {
    packageId: testPackageId,
    authorId: testAuthorId,
    slug: "spanish-basics",
    title: "Spanish Basics",
    summary: "Core Spanish prompts.",
    description: "Core Spanish flashcards for beginners.",
    languageTags: ["en", "es"],
    topicTags: ["language"],
    license: "CC-BY-4.0",
    contentWarning: null,
  };
}

function createPackageDraftUpdateInput(coverPackageMediaKey: string | null): UpdateCatalogPackageDraftInput {
  return {
    ...createPackageDraftInput(),
    coverPackageMediaKey,
  };
}

for (const operation of ["create", "update"] as const) {
  test(`catalog package draft ${operation} rejects a publicly unsafe slug before persistence`, async () => {
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(): Promise<pg.QueryResult<Row>> {
        throw new Error("Ineligible catalog package must be rejected before persistence");
      },
    };
    const input = {
      ...createPackageDraftUpdateInput(null),
      slug: "a".repeat(64),
    };
    const write = operation === "create"
      ? createCatalogPackageDraftInExecutor
      : updateCatalogPackageDraftInExecutor;

    await assert.rejects(
      write(executor, input),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 400);
        assert.equal((error as HttpError).code, "CATALOG_PACKAGE_NOT_PUBLICLY_ELIGIBLE");
        return true;
      },
    );
  });
}

test("catalog package draft creation maps slug uniqueness to a conflict", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("FROM catalog.authors")) {
        assert.deepEqual(params, [testAuthorId]);
        return createQueryResult([createAuthorRow(null) as unknown as Row]);
      }

      assert.match(text, /INSERT INTO catalog\.packages/);
      const error = new Error("duplicate key value violates unique constraint") as Error & Readonly<{
        code: string;
        constraint: string;
      }>;
      Object.assign(error, {
        code: "23505",
        constraint: "packages_slug_unique",
      });
      throw error;
    },
  };

  await assert.rejects(
    createCatalogPackageDraftInExecutor(executor, createPackageDraftInput()),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_SLUG_ALREADY_EXISTS");
      return true;
    },
  );
});

test("catalog package draft creation starts coverless", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("FROM catalog.authors")) {
        assert.deepEqual(params, [testAuthorId]);
        return createQueryResult([createAuthorRow(null) as unknown as Row]);
      }

      assert.match(text, /INSERT INTO catalog\.packages/);
      assert.doesNotMatch(text.slice(0, text.indexOf("RETURNING")), /cover_package_media_key/);
      assert.deepEqual(params, [
        testPackageId,
        testAuthorId,
        "spanish-basics",
        "Spanish Basics",
        "Core Spanish prompts.",
        "Core Spanish flashcards for beginners.",
        ["en", "es"],
        ["language"],
        "CC-BY-4.0",
        null,
      ]);
      return createQueryResult([createPackageRow() as unknown as Row]);
    },
  };

  const catalogPackage = await createCatalogPackageDraftInExecutor(executor, createPackageDraftInput());

  assert.equal(catalogPackage.coverPackageMediaKey, null);
});

test("catalog package draft update validates cover media after attach", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);

      if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([createPackageRow() as unknown as Row]);
      }

      if (text.includes("FROM catalog.authors")) {
        assert.deepEqual(params, [testAuthorId]);
        return createQueryResult([createAuthorRow(null) as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_media_assets")) {
        assert.deepEqual(params, [testPackageId, ["cover"]]);
        return createQueryResult([{ package_media_key: "cover" } as unknown as Row]);
      }

      if (text.includes("UPDATE catalog.packages")) {
        assert.deepEqual(params, [
          testPackageId,
          testAuthorId,
          "spanish-basics",
          "Spanish Basics",
          "Core Spanish prompts.",
          "Core Spanish flashcards for beginners.",
          ["en", "es"],
          ["language"],
          "CC-BY-4.0",
          null,
          "cover",
        ]);
        return createQueryResult([{
          ...createPackageRow(),
          cover_package_media_key: "cover",
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const catalogPackage = await updateCatalogPackageDraftInExecutor(
    executor,
    createPackageDraftUpdateInput("cover"),
  );

  assert.equal(catalogPackage.coverPackageMediaKey, "cover");
  assert.equal(queries.length, 4);
});

test("published catalog package reassignment rejects an unsafe legacy author before mutation", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);
      if (text.includes("FROM catalog.packages")) {
        assert.deepEqual(params, [testPackageId]);
        assert.match(text, /FOR UPDATE/);
        return createQueryResult([{
          ...createPackageRow(),
          status: "published",
          published_at: testTimestamp,
        } as unknown as Row]);
      }

      assert.deepEqual(params, [testAuthorId]);
      assert.match(text, /FROM catalog\.authors/);
      assert.match(text, /FOR UPDATE/);
      return createQueryResult([{
        ...createAuthorRow(null),
        bio: unsafePublicCatalogStorageReference,
      } as unknown as Row]);
    },
  };

  await assert.rejects(
    updateCatalogPackageDraftInExecutor(executor, createPackageDraftUpdateInput(null)),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_AUTHOR_NOT_PUBLICLY_ELIGIBLE");
      return true;
    },
  );
  assert.equal(queries.length, 2);
});

test("catalog package media assets attach through content.media_blobs", async () => {
  const queries: Array<Readonly<{ text: string; params: ReadonlyArray<SqlValue> }>> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push({ text, params });

      if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([createPackageRow() as unknown as Row]);
      }

      if (text.includes("INSERT INTO catalog.package_media_assets")) {
        assert.match(text, /FROM content\.media_blobs AS media_blobs/);
        assert.doesNotMatch(text, /\bstorage_key\b/);
        assert.deepEqual(params, [
          testPackageMediaAssetId,
          testPackageId,
          "cover",
          testMediaBlobId,
          "Cover image",
          null,
          "CC-BY-4.0",
        ]);
        return createQueryResult([{
          package_media_asset_id: testPackageMediaAssetId,
          package_id: testPackageId,
          package_version_id: null,
          package_media_key: "cover",
          media_blob_id: testMediaBlobId,
          alt_text: "Cover image",
          credit: null,
          license: "CC-BY-4.0",
          created_at: testTimestamp,
          updated_at: testTimestamp,
        } as CatalogPackageMediaAssetRow as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const mediaAsset = await attachCatalogPackageDraftMediaAssetInExecutor(
    executor,
    testPackageId,
    {
      packageMediaAssetId: testPackageMediaAssetId,
      packageMediaKey: "cover",
      mediaBlobId: testMediaBlobId,
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
    },
  );

  assert.equal(mediaAsset.mediaBlobId, testMediaBlobId);
  assert.equal(mediaAsset.packageMediaKey, "cover");
  assert.equal(queries.length, 2);
});

test("published catalog packages can stage and replay card images and replace covers for later versions", async () => {
  const replacementBlobId = "66666666-6666-4666-8666-666666666666";
  const cardMediaAssetId = "77777777-7777-4777-8777-777777777777";
  let cardRow: CatalogPackageMediaAssetRow | null = null;
  let coverRow: CatalogPackageMediaAssetRow = {
    package_media_asset_id: testPackageMediaAssetId,
    package_id: testPackageId,
    package_version_id: null,
    package_media_key: "cover",
    media_blob_id: testMediaBlobId,
    alt_text: null,
    credit: null,
    license: null,
    created_at: testTimestamp,
    updated_at: testTimestamp,
  };
  let coverPackageMediaKey: string | null = null;
  const lifecycleSwapParams: Array<ReadonlyArray<SqlValue>> = [];
  const cleanupParams: Array<ReadonlyArray<SqlValue>> = [];
  const mediaUpdateParams: Array<ReadonlyArray<SqlValue>> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
        return createQueryResult([{
          ...createPackageRow(),
          cover_package_media_key: coverPackageMediaKey,
          status: "published",
          published_at: testTimestamp,
        } as unknown as Row]);
      }
      if (text.includes("FROM catalog.package_media_assets") && text.includes("FOR UPDATE")) {
        const row = params[1] === "cover" ? coverRow : cardRow;
        return createQueryResult(row === null ? [] : [row as unknown as Row]);
      }
      if (text.includes("INSERT INTO catalog.package_media_assets")) {
        assert.deepEqual(params, [testPackageId, "diagram", testMediaBlobId, null, null, null]);
        cardRow = {
          ...coverRow,
          package_media_asset_id: cardMediaAssetId,
          package_media_key: String(params[1]),
          media_blob_id: String(params[2]),
        };
        assert.match(text, /gen_random_uuid\(\)/u);
        return createQueryResult([cardRow as unknown as Row]);
      }
      if (text.includes("lock_media_blob_lifecycles_for_reference_swap")) {
        lifecycleSwapParams.push(params);
        return createQueryResult([]);
      }
      if (text.includes("UPDATE catalog.package_media_assets")) {
        mediaUpdateParams.push(params);
        coverRow = {
          ...coverRow,
          media_blob_id: String(params[2]),
          alt_text: params[3] as string | null,
          credit: params[4] as string | null,
          license: params[5] as string | null,
        };
        return createQueryResult([coverRow as unknown as Row]);
      }
      if (text.includes("UPDATE catalog.packages")) {
        assert.deepEqual(params, [testPackageId, "cover"]);
        coverPackageMediaKey = "cover";
        return createQueryResult([]);
      }
      if (text.includes("schedule_media_blob_cleanup")) {
        cleanupParams.push(params);
        return createQueryResult([]);
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const created = await createOrReplayCatalogPackageDraftCardImageInExecutor(
    executor,
    testPackageId,
    " Diagram ",
    testMediaBlobId,
  );
  const replayed = await createOrReplayCatalogPackageDraftCardImageInExecutor(
    executor,
    testPackageId,
    "diagram",
    testMediaBlobId,
  );
  assert.equal(created.applied, true);
  assert.equal(replayed.applied, false);
  assert.equal(replayed.mediaAsset.packageMediaAssetId, cardMediaAssetId);
  await assert.rejects(
    createOrReplayCatalogPackageDraftCardImageInExecutor(
      executor,
      testPackageId,
      "diagram",
      replacementBlobId,
    ),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 409
      && error.code === "CATALOG_PACKAGE_MEDIA_KEY_CONTENT_CONFLICT",
  );

  const replaced = await replaceCatalogPackageDraftCoverInExecutor(
    executor,
    testPackageId,
    replacementBlobId,
    "  Ciudadanía española — niñas estudiando  ",
    "  © María Núñez  ",
    " CC BY 4.0 ",
  );
  assert.equal(replaced.applied, true);
  assert.equal(replaced.mediaAsset.packageMediaKey, "cover");
  assert.equal(replaced.mediaAsset.mediaBlobId, replacementBlobId);
  assert.equal(replaced.mediaAsset.altText, "Ciudadanía española — niñas estudiando");
  assert.equal(replaced.mediaAsset.credit, "© María Núñez");
  assert.equal(replaced.mediaAsset.license, "CC BY 4.0");
  assert.deepEqual(mediaUpdateParams[0], [
    testPackageId,
    "cover",
    replacementBlobId,
    "Ciudadanía española — niñas estudiando",
    "© María Núñez",
    "CC BY 4.0",
  ]);
  assert.deepEqual(lifecycleSwapParams, [[testMediaBlobId, replacementBlobId]]);
  assert.equal(cleanupParams.length, 1);
  assert.equal(cleanupParams[0]?.[0], testMediaBlobId);

  const metadataUpdated = await replaceCatalogPackageDraftCoverInExecutor(
    executor,
    testPackageId,
    replacementBlobId,
    "Ciudadanía española — jóvenes estudiando",
    null,
    "CC BY 4.0",
  );
  assert.equal(metadataUpdated.applied, true);
  assert.equal(metadataUpdated.mediaAsset.mediaBlobId, replacementBlobId);
  assert.equal(metadataUpdated.mediaAsset.altText, "Ciudadanía española — jóvenes estudiando");
  assert.equal(metadataUpdated.mediaAsset.credit, null);
  assert.deepEqual(mediaUpdateParams[1], [
    testPackageId,
    "cover",
    replacementBlobId,
    "Ciudadanía española — jóvenes estudiando",
    null,
    "CC BY 4.0",
  ]);
  assert.equal(lifecycleSwapParams.length, 1);
  assert.equal(cleanupParams.length, 1);

  const replayedCover = await replaceCatalogPackageDraftCoverInExecutor(
    executor,
    testPackageId,
    replacementBlobId,
    "Ciudadanía española — jóvenes estudiando",
    null,
    "CC BY 4.0",
  );
  assert.equal(replayedCover.applied, false);
  assert.equal(mediaUpdateParams.length, 2);

  await assert.rejects(
    replaceCatalogPackageDraftCoverInExecutor(
      executor,
      testPackageId,
      replacementBlobId,
      "  ",
      null,
      "CC BY 4.0",
    ),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 400
      && error.code === "CATALOG_INVALID_INPUT",
  );
});
