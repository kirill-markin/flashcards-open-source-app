import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { createCatalogInstallRoutes } from "../../routes/catalogInstall";
import { HttpError } from "../../shared/errors";
import {
  catalogPackageInstallOperationIdPrefixMaximumLength,
  installCatalogPackageVersionInExecutor,
  previewCatalogPackageInstallInExecutor,
} from "./install";
import {
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
} from "../testSupport";
import type { CatalogPackageStatus } from "../types";

const testWorkspaceReplicaId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const testInstallTimestamp = "2026-04-19T10:30:00.000Z";

function createPackageInstallVersionRow(status: CatalogPackageStatus): Readonly<Record<string, unknown>> {
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
    card_count: 1,
    created_at: testTimestamp,
    published_at: testTimestamp,
    author_id: testAuthorId,
    author_slug: "open-cards",
    author_display_name: "Open Cards",
  };
}

test("catalog install creates logical media assets from existing blobs and rewrites card markdown", async () => {
  const queries: Array<Readonly<{ text: string; params: ReadonlyArray<SqlValue> }>> = [];
  let insertedMediaAssetId: string | null = null;
  let insertedCardId: string | null = null;
  const installInput = {
    installId: "catalog-install-1",
    installedAt: testInstallTimestamp,
    clientUpdatedAt: testInstallTimestamp,
    lastModifiedByReplicaId: testWorkspaceReplicaId,
    operationIdPrefix: "catalog-install-1",
  };
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push({ text, params });

      if (text.includes("FROM catalog.package_versions AS package_versions")) {
        assert.match(text, /FOR SHARE OF package_versions/);
        assert.deepEqual(params, [testPackageVersionId]);
        return createQueryResult([createPackageInstallVersionRow("published") as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_media_assets") && text.includes("ORDER BY package_media_key")) {
        assert.deepEqual(params, [testPackageVersionId]);
        assert.doesNotMatch(text, /\bstorage_key\b/);
        assert.doesNotMatch(text, /\bsha256\b/);
        return createQueryResult([{
          package_media_asset_id: testPackageMediaAssetId,
          package_media_key: testPackageMediaKey,
          media_blob_id: testMediaBlobId,
        } as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_cards")) {
        assert.deepEqual(params, [testPackageVersionId]);
        return createQueryResult([{
          package_card_id: testWorkspaceCardId,
          stable_card_key: "hola-card",
          ordinal: 1,
          front_text: `Prompt ![diagram](fcasset:${testPackageMediaKey})`,
          back_text: `Answer [source](fcasset:${testPackageMediaKey})`,
          card_type: "basic",
          metadata: {
            version: 1,
            source: {
              label: null,
              author: null,
              comment: null,
              createdAt: "2026-04-18T12:00:00+02:00",
              importedAt: null,
              importId: null,
            },
          },
          tags: ["language"],
          media_asset_keys: [testPackageMediaKey],
        } as unknown as Row]);
      }

      if (text.includes("FROM sync.workspace_replicas")) {
        assert.deepEqual(params, [testWorkspaceId, testWorkspaceReplicaId]);
        return createQueryResult([{ ok: 1 } as unknown as Row]);
      }

      if (text.includes("metadata->'source'->>'importId'")) {
        assert.deepEqual(params, [testWorkspaceId, installInput.installId]);
        return createQueryResult([]);
      }

      if (text.includes("operation_conflicts")) {
        assert.deepEqual(params, [
          testWorkspaceId,
          ["catalog-install-1:media:0", "catalog-install-1:card:0"],
        ]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        assert.deepEqual(params, [testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM sync.workspace_sync_metadata") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testWorkspaceId]);
        return createQueryResult([{ workspace_id: testWorkspaceId } as unknown as Row]);
      }

      if (text.includes("INSERT INTO content.media_assets")) {
        insertedMediaAssetId = String(params[0]);
        assert.match(insertedMediaAssetId, /^[0-9a-f-]{36}$/);
        assert.deepEqual(params.slice(1), [
          testWorkspaceId,
          testMediaBlobId,
          testInstallTimestamp,
          testInstallTimestamp,
          testWorkspaceReplicaId,
          "catalog-install-1:media:0",
        ]);
        assert.doesNotMatch(text, /\bstorage_key\b/);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO content.cards")) {
        assert.notEqual(insertedMediaAssetId, null);
        insertedCardId = String(params[0]);
        assert.match(insertedCardId, /^[0-9a-f-]{36}$/);
        assert.deepEqual(params.slice(1), [
          testWorkspaceId,
          `Prompt ![diagram](fcasset:${insertedMediaAssetId})`,
          `Answer [source](fcasset:${insertedMediaAssetId})`,
          "basic",
          JSON.stringify({
            version: 1,
            source: {
              label: "Spanish Basics",
              author: "Open Cards",
              comment: "Core Spanish prompts.",
              createdAt: testTimestamp,
              importedAt: testInstallTimestamp,
              importId: "catalog-install-1",
            },
          }),
          ["language"],
          testInstallTimestamp,
          testInstallTimestamp,
          testWorkspaceReplicaId,
          "catalog-install-1:card:0",
        ]);
        return createQueryResult([]);
      }

      if (text.includes("INSERT INTO sync.hot_changes")) {
        assert.equal(params[0], testWorkspaceId);
        assert.equal(params[3], "upsert");
        assert.equal(params[4], testWorkspaceReplicaId);
        assert.equal(params[6], testInstallTimestamp);
        if (params[1] === "media_asset") {
          assert.equal(params[2], insertedMediaAssetId);
          assert.equal(params[5], "catalog-install-1:media:0");
        } else if (params[1] === "card") {
          assert.equal(params[2], insertedCardId);
          assert.equal(params[5], "catalog-install-1:card:0");
        } else {
          assert.fail(`Unexpected sync entity type: ${String(params[1])}`);
        }
        return createQueryResult([{ change_id: 1 } as unknown as Row]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await installCatalogPackageVersionInExecutor(
    executor,
    testWorkspaceId,
    testPackageVersionId,
    installInput,
  );

  assert.equal(result.summary.cardCount, 1);
  assert.equal(result.summary.mediaAssetCount, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result.installedMediaAssets[0], "mediaBlobId"), false);
  assert.equal(result.installedMediaAssets[0]?.mediaAssetId, insertedMediaAssetId);
  assert.equal(result.installedCards[0]?.cardId, insertedCardId);
  const lockQueryIndex = queries.findIndex((query) => (
    query.text.includes("FROM sync.workspace_sync_metadata") && query.text.includes("FOR UPDATE")
  ));
  const installIdCheckQueryIndex = queries.findIndex((query) => (
    query.text.includes("metadata->'source'->>'importId'")
  ));
  const operationIdsCheckQueryIndex = queries.findIndex((query) => query.text.includes("operation_conflicts"));
  assert.ok(lockQueryIndex >= 0);
  assert.ok(installIdCheckQueryIndex > lockQueryIndex);
  assert.ok(operationIdsCheckQueryIndex > lockQueryIndex);
});

test("catalog install rejects invalid client timestamps as bad input", async () => {
  let queryCount = 0;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      _text: string,
      _params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queryCount += 1;
      throw new Error("install input validation should run before database queries");
    },
  };

  await assert.rejects(
    installCatalogPackageVersionInExecutor(
      executor,
      testWorkspaceId,
      testPackageVersionId,
      {
        installId: "catalog-install-bad-timestamp",
        installedAt: "not-a-date",
        clientUpdatedAt: testInstallTimestamp,
        lastModifiedByReplicaId: testWorkspaceReplicaId,
        operationIdPrefix: "catalog-install-bad-timestamp",
      },
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 400);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
      assert.match((error as HttpError).message, /installedAt/);
      return true;
    },
  );
  await assert.rejects(
    installCatalogPackageVersionInExecutor(
      executor,
      testWorkspaceId,
      testPackageVersionId,
      {
        installId: "catalog-install-bad-timestamp",
        installedAt: testInstallTimestamp,
        clientUpdatedAt: "not-a-date",
        lastModifiedByReplicaId: testWorkspaceReplicaId,
        operationIdPrefix: "catalog-install-bad-timestamp",
      },
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 400);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
      assert.match((error as HttpError).message, /clientUpdatedAt/);
      return true;
    },
  );
  assert.equal(queryCount, 0);
});

test("catalog install rejects unsafe operation prefixes before database work", async () => {
  let queryCount = 0;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(): Promise<pg.QueryResult<Row>> {
      queryCount += 1;
      throw new Error("operationIdPrefix validation should run before database queries");
    },
  };
  const invalidPrefixes = [
    " leading-space",
    "trailing-space ",
    "unsafe\nprefix",
    "unsafe\u00a0prefix",
    "a".repeat(catalogPackageInstallOperationIdPrefixMaximumLength + 1),
  ];

  for (const operationIdPrefix of invalidPrefixes) {
    await assert.rejects(
      installCatalogPackageVersionInExecutor(
        executor,
        testWorkspaceId,
        testPackageVersionId,
        {
          installId: "catalog-install-invalid-operation-prefix",
          installedAt: testInstallTimestamp,
          clientUpdatedAt: testInstallTimestamp,
          lastModifiedByReplicaId: testWorkspaceReplicaId,
          operationIdPrefix,
        },
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
        assert.match(error.message, /operationIdPrefix.*printable ASCII/);
        return true;
      },
    );
  }
  assert.equal(queryCount, 0);
});

test("catalog install rejects invalid package card source createdAt", async () => {
  const queries: Array<Readonly<{ text: string; params: ReadonlyArray<SqlValue> }>> = [];
  const installInput = {
    installId: "catalog-install-invalid-card-source",
    installedAt: testInstallTimestamp,
    clientUpdatedAt: testInstallTimestamp,
    lastModifiedByReplicaId: testWorkspaceReplicaId,
    operationIdPrefix: "catalog-install-invalid-card-source",
  };
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push({ text, params });

      if (text.includes("FROM catalog.package_versions AS package_versions")) {
        assert.match(text, /FOR SHARE OF package_versions/);
        assert.deepEqual(params, [testPackageVersionId]);
        return createQueryResult([createPackageInstallVersionRow("published") as unknown as Row]);
      }

      if (text.includes("FROM catalog.package_media_assets") && text.includes("ORDER BY package_media_key")) {
        assert.deepEqual(params, [testPackageVersionId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM catalog.package_cards")) {
        assert.deepEqual(params, [testPackageVersionId]);
        return createQueryResult([{
          package_card_id: testWorkspaceCardId,
          stable_card_key: "invalid-source-created-at-card",
          ordinal: 1,
          front_text: "Prompt",
          back_text: "Answer",
          card_type: "basic",
          metadata: {
            version: 1,
            source: {
              label: null,
              author: null,
              comment: null,
              createdAt: "not-a-date",
              importedAt: null,
              importId: null,
            },
          },
          tags: [],
          media_asset_keys: [],
        } as unknown as Row]);
      }

      if (text.includes("FROM sync.workspace_replicas")) {
        assert.deepEqual(params, [testWorkspaceId, testWorkspaceReplicaId]);
        return createQueryResult([{ ok: 1 } as unknown as Row]);
      }

      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        assert.deepEqual(params, [testWorkspaceId]);
        return createQueryResult([]);
      }

      if (text.includes("FROM sync.workspace_sync_metadata") && text.includes("FOR UPDATE")) {
        assert.deepEqual(params, [testWorkspaceId]);
        return createQueryResult([{ workspace_id: testWorkspaceId } as unknown as Row]);
      }

      if (text.includes("metadata->'source'->>'importId'")) {
        assert.deepEqual(params, [testWorkspaceId, installInput.installId]);
        return createQueryResult([]);
      }

      if (text.includes("operation_conflicts")) {
        assert.deepEqual(params, [testWorkspaceId, ["catalog-install-invalid-card-source:card:0"]]);
        return createQueryResult([]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    installCatalogPackageVersionInExecutor(
      executor,
      testWorkspaceId,
      testPackageVersionId,
      installInput,
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_CARD_METADATA_INVALID");
      assert.match((error as HttpError).message, /source createdAt/);
      return true;
    },
  );
  assert.equal(queries.some((query) => query.text.includes("INSERT INTO content.cards")), false);
  assert.equal(queries.some((query) => query.text.includes("INSERT INTO sync.hot_changes")), false);
});

test("catalog install rejects unpublished and delisted package versions", async () => {
  const previewExecutor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      assert.match(text, /FROM catalog\.package_versions AS package_versions/);
      assert.deepEqual(params, [testPackageVersionId]);
      return createQueryResult([createPackageInstallVersionRow("draft") as unknown as Row]);
    },
  };

  await assert.rejects(
    previewCatalogPackageInstallInExecutor(previewExecutor, testPackageVersionId),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_VERSION_NOT_PUBLISHED");
      assert.match((error as HttpError).message, /status=draft/);
      return true;
    },
  );

  const installExecutor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      assert.match(text, /FROM catalog\.package_versions AS package_versions/);
      assert.match(text, /FOR SHARE OF package_versions/);
      assert.deepEqual(params, [testPackageVersionId]);
      return createQueryResult([createPackageInstallVersionRow("delisted") as unknown as Row]);
    },
  };

  await assert.rejects(
    installCatalogPackageVersionInExecutor(
      installExecutor,
      testWorkspaceId,
      testPackageVersionId,
      {
        installId: "catalog-install-2",
        installedAt: testInstallTimestamp,
        clientUpdatedAt: testInstallTimestamp,
        lastModifiedByReplicaId: testWorkspaceReplicaId,
        operationIdPrefix: "catalog-install-2",
      },
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 409);
      assert.equal((error as HttpError).code, "CATALOG_PACKAGE_VERSION_NOT_PUBLISHED");
      assert.match((error as HttpError).message, /status=delisted/);
      return true;
    },
  );
});

