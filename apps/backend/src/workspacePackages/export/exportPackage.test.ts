import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import pg from "pg";
import type { DatabaseExecutor, SqlValue } from "../../database";
import type {
  LoadedMediaAssetObjectBytes,
  LoadMediaAssetObjectBytesInput,
} from "../../mediaAssets/storage";
import type { BackendObservationScope } from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import {
  exportWorkspacePackageInExecutor,
  type WorkspacePackageExportPackageInput,
  type WorkspacePackageExportPackageLimits,
} from "./exportPackage";
import {
  parseWorkspacePackageCardsJsonV1,
  type WorkspacePackageCardsJsonV1,
  type WorkspacePackageCardMetadataV1,
} from "../types";

type TestCardRow = Readonly<{
  card_id: string;
  workspace_id: string;
  front_text: string;
  back_text: string;
  card_type: string;
  metadata: WorkspacePackageCardMetadataV1;
  tags: ReadonlyArray<string>;
  created_at: string;
  deleted_at: string | null;
}>;

type TestMediaAssetRow = Readonly<{
  media_asset_id: string;
  workspace_id: string;
  media_blob_id: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  deleted_at: string | null;
}>;

type TestByteLoaderHarness = Readonly<{
  loadMediaAssetObjectBytesFn: (
    input: LoadMediaAssetObjectBytesInput,
  ) => Promise<LoadedMediaAssetObjectBytes>;
  calls: ReadonlyArray<LoadMediaAssetObjectBytesInput>;
}>;

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const cardIdA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const cardIdB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const mediaAssetIdA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const mediaAssetIdB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const mediaAssetIdC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const mediaAssetIdD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const mediaAssetIdE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5";
const mediaBlobIdA = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const mediaBlobIdB = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const generatedAt = "2026-06-30T12:00:00.000Z";

const testMetadata: WorkspacePackageCardMetadataV1 = {
  version: 1,
  source: {
    label: "Source deck",
    author: null,
    comment: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    importedAt: null,
    importId: null,
  },
};

const observationScope: BackendObservationScope = {
  service: "backend-api",
  requestId: "request-1",
  route: null,
  method: null,
  userId: "user-1",
  workspaceId,
  chatRequestId: null,
  runId: null,
  sessionId: null,
  clientAppVersion: null,
  clientPlatform: null,
};

function createPackageLimits(
  maxSelectedCards: number,
  maxMediaFiles: number,
  maxSingleMediaBytes: number,
  maxTotalMediaBytes: number,
): WorkspacePackageExportPackageLimits {
  return { maxSelectedCards, maxMediaFiles, maxSingleMediaBytes, maxTotalMediaBytes };
}

function createBasePackageInput(
  selection: WorkspacePackageExportPackageInput["selection"],
): WorkspacePackageExportPackageInput {
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
    observationScope,
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
    card_type: "basic",
    metadata: testMetadata,
    tags,
    created_at: createdAt,
    deleted_at: deletedAt,
  };
}

function createMediaAssetRow(
  mediaAssetId: string,
  mediaWorkspaceId: string,
  mediaBlobId: string,
  mimeType: string,
  bytes: Buffer,
  storageKey: string,
  deletedAt: string | null,
): TestMediaAssetRow {
  return {
    media_asset_id: mediaAssetId,
    workspace_id: mediaWorkspaceId,
    media_blob_id: mediaBlobId,
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    storage_key: storageKey,
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

function compareCardsForPackage(left: TestCardRow, right: TestCardRow): number {
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
    .sort(compareCardsForPackage)
    .slice(0, limit);
}

function filterMediaRows(
  params: ReadonlyArray<SqlValue>,
  mediaAssets: ReadonlyArray<TestMediaAssetRow>,
): ReadonlyArray<Omit<TestMediaAssetRow, "workspace_id" | "deleted_at">> {
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
        mime_type: mediaAsset.mime_type,
        size_bytes: mediaAsset.size_bytes,
        sha256: mediaAsset.sha256,
        storage_key: mediaAsset.storage_key,
      }))
  ));
}

