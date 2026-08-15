import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { HttpError } from "../../../shared/errors";
import {
  assertPublicPayloadDoesNotContainUnsafeMediaReferences,
  createQueryResult,
  testMediaBlobId,
  testPackageId,
  testPackageMediaKey,
  testPackageVersionId,
  testWorkspaceCardId,
  testWorkspaceId,
  testWorkspaceMediaAssetId,
} from "../../testSupport";
import { createPackageRow, createPackageVersionRow } from "../authoringTestSupport";
import {
  createCatalogPackageVersionFromCardsInExecutor,
  createCatalogPackageVersionFromWorkspaceSelectionInExecutor,
} from "./index";

const testSecondWorkspaceMediaAssetId = "99999999-9999-4999-8999-999999999999";
const testSecondMediaBlobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const testCollisionSafePackageMediaKey = `${testPackageMediaKey}.1`;
const testSecondPackageMediaKey = "media-2";

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
        assert.equal(params[11], testWorkspaceId);
        return createQueryResult([{
          ...createPackageVersionRow("draft"),
          source_workspace_id: testWorkspaceId,
        } as unknown as Row]);
      }

      if (text.includes("lock_catalog_package_version_media_blob_lifecycles")) {
        assert.deepEqual(params, [testPackageId, []]);
        return createQueryResult([]);
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
        assert.equal(params[11], testWorkspaceId);
        return createQueryResult([{
          ...createPackageVersionRow("draft"),
          source_workspace_id: testWorkspaceId,
        } as unknown as Row]);
      }

      if (text.includes("lock_catalog_package_version_media_blob_lifecycles")) {
        assert.deepEqual(params, [
          testPackageId,
          [testMediaBlobId, testSecondMediaBlobId],
        ]);
        return createQueryResult([]);
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

test("workspace-selected catalog versions reject non-ready managed media references", async () => {
  const pendingUrl = `fcasset:${testWorkspaceMediaAssetId}?state=pending`;
  const unsupportedUrl = `FcAsSeT:${testWorkspaceMediaAssetId}?state=pending`;
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
          front_text: `Prompt ![diagram](${pendingUrl}) ![unsupported](${unsupportedUrl})`,
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
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 409
      && error.code === "CATALOG_WORKSPACE_MANAGED_MEDIA_NOT_READY"
      && error.message.includes(pendingUrl)
      && error.message.includes(unsupportedUrl)
      && error.message.includes("retry after promotion and attachment settle")
      && error.message.includes("Unsupported managed media lifecycle URLs"),
  );
  assert.equal(queries.length, 2);
});

test("direct catalog card snapshots reject non-ready managed media references", async () => {
  const failedUrl = `fcasset:${testPackageMediaKey}?state=failed`;
  const unsupportedUrl = `fcasset:${testPackageMediaKey}?state=ready`;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      _params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      throw new Error(`Catalog normalization unexpectedly queried PostgreSQL: ${text}`);
    },
  };

  await assert.rejects(
    createCatalogPackageVersionFromCardsInExecutor(
      executor,
      testPackageId,
      {
        packageVersionId: testPackageVersionId,
        cards: [{
          packageCardId: testWorkspaceCardId,
          stableCardKey: "card-1",
          ordinal: 1,
          frontText: `Prompt ![failed](${failedUrl}) ![unsupported](${unsupportedUrl})`,
          backText: "Answer",
          cardType: "basic",
          metadata: { version: 1, source: null },
          tags: [],
          mediaAssetKeys: [],
        }],
      },
      "admin@example.com",
    ),
    (error: unknown) => error instanceof HttpError
      && error.statusCode === 409
      && error.code === "CATALOG_MANAGED_MEDIA_NOT_READY"
      && error.message.includes(failedUrl)
      && error.message.includes(unsupportedUrl)
      && error.message.includes("Failed managed media is terminal")
      && error.message.includes("remove the reference or regenerate and reattach the image")
      && error.message.includes("Unsupported managed media lifecycle URLs"),
  );
});