test("catalog install route rejects unauthorized workspace access before installing", async () => {
  let previewCalled = false;
  const app = createCatalogInstallRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {
        authorizationHeader: undefined,
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
      requestContext: {
        userId: "user-1",
        subjectUserId: "subject-user-1",
        selectedWorkspaceId: null,
        email: "user@example.com",
        locale: "en",
        userSettingsCreatedAt: testTimestamp,
        preferences: {
          reviewReactionAnimationsEnabled: true,
        },
        transport: "api_key",
        connectionId: "connection-1",
        guestSessionId: null,
        guestPlatform: null,
      },
    }),
    assertUserHasWorkspaceAccessFn: async () => {
      throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
    },
    previewCatalogPackageInstallFn: async () => {
      previewCalled = true;
      throw new Error("preview should not run");
    },
  });
  app.onError((error) => {
    throw error;
  });

  await assert.rejects(
    async () => (
      app.request(
        `http://localhost/workspaces/${testWorkspaceId}/catalog/package-versions/${testPackageVersionId}/install/preview`,
        { method: "POST" },
      )
    ),
    (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).statusCode, 404);
      assert.equal((error as HttpError).code, "WORKSPACE_NOT_FOUND");
      return true;
    },
  );
  assert.equal(previewCalled, false);
});

