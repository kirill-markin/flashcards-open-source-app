import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../../shared/errors";
import { installCatalogPackageVersionInExecutor } from "./index";
import {
  createCatalogPackageInstallReplayExecutor,
  createStoredCatalogPackageInstallResult,
  testInstallTimestamp,
  testPackageVersionId,
  testWorkspaceId,
  testWorkspaceReplicaId,
} from "./installTestSupport";
import type {
  CatalogPackageInstallConfirmInput,
  CatalogPackageInstallResult,
} from "../../types";

test("catalog install rejects stored replay results that violate the published response contract", async () => {
  const installInput: CatalogPackageInstallConfirmInput = {
    installId: "catalog-install-stored-contract",
    installedAt: testInstallTimestamp,
    clientUpdatedAt: testInstallTimestamp,
    lastModifiedByReplicaId: testWorkspaceReplicaId,
    operationIdPrefix: "catalog-install-stored-contract",
  };
  const validResult = createStoredCatalogPackageInstallResult(installInput.installId);
  const invalidResults: ReadonlyArray<Readonly<{ name: string; result: unknown }>> = [
    {
      name: "invalid UUID",
      result: {
        ...validResult,
        packageVersion: {
          ...validResult.packageVersion,
          author: { ...validResult.packageVersion.author, authorId: "not-a-uuid" },
        },
      },
    },
    {
      name: "invalid date-time",
      result: {
        ...validResult,
        packageVersion: { ...validResult.packageVersion, createdAt: "not-a-date-time" },
      },
    },
    {
      name: "nonpositive version number",
      result: {
        ...validResult,
        packageVersion: { ...validResult.packageVersion, versionNumber: 0 },
      },
    },
    {
      name: "negative response count",
      result: {
        ...validResult,
        summary: { ...validResult.summary, cardCount: -1 },
      },
    },
    {
      name: "unrelated package version field",
      result: {
        ...validResult,
        packageVersion: { ...validResult.packageVersion, unrelatedField: true },
      },
    },
  ];

  for (const invalidResult of invalidResults) {
    await assert.rejects(
      installCatalogPackageVersionInExecutor(
        createCatalogPackageInstallReplayExecutor(installInput, invalidResult.result),
        testWorkspaceId,
        testPackageVersionId,
        installInput,
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 500);
        assert.equal(error.code, "CATALOG_PACKAGE_INSTALL_STORED_RESULT_INVALID");
        assert.match(error.message, /cannot be replayed safely/);
        assert.match(error.message, /Repair the catalog install idempotency record/);
        return true;
      },
      invalidResult.name,
    );
  }
});

test("catalog install rejects a contract-valid stored result that mismatches its durable identity", async () => {
  const installInput: CatalogPackageInstallConfirmInput = {
    installId: "catalog-install-stored-identity",
    installedAt: testInstallTimestamp,
    clientUpdatedAt: testInstallTimestamp,
    lastModifiedByReplicaId: testWorkspaceReplicaId,
    operationIdPrefix: "catalog-install-stored-identity",
  };
  const validResult = createStoredCatalogPackageInstallResult(installInput.installId);
  const mismatchedResult: CatalogPackageInstallResult = {
    ...validResult,
    packageVersion: {
      ...validResult.packageVersion,
      packageVersionId: "99999999-9999-4999-8999-999999999999",
      cardCount: 2,
    },
    summary: {
      ...validResult.summary,
      installId: "different-install-id",
      installedAt: "2026-04-19T10:30:01.000Z",
      cardCount: 2,
      mediaAssetCount: 0,
      removedTagCount: 1,
      importTag: "different-import-tag",
    },
  };

  await assert.rejects(
    installCatalogPackageVersionInExecutor(
      createCatalogPackageInstallReplayExecutor(installInput, mismatchedResult),
      testWorkspaceId,
      testPackageVersionId,
      installInput,
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 500);
      assert.equal(error.code, "CATALOG_PACKAGE_INSTALL_STORED_RESULT_INVALID");
      assert.match(error.message, /does not match its durable request identity/);
      assert.match(error.message, /summary\.installId/);
      assert.match(error.message, /packageVersion\.packageVersionId/);
      assert.match(error.message, /summary\.installedAt/);
      assert.match(error.message, /summary\.importTag/);
      assert.match(error.message, /summary\.cardCount/);
      assert.match(error.message, /packageVersion\.cardCount/);
      assert.match(error.message, /summary\.mediaAssetCount/);
      assert.match(error.message, /summary\.removedTagCount/);
      assert.match(error.message, /Repair the catalog install idempotency record/);
      return true;
    },
  );
});
