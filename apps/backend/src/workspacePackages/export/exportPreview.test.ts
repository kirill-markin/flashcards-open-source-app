import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import { HttpError } from "../../shared/errors";
import {
  previewWorkspacePackageExportInExecutor,
  type WorkspacePackageExportPreviewInput,
} from "./exportPreview";

type TestCardRow = Readonly<{
  card_id: string;
  workspace_id: string;
  front_text: string;
  back_text: string;
  tags: ReadonlyArray<string>;
  created_at: string;
  deleted_at: string | null;
}>;

type TestMediaAssetRow = Readonly<{
  media_asset_id: string;
  workspace_id: string;
  media_blob_id: string;
  size_bytes: number;
  deleted_at: string | null;
}>;

type QueryRecord = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

type TestExecutorHarness = Readonly<{
  executor: DatabaseExecutor;
  queries: ReadonlyArray<QueryRecord>;
}>;

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const cardIdA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const cardIdB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const cardIdC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const cardIdD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const mediaAssetIdA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const mediaAssetIdB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const mediaAssetIdC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const mediaAssetIdD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const mediaAssetIdE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5";
const mediaBlobIdA = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const mediaBlobIdB = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const generatedAt = "2026-06-30T12:00:00.000Z";

function createBasePreviewInput(
  selection: WorkspacePackageExportPreviewInput["selection"],
): WorkspacePackageExportPreviewInput {
  return {
    selection,
    tagPolicy: {
      additionalRemovedTags: [],
    },
    packageMetadata: {
      label: null,
      author: null,
      comment: null,
      createdAt: null,
      sourceUrl: null,
    },
    generatedAt,
  };
}

function createCardRow(
  cardId: string,
  cardWorkspaceId: string,
  frontText: string,
  backText: string,
  tags: ReadonlyArray<string>,
  createdAt: string,
  deletedAt: string | null,
): TestCardRow {
  return {
    card_id: cardId,
    workspace_id: cardWorkspaceId,
    front_text: frontText,
    back_text: backText,
    tags,
    created_at: createdAt,
    deleted_at: deletedAt,
  };
}

function createMediaAssetRow(
  mediaAssetId: string,
  mediaWorkspaceId: string,
  mediaBlobId: string,
  sizeBytes: number,
  deletedAt: string | null,
): TestMediaAssetRow {
  return {
    media_asset_id: mediaAssetId,
    workspace_id: mediaWorkspaceId,
    media_blob_id: mediaBlobId,
    size_bytes: sizeBytes,
    deleted_at: deletedAt,
  };
}

function createQueryResult<Row extends pg.QueryResultRow>(
  rows: ReadonlyArray<Row>,
): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function requireStringParam(params: ReadonlyArray<SqlValue>, index: number): string {
  const value = params[index];
  if (typeof value !== "string") {
    throw new Error(`Expected string query parameter at index ${index}`);
  }

  return value;
}

function requireNumberParam(params: ReadonlyArray<SqlValue>, index: number): number {
  const value = params[index];
  if (typeof value !== "number") {
    throw new Error(`Expected number query parameter at index ${index}`);
  }

  return value;
}

function requireStringArrayParam(params: ReadonlyArray<SqlValue>, index: number): ReadonlyArray<string> {
  const value = params[index];
  if (Array.isArray(value) === false || value.some((item) => typeof item !== "string")) {
    throw new Error(`Expected string array query parameter at index ${index}`);
  }

  return value;
}

function compareCardsForPreview(left: TestCardRow, right: TestCardRow): number {
  const createdAtDifference = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return left.card_id.localeCompare(right.card_id);
}

function cardHasAnyTag(card: TestCardRow, tags: ReadonlyArray<string>): boolean {
  return card.tags.some((tag) => tags.includes(tag));
}

function filterCardRows(
  text: string,
  params: ReadonlyArray<SqlValue>,
  cards: ReadonlyArray<TestCardRow>,
): ReadonlyArray<TestCardRow> {
  const requestedWorkspaceId = requireStringParam(params, 0);
  const limit = requireNumberParam(params, params.length - 1);
  const activeCards = cards.filter((card) => (
    card.workspace_id === requestedWorkspaceId
    && card.deleted_at === null
  ));

  if (text.includes("card_id = ANY($2::uuid[])")) {
    const cardIds = requireStringArrayParam(params, 1);
    return cardIds
      .flatMap((cardId) => activeCards.filter((card) => card.card_id === cardId))
      .slice(0, limit);
  }

  let nextFilterParamIndex = 1;
  const includeTags = text.includes("AND tags &&")
    ? requireStringArrayParam(params, nextFilterParamIndex)
    : [];
  nextFilterParamIndex += includeTags.length === 0 ? 0 : 1;
  const excludeTags = text.includes("AND NOT (tags &&")
    ? requireStringArrayParam(params, nextFilterParamIndex)
    : [];

  return activeCards
    .filter((card) => includeTags.length === 0 || cardHasAnyTag(card, includeTags))
    .filter((card) => excludeTags.length === 0 || cardHasAnyTag(card, excludeTags) === false)
    .sort(compareCardsForPreview)
    .slice(0, limit);
}

