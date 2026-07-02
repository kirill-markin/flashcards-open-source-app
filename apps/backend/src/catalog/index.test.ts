import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../database";
import type { AppEnv } from "../server/app";
import { HttpError } from "../shared/errors";
import {
  attachCatalogPackageDraftMediaAssetInExecutor,
  createCatalogPackageDraftInExecutor,
  createCatalogPackageVersionFromWorkspaceSelectionInExecutor,
  installCatalogPackageVersionInExecutor,
  isCatalogPackageVersionStatusTransitionAllowed,
  listPublicCatalogPackagesInExecutor,
  loadPublicCatalogPackageDetailInExecutor,
  loadPublicCatalogPackageMediaForDownloadInExecutor,
  loadPublicCatalogPackageVersionCardPreviewInExecutor,
  previewCatalogPackageInstallInExecutor,
  publishCatalogPackageVersionInExecutor,
  updateCatalogPackageDraftInExecutor,
} from ".";
import { createCatalogInstallRoutes } from "../routes/catalogInstall";
import { createCatalogPublicRoutes } from "../routes/catalogPublic";
import type {
  CatalogPackageMediaAssetRow,
  CatalogPackageRow,
  CatalogPackageStatus,
  CatalogPackageVersionRow,
  CatalogPublicPackageMediaDownloadSource,
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

const testPackageMediaKey = "media-1";
const testCollisionSafePackageMediaKey = `${testPackageMediaKey}.1`;
const testSecondPackageMediaKey = "media-2";
const legacyPrivateWorkspacePackageMediaKey = `w-${testWorkspaceMediaAssetId}`;
const unsafeShaPackageMediaKey = "a".repeat(64);
const unsafeStorageKeyLikePackageMediaKey = `media.blobs.sha256.aa.aa.${unsafeShaPackageMediaKey}`;
const unsafeStorageKeyPathDestination = `media/blobs/sha256/aa/aa/${unsafeShaPackageMediaKey}`;
const unsafeDoubleEncodedStorageKeyPathDestination = encodeURIComponent(encodeURIComponent(
  unsafeStorageKeyPathDestination,
));
const unsafePublicPackageMediaKeyFixtures = [
  ["legacy workspace-derived", legacyPrivateWorkspacePackageMediaKey],
  ["uuid-shaped", testWorkspaceMediaAssetId],
  ["sha-shaped", unsafeShaPackageMediaKey],
  ["storage-key-shaped", unsafeStorageKeyLikePackageMediaKey],
] as const;
const unsafeMarkdownDestinationFixtures = [
  ["malformed fcasset storage path", `fcasset:${unsafeStorageKeyPathDestination}`],
  ["storage path", unsafeStorageKeyPathDestination],
  ["rooted storage path", `/${unsafeStorageKeyPathDestination}`],
  ["absolute storage URL", `https://bucket.s3.amazonaws.com/${unsafeStorageKeyPathDestination}`],
  ["storage path with query", `${unsafeStorageKeyPathDestination}?download=1`],
  ["storage path with fragment", `${unsafeStorageKeyPathDestination}#preview`],
  ["percent-encoded storage path", `media%2Fblobs%2Fsha256%2Faa%2Faa%2F${unsafeShaPackageMediaKey}`],
  ["double-encoded storage path", unsafeDoubleEncodedStorageKeyPathDestination],
  ["double-encoded absolute storage URL", `https://bucket.s3.amazonaws.com/${unsafeDoubleEncodedStorageKeyPathDestination}`],
  ["sha handle path", `sha256-${unsafeShaPackageMediaKey}`],
] as const;
const unsafeMarkdownVisibleTextFixtures = [
  ["raw storage path", `Prompt ${unsafeStorageKeyPathDestination}`],
  ["raw sha handle", `Prompt sha256-${unsafeShaPackageMediaKey}`],
  ["raw unsafe fcasset reference", `Prompt fcasset:${legacyPrivateWorkspacePackageMediaKey}`],
  ["storage autolink", `Prompt <https://bucket.s3.amazonaws.com/${unsafeStorageKeyPathDestination}>`],
  ["malformed storage link tail", `Prompt ![unsafe](${unsafeStorageKeyPathDestination}`],
  ["malformed fcasset link tail", `Prompt [unsafe](fcasset:${legacyPrivateWorkspacePackageMediaKey}`],
  ["raw percent-encoded storage path", `Prompt media%2Fblobs%2Fsha256%2Faa%2Faa%2F${unsafeShaPackageMediaKey}`],
] as const;
const unsafePublicMetadataFixtures = [
  ["summary storage path", { summary: `Summary ${unsafeStorageKeyPathDestination}` }],
  ["description raw hash", { description: `Description ${unsafeShaPackageMediaKey}` }],
  ["language tag private fcasset", { language_tags: ["en", `fcasset:${legacyPrivateWorkspacePackageMediaKey}`] }],
  ["topic tag storage path", { topic_tags: ["language", unsafeStorageKeyPathDestination] }],
  ["license raw hash", { license: `License ${unsafeShaPackageMediaKey}` }],
  ["author bio private fcasset", { author_bio: `Bio fcasset:${legacyPrivateWorkspacePackageMediaKey}` }],
  ["author website storage path", { author_website_url: `https://example.com/${unsafeStorageKeyPathDestination}` }],
] as const;
const unsafePublicMediaMetadataFixtures = [
  ["media alt text storage path", { alt_text: `Alt ${unsafeStorageKeyPathDestination}` }],
  ["media credit raw hash", { credit: `Credit ${unsafeShaPackageMediaKey}` }],
  ["media license private fcasset", { license: `fcasset:${legacyPrivateWorkspacePackageMediaKey}` }],
] as const;

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

function createPublicPackageRow(): Readonly<Record<string, unknown>> {
  return {
    package_id: testPackageId,
    author_id: testAuthorId,
    author_slug: "open-authors",
    author_display_name: "Open Authors",
    author_bio: null,
    author_website_url: "https://example.com",
    package_version_id: testPackageVersionId,
    version_number: 1,
    status: "published",
    slug: "spanish-basics",
    title: "Spanish Basics",
    summary: "Core Spanish prompts.",
    description: "Core Spanish flashcards for beginners.",
    language_tags: ["en", "es"],
    topic_tags: ["language"],
    license: "CC-BY-4.0",
    content_warning: null,
    cover_package_media_key: "cover",
    card_count: 1,
    updated_at: testTimestamp,
    published_at: testTimestamp,
  };
}

function createPublicMediaAssetRow(): Readonly<Record<string, unknown>> {
  return {
    package_version_id: testPackageVersionId,
    package_media_key: "cover",
    alt_text: "Cover image",
    credit: null,
    license: "CC-BY-4.0",
    mime_type: "image/jpeg",
    size_bytes: 1234,
    sha256: unsafeShaPackageMediaKey,
  };
}

function assertPublicPayloadDoesNotContainUnsafeMediaReferences(payload: unknown): void {
  const payloadJson = JSON.stringify(payload);
  const normalizedPayloadJson = payloadJson.toLowerCase();
  assert.doesNotMatch(payloadJson, new RegExp(testWorkspaceMediaAssetId, "i"));
  assert.doesNotMatch(payloadJson, new RegExp(testSecondWorkspaceMediaAssetId, "i"));
  assert.doesNotMatch(payloadJson, /media[/._-]blobs[/._-]sha256/i);
  assert.equal(normalizedPayloadJson.includes(unsafeShaPackageMediaKey), false);
  assert.equal(normalizedPayloadJson.includes(unsafeStorageKeyLikePackageMediaKey), false);
}

function createPublicCatalogRouteTestApp(route: Hono<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    context.set("clientAppVersion", null);
    context.set("clientPlatform", null);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({ error: error.message, code: error.code });
    }

    context.status(500);
    return context.json({ error: "internal" });
  });
  app.route("/", route);
  return app;
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

