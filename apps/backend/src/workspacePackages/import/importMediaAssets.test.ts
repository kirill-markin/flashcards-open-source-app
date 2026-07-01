import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import {
  imageJpegCardMediaBlobMimeType,
  type MediaAsset,
} from "../../mediaAssets/types";
import type {
  ImageMediaAssetIngestionInput,
  ImageMediaAssetIngestionResult,
} from "../../mediaAssets/ingestion";
import type { BackendObservationScope } from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import {
  ingestWorkspacePackageImportMediaAssetsWithDependencies,
  type WorkspacePackageImportMediaAssetIngestionDependencies,
} from "./importMediaAssets";
import {
  planWorkspacePackageImport,
  type PortableWorkspacePackageCardV1,
  type WorkspacePackageCardMetadataV1,
  type WorkspacePackageImportMediaAssetIngestionInput,
  type WorkspacePackageImportReferencedMediaFile,
} from "../index";

const testUserId = "user-1";
const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testReplicaId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-06-30T12:00:00.000Z";
const clientUpdatedAt = "2026-06-30T12:01:00.000Z";
const operationIdPrefix = "import-session-1";

const observationScope: BackendObservationScope = {
  service: "backend-api",
  requestId: "request-1",
  route: null,
  method: null,
  userId: testUserId,
  workspaceId: testWorkspaceId,
  chatRequestId: null,
  runId: null,
  sessionId: null,
  clientAppVersion: null,
  clientPlatform: null,
};

const testMetadata: WorkspacePackageCardMetadataV1 = {
  version: 1,
  source: null,
};

type TestIngestionHarness = Readonly<{
  dependencies: WorkspacePackageImportMediaAssetIngestionDependencies;
  calls: ReadonlyArray<ImageMediaAssetIngestionInput>;
}>;

function createMediaFile(
  portablePath: string,
  bytes: Buffer,
): WorkspacePackageImportReferencedMediaFile {
  return {
    portablePath,
    bytes,
    sizeBytes: bytes.byteLength,
  };
}

function createTestInput(
  referencedMediaFiles: ReadonlyArray<WorkspacePackageImportReferencedMediaFile>,
): WorkspacePackageImportMediaAssetIngestionInput {
  return {
    userId: testUserId,
    workspaceId: testWorkspaceId,
    referencedMediaFiles,
    createdAt,
    clientUpdatedAt,
    lastModifiedByReplicaId: testReplicaId,
    operationIdPrefix,
    observationScope,
  };
}

function createMediaAsset(input: ImageMediaAssetIngestionInput): MediaAsset {
  return {
    mediaAssetId: input.metadata.mediaAssetId,
    workspaceId: input.workspaceId,
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes: input.imageBytes.byteLength,
    sha256: `sha256-${input.metadata.mediaAssetId}`,
    sourceUrl: input.metadata.sourceUrl,
    createdAt: input.metadata.createdAt,
    clientUpdatedAt: input.metadata.clientUpdatedAt,
    lastModifiedByReplicaId: input.metadata.lastModifiedByReplicaId,
    lastOperationId: input.metadata.lastOperationId,
    updatedAt: input.metadata.clientUpdatedAt,
    deletedAt: null,
  };
}

function createIngestionHarness(mediaAssetIds: ReadonlyArray<string>): TestIngestionHarness {
  const calls: Array<ImageMediaAssetIngestionInput> = [];
  let mediaAssetIdIndex = 0;

  return {
    calls,
    dependencies: {
      randomUuidFn: () => {
        const mediaAssetId = mediaAssetIds[mediaAssetIdIndex];
        if (mediaAssetId === undefined) {
          throw new Error(`Missing test media asset id for index ${mediaAssetIdIndex}`);
        }

        mediaAssetIdIndex += 1;
        return mediaAssetId;
      },
      ingestImageMediaAssetFn: async (input): Promise<ImageMediaAssetIngestionResult> => {
        calls.push(input);
        return {
          mediaAsset: createMediaAsset(input),
          applied: true,
        };
      },
    },
  };
}

function createTestCard(
  frontText: string,
  backText: string,
): PortableWorkspacePackageCardV1 {
  return {
    frontText,
    backText,
    tags: ["imported"],
    cardType: "basic",
    metadata: testMetadata,
  };
}

test("workspace package import media asset ingestion returns empty results without calling ingestion", async () => {
  const harness = createIngestionHarness([]);

  const result = await ingestWorkspacePackageImportMediaAssetsWithDependencies(
    createTestInput([]),
    harness.dependencies,
  );

  assert.deepEqual(result.mediaAssets, []);
  assert.equal(result.mediaAssetIdsByPortablePath.size, 0);
  assert.deepEqual(harness.calls, []);
});

test("workspace package import media asset ingestion creates one logical asset with expected metadata", async () => {
  const mediaBytes = Buffer.from("image bytes");
  const mediaFile = createMediaFile("media/images/cell.png", mediaBytes);
  const harness = createIngestionHarness(["asset-1"]);

  const result = await ingestWorkspacePackageImportMediaAssetsWithDependencies(
    createTestInput([mediaFile]),
    harness.dependencies,
  );

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0]?.userId, testUserId);
  assert.equal(harness.calls[0]?.workspaceId, testWorkspaceId);
  assert.deepEqual(harness.calls[0]?.imageBytes, mediaBytes);
  assert.deepEqual(harness.calls[0]?.metadata, {
    mediaAssetId: "asset-1",
    sourceUrl: null,
    createdAt,
    clientUpdatedAt,
    lastModifiedByReplicaId: testReplicaId,
    lastOperationId: `${operationIdPrefix}:media:0`,
  });
  assert.equal(harness.calls[0]?.observationScope, observationScope);
  assert.deepEqual(result.mediaAssets.map((mediaAsset) => mediaAsset.portablePath), ["media/images/cell.png"]);
  assert.equal(result.mediaAssets[0]?.mediaAsset.mediaAssetId, "asset-1");
  assert.equal(result.mediaAssets[0]?.applied, true);
  assert.equal(result.mediaAssetIdsByPortablePath.get("media/images/cell.png"), "asset-1");
});

