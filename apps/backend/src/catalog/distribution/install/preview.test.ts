import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../../database";
import { HttpError } from "../../../shared/errors";
import {
  installCatalogPackageVersionInExecutor,
  previewCatalogPackageInstallInExecutor,
} from "./index";
import {
  createPackageInstallVersionRow,
  testInstallTimestamp,
  testPackageVersionId,
  testWorkspaceId,
  testWorkspaceReplicaId,
} from "./installTestSupport";
import { createQueryResult } from "../../testSupport";

test("catalog install preview exposes source tag counts and ZIP-compatible default options", async () => {
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      assert.deepEqual(params, [testPackageVersionId]);
      if (text.includes("FROM catalog.package_versions AS package_versions")) {
        return createQueryResult([{
          ...createPackageInstallVersionRow("published"),
          card_count: 2,
        } as unknown as Row]);
      }
      if (text.includes("COUNT(*) AS media_asset_count")) {
        return createQueryResult([{ media_asset_count: 0 } as unknown as Row]);
      }
      if (text.includes("SELECT tags") && text.includes("FROM catalog.package_cards")) {
        assert.match(text, /ORDER BY ordinal ASC, package_card_id ASC/);
        return createQueryResult([
          { tags: ["language", "legacy"] } as unknown as Row,
          { tags: ["language"] } as unknown as Row,
        ]);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const preview = await previewCatalogPackageInstallInExecutor(
    executor,
    testPackageVersionId,
    {
      generatedAt: testInstallTimestamp,
      existingWorkspaceTags: ["", "import:2026-04-19-0"],
    },
  );

  assert.deepEqual(preview.tagCounts, [
    { tag: "language", cardsCount: 2 },
    { tag: "legacy", cardsCount: 1 },
  ]);
  assert.deepEqual(preview.defaultOptions, {
    addImportTag: true,
    suggestedImportTag: "import:2026-04-19-1",
    keptTags: ["language", "legacy"],
    removedTags: [],
  });
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
    previewCatalogPackageInstallInExecutor(
      previewExecutor,
      testPackageVersionId,
      {
        generatedAt: testInstallTimestamp,
        existingWorkspaceTags: [],
      },
    ),
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
      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        return createQueryResult([]);
      }
      if (text.includes("FROM sync.workspace_sync_metadata") && text.includes("FOR UPDATE")) {
        return createQueryResult([{ workspace_id: testWorkspaceId } as unknown as Row]);
      }
      if (text.includes("FROM sync.catalog_package_install_idempotency")) {
        return createQueryResult([]);
      }
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


