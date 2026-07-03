import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { HttpError } from "../../shared/errors";
import { attachCatalogPackageDraftMediaAssetInExecutor } from "./draftMedia";
import { createCatalogPackageDraftInExecutor, updateCatalogPackageDraftInExecutor } from "./drafts";
import {
  createCatalogPackageVersionFromWorkspaceSelectionInExecutor,
  publishCatalogPackageVersionInExecutor,
} from "./versions";
import {
  assertPublicPayloadDoesNotContainUnsafeMediaReferences,
  createQueryResult,
  testAuthorId,
  testMediaBlobId,
  testPackageId,
  testPackageMediaAssetId,
  testPackageMediaKey,
  testPackageVersionId,
  testTimestamp,
  testWorkspaceCardId,
  testWorkspaceId,
  testWorkspaceMediaAssetId,
} from "../testSupport";
import type {
  CatalogPackageMediaAssetRow,
  CatalogPackageRow,
  CatalogPackageStatus,
  CatalogPackageVersionRow,
  CreateCatalogPackageDraftInput,
  UpdateCatalogPackageDraftInput,
} from "../types";

const testSecondWorkspaceMediaAssetId = "99999999-9999-4999-8999-999999999999";
const testSecondMediaBlobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const testCollisionSafePackageMediaKey = `${testPackageMediaKey}.1`;
const testSecondPackageMediaKey = "media-2";

function createPackageRow(): CatalogPackageRow {
  return {
    package_id: testPackageId,
    author_id: testAuthorId,
    slug: "spanish-basics",
    title: "Spanish Basics",
    summary: "Core Spanish prompts.",
    description: "Core Spanish flashcards for beginners.",
    language_tags: ["en", "es"],
    topic_tags: ["language"],
    license: "CC-BY-4.0",
    content_warning: null,
    cover_package_media_key: null,
    status: "draft",
    created_at: testTimestamp,
    updated_at: testTimestamp,
    published_at: null,
    delisted_at: null,
  };
}

function createPackageVersionRow(status: CatalogPackageStatus): CatalogPackageVersionRow {
  return {
    package_version_id: testPackageVersionId,
    package_id: testPackageId,
    version_number: 1,
    status,
    slug: "spanish-basics",
    title: "Spanish Basics",
    summary: "Core Spanish prompts.",
    description: "Core Spanish flashcards for beginners.",
    language_tags: ["en", "es"],
    topic_tags: ["language"],
    license: "CC-BY-4.0",
    content_warning: null,
    cover_package_media_key: null,
    source_workspace_id: null,
    card_count: 1,
    created_by_admin_email: "admin@example.com",
    reviewed_by_admin_email: null,
    created_at: testTimestamp,
    updated_at: testTimestamp,
    submitted_at: null,
    reviewed_at: null,
    published_at: null,
    delisted_at: null,
  };
}

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

test("catalog package draft creation maps slug uniqueness to a conflict", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      _params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
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

test("publish helper rejects unapproved package versions before mutating", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);
      assert.deepEqual(params, [testPackageVersionId]);
      if (text.includes("FROM catalog.package_versions") && text.includes("FOR UPDATE")) {
        return createQueryResult([createPackageVersionRow("draft") as unknown as Row]);
      }

      throw new Error(`Unexpected mutation query: ${text}`);
    },
  };

  await assert.rejects(
    publishCatalogPackageVersionInExecutor(
      executor,
      testPackageVersionId,
      "admin@example.com",
      null,
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_VERSION_NOT_APPROVED");
      return true;
    },
  );
  assert.equal(queries.length, 1);
});

