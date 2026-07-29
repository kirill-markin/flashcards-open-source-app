import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPublicHttpErrorDetails, HttpError } from "../../shared/errors";
import {
  completeMultipartMediaAssetUploadWithDependencies,
  createMultipartMediaAssetUploadWithDependencies,
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
  testWorkspaceId,
} from "./testHelpers";

test("createMultipartMediaAssetUploadWithDependencies starts uploads at a session-scoped staging key", async () => {
  const sentCommands: Array<string> = [];
  const signal = new AbortController().signal;
  const client = createTestS3Client();
  client.send = (async (
    command: unknown,
    options?: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    if (command instanceof CreateMultipartUploadCommand) {
      assert.equal(options?.abortSignal, signal);
      assert.equal(command.input.ChecksumType, undefined);
      sentCommands.push([
        String(command.input.Key),
        String(command.input.ContentType),
        String(command.input.ChecksumAlgorithm),
        String(command.input.Metadata?.["flashcards-sha256"]),
      ].join(":"));
      return { UploadId: "s3-upload-id-1" };
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  const upload = await createMultipartMediaAssetUploadWithDependencies(
    {
      signal,
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      stagingStorageKey: testStagingStorageKey,
      mimeType: "image/png",
      sha256: testSha256,
      lastOperationId: testLastOperationId,
      observationScope: testObservationScope,
    },
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
  );

  assert.equal(upload.storageKey, testStagingStorageKey);
  assert.equal(upload.s3UploadId, "s3-upload-id-1");
  assert.match(upload.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(sentCommands, [
    `${testStagingStorageKey}:image/png:SHA256:${testSha256}`,
  ]);
});

test("multipart creation preserves its claim-deadline abort reason", async () => {
  const controller = new AbortController();
  const deadlineError = new HttpError(
    503,
    "Multipart creation claim deadline reached.",
    "MEDIA_ASSET_UPLOAD_SESSION_CREATION_IN_PROGRESS",
    { retryAfterSeconds: 1 },
  );
  const client = createTestS3Client();
  client.send = (async (
    command: unknown,
    options?: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    assert.ok(command instanceof CreateMultipartUploadCommand);
    assert.equal(options?.abortSignal, controller.signal);
    controller.abort(deadlineError);
    throw createS3Error(500, "InternalError", "Retryable failure");
  }) as S3Client["send"];

  await assert.rejects(
    createMultipartMediaAssetUploadWithDependencies(
      {
        signal: controller.signal,
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        stagingStorageKey: testStagingStorageKey,
        mimeType: "image/png",
        sha256: testSha256,
        lastOperationId: testLastOperationId,
        observationScope: testObservationScope,
      },
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown): boolean => error === deadlineError,
  );
});

test("completeMultipartMediaAssetUploadWithDependencies completes parts and validates the stored blob", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof CompleteMultipartUploadCommand) {
      assert.equal(command.input.ChecksumType, undefined);
      assert.equal(command.input.ChecksumSHA256, undefined);
      assert.equal(command.input.MpuObjectSize, undefined);
      sentCommands.push([
        "complete",
        String(command.input.Key),
        String(command.input.UploadId),
        String(command.input.MultipartUpload?.Parts?.[0]?.PartNumber),
        String(command.input.MultipartUpload?.Parts?.[0]?.ChecksumSHA256),
      ].join(":"));
      return {};
    }

    if (command instanceof HeadObjectCommand) {
      sentCommands.push(`head:${String(command.input.Key)}`);
      if (command.input.Key === testStagingStorageKey) {
        return createHeadObjectResponse({
          sizeBytes: testObjectBytes.byteLength,
          mimeType: "image/png",
          sha256: testSha256,
          checksumSha256: "c".repeat(64),
          checksumType: "COMPOSITE",
        });
      }

      return createHeadObjectResponse({
        sizeBytes: testObjectBytes.byteLength,
        mimeType: "image/png",
        sha256: testSha256,
      });
    }

    if (command instanceof GetObjectCommand) {
      sentCommands.push(`get:${String(command.input.Key)}`);
      return {
        Body: Readable.from([testObjectBytes]),
      };
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await completeMultipartMediaAssetUploadWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      stagingStorageKey: testStagingStorageKey,
      blobStorageKey: testBlobStorageKey,
      s3UploadId: "s3-upload-id-1",
      mimeType: "image/png",
      sizeBytes: testObjectBytes.byteLength,
      sha256: testSha256,
      lastOperationId: testLastOperationId,
      parts: [
        {
          partNumber: 1,
          eTag: "\"etag-1\"",
          sha256: "b".repeat(64),
        },
      ],
      observationScope: testObservationScope,
    },
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
  );

  assert.deepEqual(sentCommands, [
    `complete:${testStagingStorageKey}:s3-upload-id-1:1:${Buffer.from("b".repeat(64), "hex").toString("base64")}`,
    `head:${testStagingStorageKey}`,
    `get:${testStagingStorageKey}`,
    `head:${testBlobStorageKey}`,
  ]);
});

test("completeMultipartMediaAssetUploadWithDependencies rejects a streamed staging object hash mismatch", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof CompleteMultipartUploadCommand) {
      sentCommands.push("complete");
      return {};
    }

    if (command instanceof HeadObjectCommand) {
      sentCommands.push(`head:${String(command.input.Key)}`);
      return createHeadObjectResponse({
        sizeBytes: testObjectBytes.byteLength,
        mimeType: "image/png",
        sha256: testSha256,
        checksumSha256: "c".repeat(64),
        checksumType: "COMPOSITE",
      });
    }

    if (command instanceof GetObjectCommand) {
      sentCommands.push(`get:${String(command.input.Key)}`);
      return {
        Body: Readable.from([Buffer.from("not-password")]),
      };
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    async () => completeMultipartMediaAssetUploadWithDependencies(
      {
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        stagingStorageKey: testStagingStorageKey,
        blobStorageKey: testBlobStorageKey,
        s3UploadId: "s3-upload-id-1",
        mimeType: "image/png",
        sizeBytes: testObjectBytes.byteLength,
        sha256: testSha256,
        lastOperationId: testLastOperationId,
        parts: [
          {
            partNumber: 1,
            eTag: "\"etag-1\"",
            sha256: "b".repeat(64),
          },
        ],
        observationScope: testObservationScope,
      },
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_UPLOAD_MISMATCH");
      assert.match(error.message, /mismatchedFields=sizeBytes,sha256/);
      assert.doesNotMatch(error.message, /storageKey|media\/blobs|s3:\/\/|Sha256=|sha256=/);
      assert.doesNotMatch(error.message, new RegExp(testSha256));
      return true;
    },
  );
  assert.deepEqual(sentCommands, [
    "complete",
    `head:${testStagingStorageKey}`,
    `get:${testStagingStorageKey}`,
  ]);
});