test("public catalog media download lookup authorizes by package media key and keeps storage internal", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      assert.match(text, /media_assets\.package_version_id = \$1/);
      assert.match(text, /media_assets\.package_media_key = \$2/);
      assert.match(text, /versions\.status = 'published'/);
      assert.match(text, /packages\.status = 'published'/);
      assert.match(text, /media_blobs\.sha256 AS sha256/);
      assert.deepEqual(params, [testPackageVersionId, "cover"]);
      return createQueryResult([{
        ...createPublicMediaAssetRow(),
        storage_key: realisticBlobStorageKey,
        sha256: realisticBlobSha256,
      } as unknown as Row]);
    },
  };

  const mediaDownloadSource = await loadPublicCatalogPackageMediaForDownloadInExecutor(
    executor,
    testPackageVersionId,
    "cover",
  );

  assert.equal(mediaDownloadSource.storageKey, realisticBlobStorageKey);
  assert.equal(mediaDownloadSource.sha256, realisticBlobSha256);
  assert.deepEqual(mediaDownloadSource.mediaAsset, {
    packageVersionId: testPackageVersionId,
    packageMediaKey: "cover",
    altText: "Cover image",
    credit: null,
    license: "CC-BY-4.0",
    mimeType: "image/jpeg",
    sizeBytes: 1234,
    downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
  });
  assert.doesNotMatch(JSON.stringify(mediaDownloadSource.mediaAsset), /mediaBlobId|storageKey|storage_key|sha256/);
});

