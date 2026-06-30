import assert from "node:assert/strict";
import test from "node:test";
import {
  CopyObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPublicHttpErrorDetails, HttpError } from "../../shared/errors";
import {
  assertMediaAssetObjectMatchesWithDependencies,
  loadMediaAssetObjectMetadataWithDependencies,
  promoteMediaAssetUploadToBlobWithDependencies,
  storeMediaAssetBlobBytesIfAbsentWithDependencies,
} from ".";
import {
  createFailingS3Client,
  createHeadObjectResponse,
  createS3Error,
  createTestS3Client,
  getTestMediaAssetsStorageConfig,
  getUnexpectedS3CommandName,
  testBlobStorageKey,
  testLastOperationId,
  testMediaAssetId,
  testObjectBytes,
  testObservationScope,
  testSha256,
  testStagingStorageKey,
  testUploadStorageKey,
  testWorkspaceId,
} from "./testHelpers";

test("storeMediaAssetBlobBytesIfAbsentWithDependencies writes content-addressed bytes directly", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      sentCommands.push([
        "put",
        String(command.input.Key),
        String(command.input.ContentType),
        String(command.input.ChecksumSHA256),
        String(command.input.IfNoneMatch),
        String(command.input.Metadata?.["flashcards-sha256"]),
      ].join(":"));
      assert.deepEqual(command.input.Body, testObjectBytes);
      return {};
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await storeMediaAssetBlobBytesIfAbsentWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      storageKey: testBlobStorageKey,
      mimeType: "image/jpeg",
      sha256: testSha256,
      lastOperationId: testLastOperationId,
      bytes: testObjectBytes,
      observationScope: testObservationScope,
    },
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
  );

  assert.deepEqual(sentCommands, [
    [
      "put",
      testBlobStorageKey,
      "image/jpeg",
      Buffer.from(testSha256, "hex").toString("base64"),
      "*",
      testSha256,
    ].join(":"),
  ]);
});

test("storeMediaAssetBlobBytesIfAbsentWithDependencies verifies an existing conditional-write winner", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      sentCommands.push(`put:${String(command.input.Key)}`);
      throw createS3Error(412, "PreconditionFailed", "Object already exists");
    }

    if (command instanceof HeadObjectCommand) {
      sentCommands.push(`head:${String(command.input.Key)}`);
      return createHeadObjectResponse({
        sizeBytes: testObjectBytes.byteLength,
        mimeType: "image/jpeg",
        sha256: testSha256,
      });
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await storeMediaAssetBlobBytesIfAbsentWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      storageKey: testBlobStorageKey,
      mimeType: "image/jpeg",
      sha256: testSha256,
      lastOperationId: testLastOperationId,
      bytes: testObjectBytes,
      observationScope: testObservationScope,
    },
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
  );

  assert.deepEqual(sentCommands, [
    `put:${testBlobStorageKey}`,
    `head:${testBlobStorageKey}`,
  ]);
});

test("loadMediaAssetObjectMetadataWithDependencies treats HeadObject 403 as upload not found", async () => {
  await assert.rejects(
    async () => loadMediaAssetObjectMetadataWithDependencies(
      {
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        storageKey: testStagingStorageKey,
        mimeType: "image/png",
        sizeBytes: 42,
        sha256: testSha256,
        lastOperationId: testLastOperationId,
        observationScope: testObservationScope,
      },
      {
        s3Client: createFailingS3Client(createS3Error(403, "Forbidden", `Forbidden for s3://test-media-assets-bucket/${testStagingStorageKey}`)),
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_UPLOAD_NOT_FOUND");
      assert.doesNotMatch(error.message, /Forbidden|media\/blobs|s3:\/\//);
      assert.doesNotMatch(error.message, /get_object|complete_multipart_upload|head_object|s3StatusCode|s3ErrorClass/);
      assert.deepEqual(error.details?.mediaAssetStorage, {
        operation: "head_object",
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        s3StatusCode: 403,
        s3ErrorClass: "Forbidden",
        reason: "upload_not_available",
        retryable: false,
      });
      assert.deepEqual(createPublicHttpErrorDetails(error.details), {
        mediaAssetStorage: {
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          reason: "upload_not_available",
          retryable: false,
        },
      });
      return true;
    },
  );
});

test("assertMediaAssetObjectMatchesWithDependencies accepts matching signed upload proof metadata", async () => {
  const client = createTestS3Client();
  client.send = (async () => createHeadObjectResponse({
    sizeBytes: 42,
    mimeType: "image/png",
    sha256: testSha256,
  })) as S3Client["send"];

  await assertMediaAssetObjectMatchesWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      storageKey: testBlobStorageKey,
      mimeType: "image/png",
      sizeBytes: 42,
      sha256: testSha256,
      lastOperationId: testLastOperationId,
      observationScope: testObservationScope,
    },
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
  );
});

test("assertMediaAssetObjectMatchesWithDependencies rejects existing blobs without matching upload proof", async () => {
  const client = createTestS3Client();
  client.send = (async () => createHeadObjectResponse({
    sizeBytes: 42,
    mimeType: "image/png",
    sha256: testSha256,
    workspaceId: "44444444-4444-4444-8444-444444444444",
    mediaAssetId: "55555555-5555-4555-8555-555555555555",
    lastOperationIdSha256: "0".repeat(64),
  })) as S3Client["send"];

  await assert.rejects(
    async () => assertMediaAssetObjectMatchesWithDependencies(
      {
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        storageKey: testBlobStorageKey,
        mimeType: "image/png",
        sizeBytes: 42,
        sha256: testSha256,
        lastOperationId: testLastOperationId,
        observationScope: testObservationScope,
      },
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH");
      assert.match(error.message, /mismatchedProofFields=workspaceId,mediaAssetId,lastOperationId/);
      assert.doesNotMatch(error.message, /storageKey|media\/blobs|s3:\/\/|Sha256=|sha256=/);
      assert.doesNotMatch(error.message, new RegExp(testSha256));
      return true;
    },
  );
});

test("promoteMediaAssetUploadToBlobWithDependencies reuses an existing blob after verifying staging proof", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      const key = command.input.Key;
      sentCommands.push(`head:${String(key)}`);
      return createHeadObjectResponse({
        sizeBytes: 42,
        mimeType: "image/png",
        sha256: testSha256,
      });
    }

    if (command instanceof CopyObjectCommand) {
      sentCommands.push("copy");
      return {};
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await promoteMediaAssetUploadToBlobWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      uploadStorageKey: testUploadStorageKey,
      blobStorageKey: testBlobStorageKey,
      mimeType: "image/png",
      sizeBytes: 42,
      sha256: testSha256,
      lastOperationId: testLastOperationId,
      observationScope: testObservationScope,
    },
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
  );

  assert.deepEqual(sentCommands, [
    `head:${testUploadStorageKey}`,
    `head:${testBlobStorageKey}`,
  ]);
});