test("completeMultipartMediaAssetUploadWithDependencies treats GetObject 403 as storage unavailable", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof CompleteMultipartUploadCommand) {
      sentCommands.push("complete");
      return {};
    }

    if (command instanceof HeadObjectCommand) {
      sentCommands.push(`head:${String(command.input.Key)}`);
      return createHeadObjectResponse({
        sizeBytes: testObjectBytes.byteLength,
        mimeType: "image/png",
        sha256: testSha256,
      });
    }

    if (command instanceof GetObjectCommand) {
      sentCommands.push(`get:${String(command.input.Key)}`);
      throw createS3Error(403, "Forbidden", `Forbidden for s3://test-media-assets-bucket/${testStagingStorageKey}`);
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    async () => completeMultipartMediaAssetUploadWithDependencies(
      {
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        stagingStorageKey: testStagingStorageKey,
        blobStorageKey: testBlobStorageKey,
        s3UploadId: "s3-upload-id-1",
        mimeType: "image/png",
        sizeBytes: testObjectBytes.byteLength,
        sha256: testSha256,
        lastOperationId: testLastOperationId,
        parts: [
          {
            partNumber: 1,
            eTag: "\"etag-1\"",
            sha256: "b".repeat(64),
          },
        ],
        observationScope: testObservationScope,
      },
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_STORAGE_UNAVAILABLE");
      assert.deepEqual(error.details?.mediaAssetStorage, {
        operation: "get_object",
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        s3StatusCode: 403,
        s3ErrorClass: "Forbidden",
        reason: "storage_temporarily_unavailable",
        retryable: true,
      });
      assert.doesNotMatch(error.message, /get_object|complete_multipart_upload|head_object|Forbidden|InternalError|s3StatusCode|s3ErrorClass/);
      assert.deepEqual(createPublicHttpErrorDetails(error.details), {
        mediaAssetStorage: {
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          reason: "storage_temporarily_unavailable",
          retryable: true,
        },
      });
      return true;
    },
  );
  assert.deepEqual(sentCommands, [
    "complete",
    `head:${testStagingStorageKey}`,
    `get:${testStagingStorageKey}`,
    `get:${testStagingStorageKey}`,
    `get:${testStagingStorageKey}`,
  ]);
});

test("completeMultipartMediaAssetUploadWithDependencies exposes multipart storage error details", async () => {
  await assert.rejects(
    async () => completeMultipartMediaAssetUploadWithDependencies(
      {
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        stagingStorageKey: testStagingStorageKey,
        blobStorageKey: testBlobStorageKey,
        s3UploadId: "s3-upload-id-1",
        mimeType: "image/png",
        sizeBytes: 42,
        sha256: testSha256,
        lastOperationId: testLastOperationId,
        parts: [
          {
            partNumber: 1,
            eTag: "\"etag-1\"",
            sha256: "b".repeat(64),
          },
        ],
        observationScope: testObservationScope,
      },
      {
        s3Client: createFailingS3Client(createS3Error(500, "InternalError", `Failed complete for s3://test-media-assets-bucket/${testStagingStorageKey}`)),
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_STORAGE_UNAVAILABLE");
      assert.deepEqual(error.details?.mediaAssetStorage, {
        operation: "complete_multipart_upload",
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        s3StatusCode: 500,
        s3ErrorClass: "InternalError",
        reason: "storage_temporarily_unavailable",
        retryable: true,
      });
      assert.doesNotMatch(error.message, /get_object|complete_multipart_upload|head_object|Forbidden|InternalError|s3StatusCode|s3ErrorClass/);
      assert.deepEqual(createPublicHttpErrorDetails(error.details), {
        mediaAssetStorage: {
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          reason: "storage_temporarily_unavailable",
          retryable: true,
        },
      });
      return true;
    },
  );
});
