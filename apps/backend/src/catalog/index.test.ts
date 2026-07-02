import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import { HttpError } from "../shared/errors";
import {
  attachCatalogPackageDraftMediaAssetInExecutor,
  createCatalogPackageDraftInExecutor,
  createCatalogPackageVersionFromWorkspaceSelectionInExecutor,
  installCatalogPackageVersionInExecutor,
  isCatalogPackageVersionStatusTransitionAllowed,
  previewCatalogPackageInstallInExecutor,
  publishCatalogPackageVersionInExecutor,
  updateCatalogPackageDraftInExecutor,
} from ".";
import { createCatalogInstallRoutes } from "../routes/catalogInstall";
import type {
  CatalogPackageMediaAssetRow,
  CatalogPackageRow,
  CatalogPackageStatus,
  CatalogPackageVersionRow,
  CreateCatalogPackageDraftInput,
  UpdateCatalogPackageDraftInput,
} from "./types";

const testPackageId = "11111111-1111-4111-8111-111111111111";
const testAuthorId = "22222222-2222-4222-8222-222222222222";
const testPackageVersionId = "33333333-3333-4333-8333-333333333333";
const testMediaBlobId = "44444444-4444-4444-8444-444444444444";
const testPackageMediaAssetId = "55555555-5555-4555-8555-555555555555";
const testWorkspaceId = "66666666-6666-4666-8666-666666666666";
const testWorkspaceCardId = "77777777-7777-4777-8777-777777777777";
const testWorkspaceMediaAssetId = "88888888-8888-4888-8888-888888888888";
const testSecondWorkspaceMediaAssetId = "99999999-9999-4999-8999-999999999999";
const testWorkspaceReplicaId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const testSecondMediaBlobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const testTimestamp = "2026-04-18T10:00:00.000Z";
const testInstallTimestamp = "2026-04-19T10:30:00.000Z";

const testPackageMediaKey = `w-${testWorkspaceMediaAssetId}`;
const testCollisionSafePackageMediaKey = `${testPackageMediaKey}.1`;
const testSecondPackageMediaKey = `w-${testSecondWorkspaceMediaAssetId}`;

function createQueryResult<Row extends pg.QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

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

test("catalog migration defines blob-backed media and published-version immutability", () => {
  const migrationPath = resolve(process.cwd(), "../../db/migrations/0083_catalog_kernel.sql");
  const migrationSql = readFileSync(migrationPath, "utf8");
  const mediaAssetTableSql = migrationSql.slice(
    migrationSql.indexOf("CREATE TABLE IF NOT EXISTS catalog.package_media_assets"),
    migrationSql.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS idx_package_media_assets_draft_key_unique"),
  );

  assert.match(migrationSql, /CREATE SCHEMA IF NOT EXISTS catalog;/);
  assert.match(migrationSql, /'draft'/);
  assert.match(migrationSql, /'needs_changes'/);
  assert.match(migrationSql, /'published'/);
  assert.match(migrationSql, /REFERENCES content\.media_blobs\(media_blob_id\)/);
  assert.doesNotMatch(mediaAssetTableSql, /\bstorage_key\b/);
  assert.doesNotMatch(mediaAssetTableSql, /\bsha256\b/);
  assert.match(migrationSql, /prevent_published_package_version_update/);
  assert.match(migrationSql, /package_cards_published_immutable/);
  assert.match(migrationSql, /package_media_assets_published_immutable/);
  assert.match(migrationSql, /IF TG_OP = 'INSERT' THEN/);
  assert.match(migrationSql, /IF TG_OP = 'UPDATE' THEN/);
  assert.match(migrationSql, /IF TG_OP = 'DELETE' THEN/);
  assert.doesNotMatch(migrationSql, /TG_OP IN \('UPDATE', 'DELETE'\) AND OLD/);
  assert.doesNotMatch(migrationSql, /TG_OP IN \('INSERT', 'UPDATE'\) AND NEW/);
  assert.match(
    migrationSql,
    /OLD\.status IN \('published', 'delisted'\)\s+OR NEW\.status IN \('published', 'delisted'\)/,
  );
  assert.match(
    migrationSql,
    /OLD\.status IN \('published', 'delisted'\)\s+AND NEW\.published_at IS DISTINCT FROM OLD\.published_at/,
  );
});

test("catalog package version status transitions are explicit", () => {
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("draft", "submitted"), true);
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("submitted", "approved"), true);
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("approved", "published"), true);
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("published", "delisted"), true);
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("draft", "published"), false);
  assert.equal(isCatalogPackageVersionStatusTransitionAllowed("delisted", "published"), false);
});

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
  assert.deepEqual(versionMediaInsertParams, [
    [testPackageId, testPackageVersionId, testCollisionSafePackageMediaKey, testMediaBlobId],
    [testPackageId, testPackageVersionId, testSecondPackageMediaKey, testSecondMediaBlobId],
  ]);
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