function createTestExecutor(
  cards: ReadonlyArray<TestCardRow>,
  mediaAssets: ReadonlyArray<TestMediaAssetRow>,
): DatabaseExecutor {
  return {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      if (text.includes("FROM content.cards")) {
        return createQueryResult(filterCardRows(text, params, cards) as unknown as ReadonlyArray<Row>);
      }

      if (text.includes("FROM content.media_assets AS media_assets")) {
        return createQueryResult(filterMediaRows(params, mediaAssets) as unknown as ReadonlyArray<Row>);
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createByteLoader(bytesByStorageKey: ReadonlyMap<string, Buffer>): TestByteLoaderHarness {
  const calls: Array<LoadMediaAssetObjectBytesInput> = [];

  return {
    calls,
    async loadMediaAssetObjectBytesFn(
      input: LoadMediaAssetObjectBytesInput,
    ): Promise<LoadedMediaAssetObjectBytes> {
      calls.push(input);
      const bytes = bytesByStorageKey.get(input.storageKey);
      if (bytes === undefined) {
        throw new Error(`Missing test bytes for storageKey=${input.storageKey}`);
      }

      if (bytes.byteLength > input.maxByteSize) {
        throw new HttpError(413, "Test media bytes exceed max byte size.", "TEST_MEDIA_TOO_LARGE");
      }

      const sha256 = sha256Hex(bytes);
      assert.equal(input.sizeBytes, bytes.byteLength);
      assert.equal(input.sha256, sha256);

      return {
        bytes,
        mimeType: input.mimeType,
        sizeBytes: bytes.byteLength,
        sha256,
      };
    },
  };
}

function findEndOfCentralDirectoryOffset(zipBytes: Buffer): number {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const offset = zipBytes.lastIndexOf(signature);
  if (offset === -1) {
    throw new Error("ZIP end of central directory record not found");
  }

  return offset;
}

function parseStoredZipEntries(zipBytes: Buffer): ReadonlyMap<string, Buffer> {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectoryOffset(zipBytes);
  const entryCount = zipBytes.readUInt16LE(endOfCentralDirectoryOffset + 10);
  const centralDirectoryOffset = zipBytes.readUInt32LE(endOfCentralDirectoryOffset + 16);
  const entries = new Map<string, Buffer>();
  let cursor = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    assert.equal(zipBytes.readUInt32LE(cursor), 0x02014b50);
    assert.equal(zipBytes.readUInt16LE(cursor + 10), 0);
    const compressedSize = zipBytes.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBytes.readUInt32LE(cursor + 24);
    const fileNameLength = zipBytes.readUInt16LE(cursor + 28);
    const extraFieldLength = zipBytes.readUInt16LE(cursor + 30);
    const fileCommentLength = zipBytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBytes.readUInt32LE(cursor + 42);
    const path = zipBytes.toString("utf8", cursor + 46, cursor + 46 + fileNameLength);
    assert.equal(compressedSize, uncompressedSize);
    assert.equal(zipBytes.readUInt32LE(localHeaderOffset), 0x04034b50);
    assert.equal(zipBytes.readUInt16LE(localHeaderOffset + 8), 0);
    const localFileNameLength = zipBytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraFieldLength = zipBytes.readUInt16LE(localHeaderOffset + 28);
    const contentStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
    entries.set(path, zipBytes.subarray(contentStart, contentStart + compressedSize));
    cursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function requireZipEntry(entries: ReadonlyMap<string, Buffer>, path: string): Buffer {
  const entry = entries.get(path);
  if (entry === undefined) {
    throw new Error(`ZIP entry not found: ${path}`);
  }

  return entry;
}

function parseCardsJson(entries: ReadonlyMap<string, Buffer>): WorkspacePackageCardsJsonV1 {
  return parseWorkspacePackageCardsJsonV1(JSON.parse(requireZipEntry(entries, "cards.json").toString("utf8")));
}

function listMediaEntryPaths(entries: ReadonlyMap<string, Buffer>): ReadonlyArray<string> {
  return [...entries.keys()].filter((entryPath) => entryPath.startsWith("media/"));
}

test("package ZIP for text-only cards contains valid cards.json", async () => {
  const executor = createTestExecutor([
    createCardRow(
      cardIdA,
      workspaceId,
      "What is the prompt?",
      "The answer.",
      ["core"],
      "2026-06-01T00:00:00.000Z",
      null,
    ),
  ], []);
  const byteLoader = createByteLoader(new Map());
  const packageExport = await exportWorkspacePackageInExecutor(
    executor,
    workspaceId,
    {
      ...createBasePackageInput({ kind: "allActiveCards" }),
      packageMetadata: {
        label: "Starter export",
        author: "Flashcards",
        comment: null,
        createdAt: null,
        sourceUrl: "https://example.com/starter",
      },
    },
    createPackageLimits(10, 10, 1024, 1024),
    byteLoader,
  );

  assert.equal(packageExport.fileName, "flashcards.zip");
  assert.equal(packageExport.contentType, "application/zip");
  const entries = parseStoredZipEntries(packageExport.bytes);
  assert.deepEqual([...entries.keys()], ["cards.json"]);
  assert.deepEqual(parseCardsJson(entries), {
    formatVersion: 1,
    label: "Starter export",
    author: "Flashcards",
    createdAt: generatedAt,
    sourceUrl: "https://example.com/starter",
    cards: [
      {
        frontText: "What is the prompt?",
        backText: "The answer.",
        tags: ["core"],
        cardType: "basic",
        metadata: testMetadata,
      },
    ],
  });
  assert.equal(byteLoader.calls.length, 0);
});

test("package export applies tag filters to selected cards and strips generated import tags", async () => {
  const executor = createTestExecutor([
    createCardRow(
      cardIdA,
      workspaceId,
      "Science prompt",
      "Science answer",
      ["science", "keep", "import:2026-07-04-0"],
      "2026-06-01T00:00:00.000Z",
      null,
    ),
    createCardRow(
      cardIdB,
      workspaceId,
      "Draft prompt",
      "Draft answer",
      ["science", "draft", "import:2026-07-04-1"],
      "2026-06-02T00:00:00.000Z",
      null,
    ),
  ], []);
  const byteLoader = createByteLoader(new Map());
  const packageExport = await exportWorkspacePackageInExecutor(
    executor,
    workspaceId,
    createBasePackageInput({
      kind: "tagFilters",
      includeTags: ["science"],
      excludeTags: ["draft"],
    }),
    createPackageLimits(10, 10, 1024, 1024),
    byteLoader,
  );

  const cardsJson = parseCardsJson(parseStoredZipEntries(packageExport.bytes));
  assert.equal(cardsJson.cards.length, 1);
  assert.equal(cardsJson.cards[0]?.frontText, "Science prompt");
  assert.deepEqual(cardsJson.cards[0]?.tags, ["science", "keep"]);
  assert.equal(byteLoader.calls.length, 0);
});

test("package ZIP rewrites media references to portable media paths", async () => {
  const imageBytes = Buffer.from("image-a");
  const mediaRow = createMediaAssetRow(
    mediaAssetIdA,
    workspaceId,
    mediaBlobIdA,
    "image/png",
    imageBytes,
    "blob/image-a",
    null,
  );
  const executor = createTestExecutor([
    createCardRow(
      cardIdA,
      workspaceId,
      `![front](fcasset:${mediaAssetIdA})`,
      `See [image](fcasset:${mediaAssetIdA})`,
      ["media"],
      "2026-06-01T00:00:00.000Z",
      null,
    ),
  ], [mediaRow]);
  const byteLoader = createByteLoader(new Map([[mediaRow.storage_key, imageBytes]]));
  const packageExport = await exportWorkspacePackageInExecutor(
    executor,
    workspaceId,
    createBasePackageInput({ kind: "allActiveCards" }),
    createPackageLimits(10, 10, 1024, 1024),
    byteLoader,
  );

  const entries = parseStoredZipEntries(packageExport.bytes);
  const mediaPaths = listMediaEntryPaths(entries);
  assert.equal(mediaPaths.length, 1);
  const portablePath = mediaPaths[0];
  assert.match(portablePath, /^media\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/u);
  assert.deepEqual(requireZipEntry(entries, portablePath), imageBytes);
  const cardsJson = parseCardsJson(entries);
  assert.equal(cardsJson.cards[0]?.frontText, `![front](${portablePath})`);
  assert.equal(cardsJson.cards[0]?.backText, `See [image](${portablePath})`);
});

test("package ZIP includes duplicate referenced blobs once", async () => {
  const imageBytes = Buffer.from("shared-image");
  const mediaRowA = createMediaAssetRow(
    mediaAssetIdA,
    workspaceId,
    mediaBlobIdA,
    "image/jpeg",
    imageBytes,
    "blob/shared-image",
    null,
  );
  const mediaRowB = createMediaAssetRow(
    mediaAssetIdB,
    workspaceId,
    mediaBlobIdA,
    "image/jpeg",
    imageBytes,
    "blob/shared-image",
    null,
  );
  const executor = createTestExecutor([
    createCardRow(
      cardIdA,
      workspaceId,
      [
        `![front](fcasset:${mediaAssetIdA})`,
        `![same blob same side](fcasset:${mediaAssetIdB})`,
      ].join("\n"),
      `![same blob](fcasset:${mediaAssetIdB})`,
      ["media"],
      "2026-06-01T00:00:00.000Z",
      null,
    ),
  ], [mediaRowA, mediaRowB]);
  const byteLoader = createByteLoader(new Map([[mediaRowA.storage_key, imageBytes]]));
  const packageExport = await exportWorkspacePackageInExecutor(
    executor,
    workspaceId,
    createBasePackageInput({ kind: "allActiveCards" }),
    createPackageLimits(10, 10, 1024, 1024),
    byteLoader,
  );

  const entries = parseStoredZipEntries(packageExport.bytes);
  const mediaPaths = listMediaEntryPaths(entries);
  assert.equal(mediaPaths.length, 1);
  assert.equal(byteLoader.calls.length, 1);
  const portablePath = mediaPaths[0];
  const cardsJson = parseCardsJson(entries);
  assert.equal(cardsJson.cards[0]?.frontText, [
    `![front](${portablePath})`,
    `![same blob same side](${portablePath})`,
  ].join("\n"));
  assert.equal(cardsJson.cards[0]?.backText, `![same blob](${portablePath})`);
});

test("package export canonicalizes uppercase UUID card and media references", async () => {
  const imageBytes = Buffer.from("uppercase-image");
  const mediaRow = createMediaAssetRow(
    mediaAssetIdA,
    workspaceId,
    mediaBlobIdA,
    "image/png",
    imageBytes,
    "blob/uppercase-image",
    null,
  );
  const uppercaseMediaAssetId = mediaAssetIdA.toUpperCase();
  const executor = createTestExecutor([
    createCardRow(
      cardIdA,
      workspaceId,
      `![front](fcasset:${uppercaseMediaAssetId})`,
      "Answer",
      ["media"],
      "2026-06-01T00:00:00.000Z",
      null,
    ),
  ], [mediaRow]);
  const byteLoader = createByteLoader(new Map([[mediaRow.storage_key, imageBytes]]));
  const packageExport = await exportWorkspacePackageInExecutor(
    executor,
    workspaceId,
    createBasePackageInput({
      kind: "explicitCardIds",
      cardIds: [cardIdA.toUpperCase()],
    }),
    createPackageLimits(10, 10, 1024, 1024),
    byteLoader,
  );

  const entries = parseStoredZipEntries(packageExport.bytes);
  const mediaPaths = listMediaEntryPaths(entries);
  assert.equal(mediaPaths.length, 1);
  assert.equal(parseCardsJson(entries).cards[0]?.frontText, `![front](${mediaPaths[0]})`);
});

test("package export rejects missing, deleted, or wrong-workspace media assets", async () => {
  const bytes = Buffer.from("available");
  const deletedRow = createMediaAssetRow(
    mediaAssetIdB,
    workspaceId,
    mediaBlobIdA,
    "image/png",
    bytes,
    "blob/deleted",
    "2026-06-02T00:00:00.000Z",
  );
  const wrongWorkspaceRow = createMediaAssetRow(
    mediaAssetIdE,
    otherWorkspaceId,
    mediaBlobIdB,
    "image/png",
    bytes,
    "blob/wrong-workspace",
    null,
  );
  const executor = createTestExecutor([
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
  ], [deletedRow, wrongWorkspaceRow]);
  const byteLoader = createByteLoader(new Map());

  await assert.rejects(
    async () => exportWorkspacePackageInExecutor(
      executor,
      workspaceId,
      createBasePackageInput({ kind: "allActiveCards" }),
      createPackageLimits(10, 10, 1024, 1024),
      byteLoader,
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "WORKSPACE_PACKAGE_EXPORT_PACKAGE_MEDIA_ASSET_UNAVAILABLE");
      assert.match(error.message, new RegExp(mediaAssetIdD));
      assert.match(error.message, new RegExp(mediaAssetIdB));
      assert.match(error.message, new RegExp(mediaAssetIdE));
      return true;
    },
  );
  assert.equal(byteLoader.calls.length, 0);
});

test("package export rejects media file count before loading objects", async () => {
  const imageBytesA = Buffer.from("count-a");
  const imageBytesB = Buffer.from("count-b");
  const mediaRowA = createMediaAssetRow(
    mediaAssetIdA,
    workspaceId,
    mediaBlobIdA,
    "image/png",
    imageBytesA,
    "blob/count-a",
    null,
  );
  const mediaRowB = createMediaAssetRow(
    mediaAssetIdB,
    workspaceId,
    mediaBlobIdB,
    "image/png",
    imageBytesB,
    "blob/count-b",
    null,
  );
  const executor = createTestExecutor([
    createCardRow(
      cardIdA,
      workspaceId,
      `![front](fcasset:${mediaAssetIdA})`,
      `![back](fcasset:${mediaAssetIdB})`,
      ["media"],
      "2026-06-01T00:00:00.000Z",
      null,
    ),
  ], [mediaRowA, mediaRowB]);
  const byteLoader = createByteLoader(new Map([
    [mediaRowA.storage_key, imageBytesA],
    [mediaRowB.storage_key, imageBytesB],
  ]));

  await assert.rejects(
    async () => exportWorkspacePackageInExecutor(
      executor,
      workspaceId,
      createBasePackageInput({ kind: "allActiveCards" }),
      createPackageLimits(10, 1, 1024, 1024),
      byteLoader,
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 413);
      assert.equal(error.code, "WORKSPACE_PACKAGE_EXPORT_PACKAGE_MEDIA_FILE_COUNT_TOO_LARGE");
      assert.match(error.message, /maxMediaFiles=1/u);
      return true;
    },
  );
  assert.equal(byteLoader.calls.length, 0);
});

test("package export rejects media size limits before loading objects", async () => {
  const oversizedBytes = Buffer.from("oversized");
  const oversizedRow: TestMediaAssetRow = {
    media_asset_id: mediaAssetIdA,
    workspace_id: workspaceId,
    media_blob_id: mediaBlobIdA,
    mime_type: "image/png",
    size_bytes: 8,
    sha256: sha256Hex(oversizedBytes),
    storage_key: "blob/oversized",
    deleted_at: null,
  };
  const oversizedExecutor = createTestExecutor([
    createCardRow(
      cardIdA,
      workspaceId,
      `![front](fcasset:${mediaAssetIdA})`,
      "A answer",
      ["media"],
      "2026-06-01T00:00:00.000Z",
      null,
    ),
  ], [oversizedRow]);
  const oversizedByteLoader = createByteLoader(new Map([[oversizedRow.storage_key, oversizedBytes]]));

  await assert.rejects(
    async () => exportWorkspacePackageInExecutor(
      oversizedExecutor,
      workspaceId,
      createBasePackageInput({ kind: "allActiveCards" }),
      createPackageLimits(10, 10, 4, 1024),
      oversizedByteLoader,
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 413);
      assert.equal(error.code, "WORKSPACE_PACKAGE_EXPORT_PACKAGE_SINGLE_MEDIA_TOO_LARGE");
      assert.match(error.message, /maxSingleMediaBytes=4/u);
      return true;
    },
  );
  assert.equal(oversizedByteLoader.calls.length, 0);

  const imageBytesA = Buffer.from("1234");
  const imageBytesB = Buffer.from("5678");
  const mediaRowA = createMediaAssetRow(
    mediaAssetIdA,
    workspaceId,
    mediaBlobIdA,
    "image/png",
    imageBytesA,
    "blob/image-a",
    null,
  );
  const mediaRowB = createMediaAssetRow(
    mediaAssetIdB,
    workspaceId,
    mediaBlobIdB,
    "image/png",
    imageBytesB,
    "blob/image-b",
    null,
  );
  const totalLimitExecutor = createTestExecutor([
    createCardRow(
      cardIdB,
      workspaceId,
      `![front](fcasset:${mediaAssetIdA})`,
      `![back](fcasset:${mediaAssetIdB})`,
      ["media"],
      "2026-06-01T00:00:00.000Z",
      null,
    ),
  ], [mediaRowA, mediaRowB]);
  const totalLimitByteLoader = createByteLoader(new Map([
    [mediaRowA.storage_key, imageBytesA],
    [mediaRowB.storage_key, imageBytesB],
  ]));

  await assert.rejects(
    async () => exportWorkspacePackageInExecutor(
      totalLimitExecutor,
      workspaceId,
      createBasePackageInput({ kind: "allActiveCards" }),
      createPackageLimits(10, 10, 1024, 7),
      totalLimitByteLoader,
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 413);
      assert.equal(error.code, "WORKSPACE_PACKAGE_EXPORT_PACKAGE_TOTAL_MEDIA_TOO_LARGE");
      assert.match(error.message, /maxTotalMediaBytes=7/u);
      return true;
    },
  );
  assert.equal(totalLimitByteLoader.calls.length, 0);
});

test("package export preserves default import-tag removal and additional tag removals", async () => {
  const sourceCard = createCardRow(
    cardIdA,
    workspaceId,
    "Prompt",
    "Answer",
    ["keep", "custom-remove", "import:2026-06-01-0"],
    "2026-06-01T00:00:00.000Z",
    null,
  );
  const executor = createTestExecutor([sourceCard], []);
  const byteLoader = createByteLoader(new Map());
  const input = createBasePackageInput({ kind: "allActiveCards" });
  const packageExport = await exportWorkspacePackageInExecutor(
    executor,
    workspaceId,
    {
      ...input,
      tagPolicy: {
        additionalRemovedTags: ["custom-remove"],
      },
    },
    createPackageLimits(10, 10, 1024, 1024),
    byteLoader,
  );

  const entries = parseStoredZipEntries(packageExport.bytes);
  assert.deepEqual(parseCardsJson(entries).cards[0]?.tags, ["keep"]);
  assert.deepEqual(sourceCard.tags, ["keep", "custom-remove", "import:2026-06-01-0"]);
});