test("workspace-selected catalog versions generate fresh package card ids", async () => {
  let insertedPackageCardId: string | null = null;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["admin-user-id", testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM content.cards")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceCardId]]);
        return createQueryResult([{
          card_id: testWorkspaceCardId,
          front_text: "Hola",
          back_text: "Hello",
          card_type: "basic",
          metadata: { version: 1, source: null },
          tags: ["language"],
        } as unknown as Row]);
      }

      if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([createPackageRow() as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("status IN")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("ORDER BY version_number DESC")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_versions")) {
        assert.equal(params[0], testPackageVersionId);
        assert.equal(params[12], testWorkspaceId);
        return createQueryResult([{
          ...createPackageVersionRow("draft"),
          source_workspace_id: testWorkspaceId,
        } as unknown as Row]);
      }

      if (text.includes("INSERT INTO catalog.package_media_assets")) {
        assert.deepEqual(params, [testPackageId, testPackageVersionId]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_cards")) {
        insertedPackageCardId = String(params[0]);
        assert.notEqual(insertedPackageCardId, testWorkspaceCardId);
        assert.match(insertedPackageCardId, /^[0-9a-f-]{36}$/);
        assert.deepEqual(params.slice(1), [
          testPackageVersionId,
          testWorkspaceCardId,
          1,
          "Hola",
          "Hello",
          "basic",
          JSON.stringify({ version: 1, source: null }),
          ["language"],
          [],
        ]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_review_events")) {
        assert.deepEqual(params, [
          testPackageId,
          testPackageVersionId,
          null,
          "draft",
          "admin@example.com",
          null,
        ]);
        return createQueryResult([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const packageVersion = await createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
    executor,
    testPackageId,
    {
      packageVersionId: testPackageVersionId,
      workspaceId: testWorkspaceId,
      cardIds: [testWorkspaceCardId],
    },
    "admin-user-id",
    "admin@example.com",
  );

  assert.equal(packageVersion.packageVersionId, testPackageVersionId);
  assert.equal(packageVersion.sourceWorkspaceId, testWorkspaceId);
  assert.notEqual(insertedPackageCardId, null);
});

test("workspace-selected catalog versions preserve managed media as package media", async () => {
  const versionMediaInsertParams: Array<ReadonlyArray<SqlValue>> = [];
  let insertedPackageCardId: string | null = null;
  let insertedPackageCardParams: ReadonlyArray<SqlValue> | null = null;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["admin-user-id", testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM content.cards")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceCardId]]);
        return createQueryResult([{
          card_id: testWorkspaceCardId,
          front_text: `Prompt ![diagram](fcasset:${testWorkspaceMediaAssetId})`,
          back_text: `Answer [audio](fcasset:${testSecondWorkspaceMediaAssetId}) and again ![same](fcasset:${testWorkspaceMediaAssetId})`,
          card_type: "basic",
          metadata: { version: 1, source: null },
          tags: ["media"],
        } as unknown as Row]);
      }

      if (text.includes("FROM content.media_assets AS media_assets")) {
        assert.match(text, /INNER JOIN content\.media_blobs AS media_blobs/);
        assert.doesNotMatch(text, /\bstorage_key\b/);
        assert.doesNotMatch(text, /\bsha256\b/);
        assert.doesNotMatch(text, /\bsource_url\b/);
        assert.deepEqual(params, [testWorkspaceId, [
          testWorkspaceMediaAssetId,
          testSecondWorkspaceMediaAssetId,
        ]]);
        return createQueryResult([
          {
            media_asset_id: testWorkspaceMediaAssetId,
            media_blob_id: testMediaBlobId,
          } as unknown as Row,
          {
            media_asset_id: testSecondWorkspaceMediaAssetId,
            media_blob_id: testSecondMediaBlobId,
          } as unknown as Row,
        ]);
      }

      if (text.includes("FROM catalog.packages") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([createPackageRow() as unknown as Row]);
      }

      if (text.includes("SELECT package_media_key")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([{
          package_media_key: testPackageMediaKey,
        } as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("status IN")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM catalog.package_versions") && text.includes("ORDER BY version_number DESC")) {
        assert.deepEqual(params, [testPackageId]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_versions")) {
        assert.equal(params[0], testPackageVersionId);
        assert.equal(params[12], testWorkspaceId);
        return createQueryResult([{
          ...createPackageVersionRow("draft"),
          source_workspace_id: testWorkspaceId,
        } as unknown as Row]);
      }

      if (text.includes("INSERT INTO catalog.package_media_assets")) {
        assert.doesNotMatch(text, /\bstorage_key\b/);
        assert.doesNotMatch(text, /\bsha256\b/);
        assert.doesNotMatch(text, /\bsource_url\b/);

        if (text.includes("SELECT gen_random_uuid(), package_id")) {
          assert.deepEqual(params, [testPackageId, testPackageVersionId]);
          return createQueryResult([]);
        }

        versionMediaInsertParams.push(params);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_cards")) {
        insertedPackageCardId = String(params[0]);
        insertedPackageCardParams = params;
        assert.notEqual(insertedPackageCardId, testWorkspaceCardId);
        assert.match(insertedPackageCardId, /^[0-9a-f-]{36}$/);
        assert.deepEqual(params.slice(1), [
          testPackageVersionId,
          testWorkspaceCardId,
          1,
          `Prompt ![diagram](fcasset:${testCollisionSafePackageMediaKey})`,
          `Answer [audio](fcasset:${testSecondPackageMediaKey}) and again ![same](fcasset:${testCollisionSafePackageMediaKey})`,
          "basic",
          JSON.stringify({ version: 1, source: null }),
          ["media"],
          [testCollisionSafePackageMediaKey, testSecondPackageMediaKey],
        ]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO catalog.package_review_events")) {
        assert.deepEqual(params, [
          testPackageId,
          testPackageVersionId,
          null,
          "draft",
          "admin@example.com",
          null,
        ]);
        return createQueryResult([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const packageVersion = await createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
    executor,
    testPackageId,
    {
      packageVersionId: testPackageVersionId,
      workspaceId: testWorkspaceId,
      cardIds: [testWorkspaceCardId],
    },
    "admin-user-id",
    "admin@example.com",
  );

  assert.equal(packageVersion.packageVersionId, testPackageVersionId);
  assert.equal(packageVersion.sourceWorkspaceId, testWorkspaceId);
  assert.notEqual(insertedPackageCardId, null);
  assert.notEqual(insertedPackageCardParams, null);
  assert.deepEqual(versionMediaInsertParams, [
    [testPackageId, testPackageVersionId, testCollisionSafePackageMediaKey, testMediaBlobId],
    [testPackageId, testPackageVersionId, testSecondPackageMediaKey, testSecondMediaBlobId],
  ]);
  assertPublicPayloadDoesNotContainUnsafeMediaReferences({
    insertedPackageCardParams,
    versionMediaInsertParams,
  });
});

test("workspace-selected catalog versions fail when referenced media is missing", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["admin-user-id", testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM content.cards")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceCardId]]);
        return createQueryResult([{
          card_id: testWorkspaceCardId,
          front_text: `Prompt ![diagram](fcasset:${testWorkspaceMediaAssetId})`,
          back_text: "Answer",
          card_type: "basic",
          metadata: { version: 1, source: null },
          tags: [],
        } as unknown as Row]);
      }

      if (text.includes("FROM content.media_assets AS media_assets")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceMediaAssetId]]);
        return createQueryResult([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
      executor,
      testPackageId,
      {
        packageVersionId: testPackageVersionId,
        workspaceId: testWorkspaceId,
        cardIds: [testWorkspaceCardId],
      },
      "admin-user-id",
      "admin@example.com",
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 400);
      assert.equal((error as HttpError).code, "CATALOG_WORKSPACE_MEDIA_ASSET_NOT_FOUND");
      assert.match((error as HttpError).message, new RegExp(`workspaceId=${testWorkspaceId}`));
      assert.match((error as HttpError).message, new RegExp(`missingMediaAssetIds=${testWorkspaceMediaAssetId}`));
      return true;
    },
  );
  assert.equal(queries.length, 3);
});

test("workspace-selected catalog versions reject invalid managed media references", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);
      if (text.includes("set_config('app.user_id'")) {
        assert.deepEqual(params, ["admin-user-id", testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM content.cards")) {
        assert.deepEqual(params, [testWorkspaceId, [testWorkspaceCardId]]);
        return createQueryResult([{
          card_id: testWorkspaceCardId,
          front_text: "Prompt ![diagram](fcasset:not-a-uuid)",
          back_text: "Answer",
          card_type: "basic",
          metadata: { version: 1, source: null },
          tags: [],
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    createCatalogPackageVersionFromWorkspaceSelectionInExecutor(
      executor,
      testPackageId,
      {
        packageVersionId: testPackageVersionId,
        workspaceId: testWorkspaceId,
        cardIds: [testWorkspaceCardId],
      },
      "admin-user-id",
      "admin@example.com",
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 400);
      assert.equal((error as HttpError).code, "CATALOG_WORKSPACE_MEDIA_ASSET_ID_INVALID");
      assert.match((error as HttpError).message, /mediaAssetIds=not-a-uuid/);
      return true;
    },
  );
  assert.equal(queries.length, 2);
});