function filterMediaRows(
  params: ReadonlyArray<SqlValue>,
  mediaAssets: ReadonlyArray<TestMediaAssetRow>,
): ReadonlyArray<Pick<TestMediaAssetRow, "media_asset_id" | "media_blob_id" | "size_bytes">> {
  const requestedWorkspaceId = requireStringParam(params, 0);
  const mediaAssetIds = requireStringArrayParam(params, 1);
  const activeAssets = mediaAssets.filter((mediaAsset) => (
    mediaAsset.workspace_id === requestedWorkspaceId
    && mediaAsset.deleted_at === null
  ));

  return mediaAssetIds.flatMap((mediaAssetId) => (
    activeAssets
      .filter((mediaAsset) => mediaAsset.media_asset_id === mediaAssetId)
      .map((mediaAsset) => ({
        media_asset_id: mediaAsset.media_asset_id,
        media_blob_id: mediaAsset.media_blob_id,
        size_bytes: mediaAsset.size_bytes,
      }))
  ));
}

function createTestExecutor(
  cards: ReadonlyArray<TestCardRow>,
  mediaAssets: ReadonlyArray<TestMediaAssetRow>,
): TestExecutorHarness {
  const queries: Array<QueryRecord> = [];
  const executor: DatabaseExecutor = {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      queries.push({ text, params });

      if (text.includes("FROM content.cards")) {
        return createQueryResult(filterCardRows(text, params, cards) as unknown as ReadonlyArray<Row>);
      }

      if (text.includes("FROM content.media_assets AS media_assets")) {
        return createQueryResult(filterMediaRows(params, mediaAssets) as unknown as ReadonlyArray<Row>);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };

  return {
    executor,
    queries,
  };
}

test("preview selects all active workspace cards and defaults package metadata", async () => {
  const { executor } = createTestExecutor([
    createCardRow(cardIdA, workspaceId, "A", "A answer", ["geography", "shared"], "2026-06-01T00:00:00.000Z", null),
    createCardRow(cardIdB, workspaceId, "B", "B answer", ["shared", "import:2026-06-01-0"], "2026-06-02T00:00:00.000Z", null),
    createCardRow(cardIdC, workspaceId, "C", "C answer", ["deleted"], "2026-06-03T00:00:00.000Z", "2026-06-04T00:00:00.000Z"),
    createCardRow(cardIdD, otherWorkspaceId, "D", "D answer", ["other"], "2026-06-04T00:00:00.000Z", null),
  ], []);

  const preview = await previewWorkspacePackageExportInExecutor(
    executor,
    workspaceId,
    createBasePreviewInput({ kind: "allActiveCards" }),
    { maxSelectedCards: 10 },
  );

  assert.equal(preview.selectedCardCount, 2);
  assert.deepEqual(preview.availableTagCounts, [
    { tag: "shared", cardsCount: 2 },
    { tag: "geography", cardsCount: 1 },
    { tag: "import:2026-06-01-0", cardsCount: 1 },
  ]);
  assert.deepEqual(preview.tagsSelectedForRemoval, [
    { tag: "import:2026-06-01-0", cardsCount: 1 },
  ]);
  assert.equal(preview.referencedMediaCount, 0);
  assert.equal(preview.approximateReferencedMediaBytes, 0);
  assert.deepEqual(preview.defaultPackageMetadata, {
    label: "Workspace export",
    createdAt: generatedAt,
  });
});

test("preview selects explicit active card ids", async () => {
  const { executor } = createTestExecutor([
    createCardRow(cardIdA, workspaceId, "A", "A answer", ["first"], "2026-06-01T00:00:00.000Z", null),
    createCardRow(cardIdB, workspaceId, "B", "B answer", ["second"], "2026-06-02T00:00:00.000Z", null),
    createCardRow(cardIdC, workspaceId, "C", "C answer", ["third"], "2026-06-03T00:00:00.000Z", null),
  ], []);

  const preview = await previewWorkspacePackageExportInExecutor(
    executor,
    workspaceId,
    createBasePreviewInput({
      kind: "explicitCardIds",
      cardIds: [cardIdB, cardIdA],
    }),
    { maxSelectedCards: 10 },
  );

  assert.equal(preview.selectedCardCount, 2);
  assert.deepEqual(preview.availableTagCounts, [
    { tag: "first", cardsCount: 1 },
    { tag: "second", cardsCount: 1 },
  ]);
});

test("preview applies include and exclude tag filters", async () => {
  const { executor } = createTestExecutor([
    createCardRow(cardIdA, workspaceId, "A", "A answer", ["science"], "2026-06-01T00:00:00.000Z", null),
    createCardRow(cardIdB, workspaceId, "B", "B answer", ["science", "draft"], "2026-06-02T00:00:00.000Z", null),
    createCardRow(cardIdC, workspaceId, "C", "C answer", ["history"], "2026-06-03T00:00:00.000Z", null),
  ], []);

  const preview = await previewWorkspacePackageExportInExecutor(
    executor,
    workspaceId,
    createBasePreviewInput({
      kind: "tagFilters",
      includeTags: ["science"],
      excludeTags: ["draft"],
    }),
    { maxSelectedCards: 10 },
  );

  assert.equal(preview.selectedCardCount, 1);
  assert.deepEqual(preview.availableTagCounts, [
    { tag: "science", cardsCount: 1 },
  ]);
});

test("preview adds explicit tag removals to default import tag removals", async () => {
  const { executor } = createTestExecutor([
    createCardRow(cardIdA, workspaceId, "A", "A answer", ["keep", "custom-remove", "import:2026-06-01-0"], "2026-06-01T00:00:00.000Z", null),
  ], []);
  const input = createBasePreviewInput({ kind: "allActiveCards" });

  const preview = await previewWorkspacePackageExportInExecutor(
    executor,
    workspaceId,
    {
      ...input,
      tagPolicy: {
        additionalRemovedTags: ["custom-remove"],
      },
    },
    { maxSelectedCards: 10 },
  );

  assert.deepEqual(preview.tagsSelectedForRemoval, [
    { tag: "custom-remove", cardsCount: 1 },
    { tag: "import:2026-06-01-0", cardsCount: 1 },
  ]);
});

test("preview counts referenced media assets and dedupes approximate bytes by blob metadata", async () => {
  const { executor, queries } = createTestExecutor([
    createCardRow(
      cardIdA,
      workspaceId,
      `![front](fcasset:${mediaAssetIdA})`,
      [
        `![same asset](fcasset:${mediaAssetIdA})`,
        `![same blob](fcasset:${mediaAssetIdB})`,
        `![other blob](fcasset:${mediaAssetIdC})`,
      ].join("\n"),
      ["media"],
      "2026-06-01T00:00:00.000Z",
      null,
    ),
  ], [
    createMediaAssetRow(mediaAssetIdA, workspaceId, mediaBlobIdA, 100, null),
    createMediaAssetRow(mediaAssetIdB, workspaceId, mediaBlobIdA, 100, null),
    createMediaAssetRow(mediaAssetIdC, workspaceId, mediaBlobIdB, 250, null),
  ]);

  const preview = await previewWorkspacePackageExportInExecutor(
    executor,
    workspaceId,
    createBasePreviewInput({ kind: "allActiveCards" }),
    { maxSelectedCards: 10 },
  );

  assert.equal(preview.referencedMediaCount, 3);
  assert.equal(preview.approximateReferencedMediaBytes, 350);
  const mediaQuery = queries.find((query) => query.text.includes("FROM content.media_assets AS media_assets"));
  assert.notEqual(mediaQuery, undefined);
  assert.doesNotMatch(mediaQuery?.text ?? "", /storage_key/);
});

test("preview rejects missing, deleted, or wrong-workspace media assets", async () => {
  const { executor } = createTestExecutor([
    createCardRow(
      cardIdA,
      workspaceId,
      [
        `![missing](fcasset:${mediaAssetIdD})`,
        `![deleted](fcasset:${mediaAssetIdB})`,
        `![wrong workspace](fcasset:${mediaAssetIdE})`,
      ].join("\n"),
      "A answer",
      ["media"],
      "2026-06-01T00:00:00.000Z",
      null,
    ),
  ], [
    createMediaAssetRow(mediaAssetIdB, workspaceId, mediaBlobIdA, 100, "2026-06-02T00:00:00.000Z"),
    createMediaAssetRow(mediaAssetIdE, otherWorkspaceId, mediaBlobIdB, 250, null),
  ]);

  await assert.rejects(
    async () => previewWorkspacePackageExportInExecutor(
      executor,
      workspaceId,
      createBasePreviewInput({ kind: "allActiveCards" }),
      { maxSelectedCards: 10 },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "WORKSPACE_PACKAGE_EXPORT_PREVIEW_MEDIA_ASSET_UNAVAILABLE");
      assert.match(error.message, new RegExp(mediaAssetIdD));
      assert.match(error.message, new RegExp(mediaAssetIdB));
      assert.match(error.message, new RegExp(mediaAssetIdE));
      return true;
    },
  );
});

test("preview rejects selections above the workload cap before unbounded materialization", async () => {
  const { executor } = createTestExecutor([
    createCardRow(cardIdA, workspaceId, "A", "A answer", [], "2026-06-01T00:00:00.000Z", null),
    createCardRow(cardIdB, workspaceId, "B", "B answer", [], "2026-06-02T00:00:00.000Z", null),
    createCardRow(cardIdC, workspaceId, "C", "C answer", [], "2026-06-03T00:00:00.000Z", null),
  ], []);

  await assert.rejects(
    async () => previewWorkspacePackageExportInExecutor(
      executor,
      workspaceId,
      createBasePreviewInput({ kind: "allActiveCards" }),
      { maxSelectedCards: 2 },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 413);
      assert.equal(error.code, "WORKSPACE_PACKAGE_EXPORT_PREVIEW_SELECTION_TOO_LARGE");
      return true;
    },
  );
});