for (const [unsafeKeyLabel, unsafePackageMediaKey] of unsafePublicPackageMediaKeyFixtures) {
  test(`public catalog media download lookup rejects ${unsafeKeyLabel} media keys before query`, async () => {
    let queryCount = 0;
    const executor: DatabaseExecutor = {
      async query<Row extends pg.QueryResultRow>(
        _text: string,
        _params: ReadonlyArray<SqlValue>,
      ): Promise<pg.QueryResult<Row>> {
        queryCount += 1;
        throw new Error("Unsafe public package media keys should be rejected before query");
      },
    };

    await assert.rejects(
      loadPublicCatalogPackageMediaForDownloadInExecutor(
        executor,
        testPackageVersionId,
        unsafePackageMediaKey,
      ),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        assert.equal((error as HttpError).statusCode, 409);
        assert.equal((error as HttpError).code, "CATALOG_PUBLIC_MEDIA_KEY_NOT_PUBLIC");
        assertPublicPayloadDoesNotContainUnsafeMediaReferences({ error: (error as HttpError).message });
        return true;
      },
    );
    assert.equal(queryCount, 0);
  });
}

test("public catalog media download URL route returns only a backend API URL without storage internals", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  const oldLeakySignedS3Url = `https://media-bucket.s3.amazonaws.com/${realisticBlobStorageKey}?X-Amz-Signature=abc`;
  let requestedPackageMediaKey: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 1234,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      assert.equal(packageVersionId, testPackageVersionId);
      requestedPackageMediaKey = packageMediaKey;
      return mediaDownloadSource;
    },
  }));

  const response = await app.request(
    `http://localhost:8080/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
  );
  const payload = await response.json() as Readonly<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(requestedPackageMediaKey, "cover");
  const payloadJson = JSON.stringify(payload);
  assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId|sha256/);
  assert.doesNotMatch(payloadJson, new RegExp(realisticBlobSha256));
  assert.doesNotMatch(payloadJson, new RegExp(oldLeakySignedS3Url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(payload, {
    mediaAsset: mediaDownloadSource.mediaAsset,
    download: {
      method: "GET",
      url: `http://localhost:8080/v1/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
      expiresAt: null,
      rangeRequests: false,
    },
  });
});

test("public catalog media routes reject unsafe media keys without echoing private values", async () => {
  let lookupCount = 0;
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async () => {
      lookupCount += 1;
      throw new Error("Private workspace-derived package media keys should be rejected before lookup");
    },
  }));

  for (const [, unsafePackageMediaKey] of unsafePublicPackageMediaKeyFixtures) {
    for (const routeSuffix of ["download-url", "download"]) {
      const response = await app.request(
        `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/${unsafePackageMediaKey}/${routeSuffix}`,
      );
      const payload = await response.json() as Readonly<Record<string, unknown>>;

      assert.equal(response.status, 400);
      assert.equal(payload.code, "CATALOG_PUBLIC_PARAM_INVALID");
      assertPublicPayloadDoesNotContainUnsafeMediaReferences(payload);
    }
  }
  assert.equal(lookupCount, 0);
});