test("workspace package import media asset ingestion preserves input order and operation id order", async () => {
  const firstMediaFile = createMediaFile("media/first.png", Buffer.from("first image bytes"));
  const secondMediaFile = createMediaFile("media/second.png", Buffer.from("second image bytes"));
  const harness = createIngestionHarness(["asset-1", "asset-2"]);

  const result = await ingestWorkspacePackageImportMediaAssetsWithDependencies(
    createTestInput([firstMediaFile, secondMediaFile]),
    harness.dependencies,
  );

  assert.deepEqual(
    harness.calls.map((call) => call.metadata.mediaAssetId),
    ["asset-1", "asset-2"],
  );
  assert.deepEqual(
    harness.calls.map((call) => call.metadata.lastOperationId),
    [`${operationIdPrefix}:media:0`, `${operationIdPrefix}:media:1`],
  );
  assert.deepEqual(
    result.mediaAssets.map((mediaAsset) => mediaAsset.portablePath),
    ["media/first.png", "media/second.png"],
  );
  assert.equal(result.mediaAssetIdsByPortablePath.get("media/first.png"), "asset-1");
  assert.equal(result.mediaAssetIdsByPortablePath.get("media/second.png"), "asset-2");
});

test("workspace package import media asset ingestion rejects duplicate portable paths before ingestion", async () => {
  const firstMediaFile = createMediaFile("media/duplicate.png", Buffer.from("first image bytes"));
  const secondMediaFile = createMediaFile("media/duplicate.png", Buffer.from("second image bytes"));
  const harness = createIngestionHarness(["asset-1", "asset-2"]);

  await assert.rejects(
    () => ingestWorkspacePackageImportMediaAssetsWithDependencies(
      createTestInput([firstMediaFile, secondMediaFile]),
      harness.dependencies,
    ),
    /referencedMediaFiles contain duplicate or invalid portable paths.*media\/duplicate\.png/,
  );
  assert.deepEqual(harness.calls, []);
});

test("workspace package import media asset ingestion includes portable path when ingestion fails", async () => {
  const mediaFile = createMediaFile("media/unsupported.bin", Buffer.from("not an image"));
  const calls: Array<ImageMediaAssetIngestionInput> = [];
  const dependencies: WorkspacePackageImportMediaAssetIngestionDependencies = {
    randomUuidFn: () => "asset-1",
    ingestImageMediaAssetFn: async (input): Promise<ImageMediaAssetIngestionResult> => {
      calls.push(input);
      throw new Error("Unsupported image format");
    },
  };

  await assert.rejects(
    () => ingestWorkspacePackageImportMediaAssetsWithDependencies(createTestInput([mediaFile]), dependencies),
    /portablePath=media\/unsupported\.bin.*Unsupported image format/,
  );
  assert.equal(calls.length, 1);
});

test("workspace package import media asset ingestion preserves HttpError context when ingestion fails", async () => {
  const mediaFile = createMediaFile("media/too-large.png", Buffer.from("large image bytes"));
  const details = {
    validationIssues: [
      {
        path: "imageBytes",
        code: "too_big",
        message: "Image bytes are too large.",
      },
    ],
  };
  const dependencies: WorkspacePackageImportMediaAssetIngestionDependencies = {
    randomUuidFn: () => "asset-1",
    ingestImageMediaAssetFn: async (): Promise<ImageMediaAssetIngestionResult> => {
      throw new HttpError(413, "Image is too large.", "MEDIA_ASSET_IMAGE_TOO_LARGE", details);
    },
  };

  await assert.rejects(
    () => ingestWorkspacePackageImportMediaAssetsWithDependencies(createTestInput([mediaFile]), dependencies),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 413);
      assert.equal(error.code, "MEDIA_ASSET_IMAGE_TOO_LARGE");
      assert.deepEqual(error.details, details);
      assert.match(error.message, /portablePath=media\/too-large\.png/);
      assert.match(error.message, /Image is too large/);
      return true;
    },
  );
});

test("workspace package import media asset map works directly with import planning", async () => {
  const mediaFile = createMediaFile("media/images/cell.png", Buffer.from("image bytes"));
  const harness = createIngestionHarness(["asset-1"]);
  const ingestionResult = await ingestWorkspacePackageImportMediaAssetsWithDependencies(
    createTestInput([mediaFile]),
    harness.dependencies,
  );

  const plan = planWorkspacePackageImport({
    cardsJson: {
      formatVersion: 1,
      cards: [
        createTestCard(
          "Diagram: ![cell](media/images/cell.png)",
          "Answer image: ![cell](media/images/cell.png)",
        ),
      ],
    },
    options: {
      addImportTag: false,
      importTag: "import:unused",
      removeTags: [],
      importedAt: createdAt,
      importId: operationIdPrefix,
    },
    mediaAssetIdsByPortablePath: ingestionResult.mediaAssetIdsByPortablePath,
  });

  assert.equal(plan.cards[0]?.frontText, "Diagram: ![cell](fcasset:asset-1)");
  assert.equal(plan.cards[0]?.backText, "Answer image: ![cell](fcasset:asset-1)");
  assert.equal(plan.summary.referencedMediaCount, 1);
});
