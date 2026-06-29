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
  isCatalogPackageVersionStatusTransitionAllowed,
  publishCatalogPackageVersionInExecutor,
  updateCatalogPackageDraftInExecutor,
} from ".";
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
const testTimestamp = "2026-04-18T10:00:00.000Z";

const managedMediaReferenceExamples: ReadonlyArray<Readonly<{
  name: string;
  frontText: string;
  backText: string;
  expectedField: "frontText" | "backText";
}>> = [
  {
    name: "UUID refs",
    frontText: "Question",
    backText: `![audio](fcasset:${testMediaBlobId})`,
    expectedField: "backText",
  },
  {
    name: "non-UUID refs",
    frontText: "![image](fcasset:image-asset)",
    backText: "Answer",
    expectedField: "frontText",
  },
  {
    name: "URL-like refs",
    frontText: "Question",
    backText: `![audio](FCASSET://${testMediaBlobId}?download=1)`,
    expectedField: "backText",
  },
];

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

for (const example of managedMediaReferenceExamples) {
  test(`workspace-selected catalog versions reject managed media references in ${example.name}`, async () => {
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
            front_text: example.frontText,
            back_text: example.backText,
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
        assert.equal((error as HttpError).code, "CATALOG_WORKSPACE_CARD_MEDIA_REFERENCE_UNSUPPORTED");
        assert.match((error as HttpError).message, new RegExp(`cardId=${testWorkspaceCardId}`));
        assert.match((error as HttpError).message, new RegExp(`field=${example.expectedField}`));
        return true;
      },
    );
    assert.equal(queries.length, 2);
  });
}