test("public catalog media download route serves bytes through the backend", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  let loadedStorageKey: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "cover");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async (input) => {
      loadedStorageKey = input.storageKey;
      assert.equal(input.workspaceId, testPackageVersionId);
      assert.equal(input.mediaAssetId, "cover");
      assert.equal(input.mimeType, "image/jpeg");
      assert.equal(input.sizeBytes, 3);
      assert.equal(input.sha256, realisticBlobSha256);
      return {
        bytes: Buffer.from([1, 2, 3]),
        mimeType: "image/jpeg",
        sizeBytes: 3,
        sha256: realisticBlobSha256,
      };
    },
  }));

  const response = await app.request(
    `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
  );

  assert.equal(response.status, 200);
  assert.equal(loadedStorageKey, realisticBlobStorageKey);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("content-length"), "3");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([1, 2, 3]));
});

test("public catalog media download route serves supported non-image bytes through the backend", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  let loadedMimeType: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "guide",
      altText: "PDF guide",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "application/pdf",
      sizeBytes: 4,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/guide/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "guide");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async (input) => {
      loadedMimeType = input.mimeType;
      assert.equal(input.sha256, realisticBlobSha256);
      return {
        bytes: Buffer.from([0x25, 0x50, 0x44, 0x46]),
        mimeType: "application/pdf",
        sizeBytes: 4,
        sha256: realisticBlobSha256,
      };
    },
  }));

  const response = await app.request(
    `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/guide/download`,
  );

  assert.equal(response.status, 200);
  assert.equal(loadedMimeType, "application/pdf");
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0x25, 0x50, 0x44, 0x46]));
});

test("public catalog media routes reject unsupported MIME types before download", async () => {
  const realisticBlobStorageKey = "media/blobs/sha256/aa/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let lookupCount = 0;
  let bytesLoaded = false;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "notes",
      altText: "Notes",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "text/plain",
      sizeBytes: 4,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/notes/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: "a".repeat(64),
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      lookupCount += 1;
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "notes");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async () => {
      bytesLoaded = true;
      throw new Error("Unsupported public catalog media should fail before object byte load");
    },
  }));

  for (const routeSuffix of ["download-url", "download"]) {
    const response = await app.request(
      `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/notes/${routeSuffix}`,
    );
    const payload = await response.json() as Readonly<Record<string, unknown>>;
    const payloadJson = JSON.stringify(payload);

    assert.equal(response.status, 415);
    assert.equal(payload.code, "CATALOG_PUBLIC_MEDIA_DOWNLOAD_UNSUPPORTED_TYPE");
    assert.match(String(payload.error), /mimeType=text\/plain/);
    assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId|sha256/);
  }
  assert.equal(lookupCount, 2);
  assert.equal(bytesLoaded, false);
});

test("public catalog media download route rejects hash mismatches without exposing hashes", async () => {
  const realisticBlobSha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const realisticBlobStorageKey = `media/blobs/sha256/aa/aa/${realisticBlobSha256}`;
  let receivedSha256: string | null = null;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: realisticBlobSha256,
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async () => mediaDownloadSource,
    loadMediaAssetObjectBytesFn: async (input) => {
      receivedSha256 = input.sha256;
      throw new HttpError(
        409,
        "Media asset object bytes do not match expected metadata workspaceId=public mediaAssetId=cover mismatchedFields=sha256",
        "MEDIA_ASSET_OBJECT_BYTES_MISMATCH",
      );
    },
  }));

  const response = await app.request(
    `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download`,
  );
  const payload = await response.json() as Readonly<Record<string, unknown>>;
  const payloadJson = JSON.stringify(payload);

  assert.equal(response.status, 409);
  assert.equal(receivedSha256, realisticBlobSha256);
  assert.equal(payload.code, "MEDIA_ASSET_OBJECT_BYTES_MISMATCH");
  assert.doesNotMatch(payloadJson, new RegExp(realisticBlobSha256));
  assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId/);
});

test("public catalog media routes reject objects too large for backend proxy delivery", async () => {
  const realisticBlobStorageKey = "media/blobs/sha256/aa/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let lookupCount = 0;
  let bytesLoaded = false;
  const mediaDownloadSource: CatalogPublicPackageMediaDownloadSource = {
    mediaAsset: {
      packageVersionId: testPackageVersionId,
      packageMediaKey: "cover",
      altText: "Cover image",
      credit: null,
      license: "CC-BY-4.0",
      mimeType: "image/jpeg",
      sizeBytes: 4_500_001,
      downloadUrlPath: `/catalog/package-versions/${testPackageVersionId}/media-assets/cover/download-url`,
    },
    storageKey: realisticBlobStorageKey,
    sha256: "a".repeat(64),
  };
  const app = createPublicCatalogRouteTestApp(createCatalogPublicRoutes({
    loadPublicCatalogPackageMediaForDownloadFn: async (packageVersionId, packageMediaKey) => {
      lookupCount += 1;
      assert.equal(packageVersionId, testPackageVersionId);
      assert.equal(packageMediaKey, "cover");
      return mediaDownloadSource;
    },
    loadMediaAssetObjectBytesFn: async () => {
      bytesLoaded = true;
      throw new Error("Oversized public catalog media should fail before object byte load");
    },
  }));

  for (const routeSuffix of ["download-url", "download"]) {
    const response = await app.request(
      `http://localhost/catalog/package-versions/${testPackageVersionId}/media-assets/cover/${routeSuffix}`,
    );
    const payload = await response.json() as Readonly<Record<string, unknown>>;
    const payloadJson = JSON.stringify(payload);

    assert.equal(response.status, 413);
    assert.equal(payload.code, "CATALOG_PUBLIC_MEDIA_DOWNLOAD_TOO_LARGE");
    assert.match(String(payload.error), /maxBytes=4500000/);
    assert.doesNotMatch(payloadJson, /media\/blobs|storageKey|storage_key|mediaBlobId|sha256/);
  }
  assert.equal(lookupCount, 2);
  assert.equal(bytesLoaded, false);
});
