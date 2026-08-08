import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { HttpError } from "../../../shared/errors";
import {
  catalogPackageInstallOperationIdPrefixMaximumLength,
  installCatalogPackageVersionInExecutor,
} from "./index";
import {
  createPackageInstallVersionRow,
  testInstallTimestamp,
  testMediaBlobId,
  testPackageMediaAssetId,
  testPackageMediaKey,
  testPackageVersionId,
  testTimestamp,
  testWorkspaceCardId,
  testWorkspaceId,
  testWorkspaceMediaAssetId,
  testWorkspaceReplicaId,
} from "./installTestSupport";
import { createQueryResult } from "../../testSupport";

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

      if (text.includes("FROM sync.catalog_package_install_idempotency")) {
        assert.deepEqual(params, [testWorkspaceId, installInput.installId]);
        return createQueryResult([]);
      }

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

      if (text.includes("INSERT INTO sync.catalog_package_install_idempotency")) {
        assert.deepEqual(params.slice(0, 10), [
          testWorkspaceId,
          installInput.installId,
          testPackageVersionId,
          testInstallTimestamp,
          testInstallTimestamp,
          testWorkspaceReplicaId,
          "catalog-install-1",
          false,
          null,
          [],
        ]);
        return createQueryResult([]);
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
  assert.equal(result.summary.keptTagCount, 1);
  assert.equal(result.summary.removedTagCount, 0);
  assert.equal(result.summary.importTag, null);
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

test("catalog install preserves catalog order with millisecond timestamps and one importedAt", async () => {
  const insertedCards: Array<ReadonlyArray<SqlValue>> = [];
  const packageCards = [
    {
      package_card_id: "10000000-0000-4000-8000-000000000001",
      stable_card_key: "first",
      ordinal: 1,
      front_text: "First",
      back_text: "First answer",
      card_type: "basic",
      metadata: {
        version: 1,
        source: {
          label: null,
          author: null,
          comment: null,
          createdAt: "2025-01-02T03:04:05.000Z",
          importedAt: null,
          importId: null,
        },
      },
      tags: ["keep", "legacy"],
      media_asset_keys: [],
    },
    {
      package_card_id: "20000000-0000-4000-8000-000000000001",
      stable_card_key: "second",
      ordinal: 2,
      front_text: "Second",
      back_text: "Second answer",
      card_type: "basic",
      metadata: { version: 1, source: null },
      tags: ["legacy"],
      media_asset_keys: [],
    },
    {
      package_card_id: "20000000-0000-4000-8000-000000000002",
      stable_card_key: "third",
      ordinal: 2,
      front_text: "Third",
      back_text: "Third answer",
      card_type: "basic",
      metadata: { version: 1, source: null },
      tags: ["keep"],
      media_asset_keys: [],
    },
  ] as const;
  const installInput = {
    installId: "catalog-install-ordered",
    installedAt: testInstallTimestamp,
    clientUpdatedAt: testInstallTimestamp,
    lastModifiedByReplicaId: testWorkspaceReplicaId,
    operationIdPrefix: "catalog-install-ordered",
    addImportTag: true,
    importTag: " catalog:ordered ",
    removeTags: ["legacy"],
  };
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("FROM sync.catalog_package_install_idempotency")) {
        return createQueryResult([]);
      }
      if (text.includes("FROM catalog.package_versions AS package_versions")) {
        return createQueryResult([{
          ...createPackageInstallVersionRow("published"),
          card_count: 3,
        } as unknown as Row]);
      }
      if (text.includes("FROM catalog.package_media_assets")) {
        return createQueryResult([]);
      }
      if (text.includes("FROM catalog.package_cards")) {
        assert.match(text, /ORDER BY ordinal ASC, package_card_id ASC/);
        return createQueryResult(packageCards.map((card) => card as unknown as Row));
      }
      if (text.includes("FROM sync.workspace_replicas")) {
        return createQueryResult([{ ok: 1 } as unknown as Row]);
      }
      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        return createQueryResult([]);
      }
      if (text.includes("FROM sync.workspace_sync_metadata") && text.includes("FOR UPDATE")) {
        return createQueryResult([{ workspace_id: testWorkspaceId } as unknown as Row]);
      }
      if (text.includes("metadata->'source'->>'importId'")) {
        return createQueryResult([]);
      }
      if (text.includes("operation_conflicts")) {
        assert.deepEqual(params, [
          testWorkspaceId,
          [
            "catalog-install-ordered:card:0",
            "catalog-install-ordered:card:1",
            "catalog-install-ordered:card:2",
          ],
        ]);
        return createQueryResult([]);
      }
      if (text.includes("INSERT INTO content.cards")) {
        insertedCards.push(params);
        return createQueryResult([]);
      }
      if (text.includes("INSERT INTO sync.hot_changes")) {
        return createQueryResult([{ change_id: insertedCards.length } as unknown as Row]);
      }
      if (text.includes("INSERT INTO sync.catalog_package_install_idempotency")) {
        return createQueryResult([]);
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

  assert.deepEqual(insertedCards.map((params) => params[2]), ["First", "Second", "Third"]);
  assert.deepEqual(insertedCards.map((params) => params[6]), [
    ["keep", "catalog:ordered"],
    ["catalog:ordered"],
    ["keep", "catalog:ordered"],
  ]);
  assert.deepEqual(insertedCards.map((params) => params[7]), [
    "2026-04-19T10:29:59.998Z",
    "2026-04-19T10:29:59.999Z",
    testInstallTimestamp,
  ]);
  const metadata = insertedCards.map((params) => JSON.parse(String(params[5])) as {
    source: { createdAt: string; importedAt: string };
  });
  assert.deepEqual(metadata.map((value) => value.source.createdAt), [
    "2025-01-02T03:04:05.000Z",
    testTimestamp,
    testTimestamp,
  ]);
  assert.deepEqual(metadata.map((value) => value.source.importedAt), [
    testInstallTimestamp,
    testInstallTimestamp,
    testInstallTimestamp,
  ]);
  assert.deepEqual(result.installedCards.map((card) => card.stableCardKey), ["first", "second", "third"]);
  assert.deepEqual(result.summary, {
    cardCount: 3,
    mediaAssetCount: 0,
    installId: "catalog-install-ordered",
    installedAt: testInstallTimestamp,
    keptTagCount: 1,
    removedTagCount: 1,
    importTag: "catalog:ordered",
  });
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

test("catalog install rejects unknown removed tags before workspace writes", async () => {
  const queries: Array<string> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      _params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push(text);
      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        return createQueryResult([]);
      }
      if (text.includes("FROM sync.workspace_sync_metadata") && text.includes("FOR UPDATE")) {
        return createQueryResult([{ workspace_id: testWorkspaceId } as unknown as Row]);
      }
      if (text.includes("FROM sync.catalog_package_install_idempotency")) {
        return createQueryResult([]);
      }
      if (text.includes("FROM catalog.package_versions AS package_versions")) {
        return createQueryResult([createPackageInstallVersionRow("published") as unknown as Row]);
      }
      if (text.includes("FROM catalog.package_media_assets")) {
        return createQueryResult([]);
      }
      if (text.includes("FROM catalog.package_cards")) {
        return createQueryResult([{
          package_card_id: testWorkspaceCardId,
          stable_card_key: "source-tag-card",
          ordinal: 1,
          front_text: "Prompt",
          back_text: "Answer",
          card_type: "basic",
          metadata: { version: 1, source: null },
          tags: ["language"],
          media_asset_keys: [],
        } as unknown as Row]);
      }

      throw new Error(`Unexpected query after tag validation: ${text}`);
    },
  };

  await assert.rejects(
    installCatalogPackageVersionInExecutor(
      executor,
      testWorkspaceId,
      testPackageVersionId,
      {
        installId: "catalog-install-unknown-tag",
        installedAt: testInstallTimestamp,
        clientUpdatedAt: testInstallTimestamp,
        lastModifiedByReplicaId: testWorkspaceReplicaId,
        operationIdPrefix: "catalog-install-unknown-tag",
        addImportTag: false,
        importTag: "",
        removeTags: ["missing"],
      },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "CATALOG_PACKAGE_INSTALL_INVALID_INPUT");
      assert.match(error.message, /unknownTags=missing/);
      return true;
    },
  );
  assert.equal(queries.some((query) => query.includes("INSERT INTO content.")), false);
  assert.equal(queries.some((query) => query.includes("INSERT INTO sync.hot_changes")), false);
  assert.equal(queries.some((query) => query.includes("INSERT INTO sync.catalog_package_install_idempotency")), false);
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

      if (text.includes("FROM sync.catalog_package_install_idempotency")) {
        assert.deepEqual(params, [testWorkspaceId, installInput.installId]);
        return createQueryResult([]);
      }

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