test("catalog install route rejects unsafe operation prefixes without sanitizing them", async () => {
  let installCalled = false;
  const app = createCatalogInstallRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {
        authorizationHeader: undefined,
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
      requestContext: {
        userId: "user-1",
        subjectUserId: "subject-user-1",
        selectedWorkspaceId: null,
        email: "user@example.com",
        locale: "en",
        userSettingsCreatedAt: testTimestamp,
        preferences: {
          reviewReactionAnimationsEnabled: true,
        },
        transport: "api_key",
        connectionId: "connection-1",
        guestSessionId: null,
        guestPlatform: null,
      },
    }),
    assertUserHasWorkspaceAccessFn: async () => undefined,
    installCatalogPackageVersionFn: async () => {
      installCalled = true;
      throw new Error("catalog install must not run for an unsafe operationIdPrefix");
    },
  });
  app.onError((error) => {
    throw error;
  });

  await assert.rejects(
    async () => app.request(
      `http://localhost/workspaces/${testWorkspaceId}/catalog/package-versions/${testPackageVersionId}/install`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          installId: "catalog-install-route-invalid-prefix",
          installedAt: testInstallTimestamp,
          clientUpdatedAt: testInstallTimestamp,
          lastModifiedByReplicaId: testWorkspaceReplicaId,
          operationIdPrefix: " trailing-space ",
        }),
      },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
      assert.match(error.message, /operationIdPrefix.*printable ASCII/);
      return true;
    },
  );
  assert.equal(installCalled, false);
});
