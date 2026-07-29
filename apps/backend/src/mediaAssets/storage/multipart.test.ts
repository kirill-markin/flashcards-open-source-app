import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPublicHttpErrorDetails, HttpError } from "../../shared/errors";
import {
  createMultipartMediaAssetUploadWithDependencies,
} from ".";
import {
  abortMultipartMediaAssetUploadWithDependencies,
  completeMultipartMediaAssetUploadWithCapabilityVerifier,
  completeMultipartMediaAssetUploadWithDependencies,
} from "./multipart";
import { MediaBlobWriterFenceError } from "../blobLifecycle";
import type {
  CompleteMultipartMediaAssetUploadInput,
} from "./contracts";
import {
  createMediaAssetUploadSessionCompletedPartsFingerprint,
  type MultipartMediaBlobStorageCapability,
  type MultipartMediaBlobWriterAttemptExactInput,
} from "../uploadSessions";
import {
  createFailingS3Client,
  createHeadObjectResponse,
  createS3Error,
  createTestS3Client,
  getTestMediaAssetsStorageConfig,
  getUnexpectedS3CommandName,
  testBlobStorageKey,
  testLastOperationId,
  testLastOperationIdSha256,
  testMediaAssetId,
  testObjectBytes,
  testObservationScope,
  testSessionId,
  testSha256,
  testStagingStorageKey,
  testWorkspaceId,
} from "./testHelpers";

const testMultipartStorageCapability =
  Object.freeze({}) as MultipartMediaBlobStorageCapability;

function createAuthorizedCompletionInput(
  input: Omit<
    CompleteMultipartMediaAssetUploadInput,
    | "writer"
    | "getStorageCapability"
    | "assertStorageMutationAuthorized"
    | "signal"
  >,
): CompleteMultipartMediaAssetUploadInput {
  const writer: MultipartMediaBlobWriterAttemptExactInput = {
    attemptToken: "66666666-6666-4666-8666-666666666666",
    reservationToken: "77777777-7777-4777-8777-777777777777",
    userId: "user-1",
    workspaceId: input.workspaceId,
    sessionId: testSessionId,
    mediaAssetId: input.mediaAssetId,
    lastModifiedByReplicaId: "88888888-8888-4888-8888-888888888888",
    lastOperationId: input.lastOperationId,
    sha256: input.sha256,
    stagingStorageKey: input.stagingStorageKey,
    blobStorageKey: input.blobStorageKey,
    s3UploadId: input.s3UploadId,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    partSizeBytes: input.sizeBytes,
    partCount: input.parts.length,
    sourceUrl: null,
    assetCreatedAt: "2026-07-27T10:00:00.000Z",
    clientUpdatedAt: "2026-07-27T10:00:00.000Z",
    expiresAt: "2099-07-27T11:00:00.000Z",
    normalizationVersion: "passthrough-v1",
    completedPartsFingerprint:
      createMediaAssetUploadSessionCompletedPartsFingerprint(input.parts),
  };
  return {
    ...input,
    writer,
    getStorageCapability: async () => testMultipartStorageCapability,
    assertStorageMutationAuthorized: () => {},
    signal: new AbortController().signal,
  };
}

function verifyTestMultipartStorageCapability(
  capability: MultipartMediaBlobStorageCapability,
  _writer: MultipartMediaBlobWriterAttemptExactInput,
): void {
  assert.equal(capability, testMultipartStorageCapability);
}

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

test("multipart abort preserves its deadline reason and a new request resumes idempotently", async () => {
  const deadlineController = new AbortController();
  const deadlineError = new HttpError(
    503,
    "Multipart completion deadline reached.",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
  const retrySignal = new AbortController().signal;
  let abortAttempts = 0;
  const client = createTestS3Client();
  client.send = (async (
    command: unknown,
    options?: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    assert.ok(command instanceof AbortMultipartUploadCommand);
    abortAttempts += 1;
    if (abortAttempts === 1) {
      assert.equal(options?.abortSignal, deadlineController.signal);
      deadlineController.abort(deadlineError);
      throw createS3Error(500, "InternalError", "Retryable failure");
    }
    assert.equal(options?.abortSignal, retrySignal);
    throw createS3Error(404, "NoSuchUpload", "Upload is already absent");
  }) as S3Client["send"];
  const input = {
    workspaceId: testWorkspaceId,
    mediaAssetId: testMediaAssetId,
    stagingStorageKey: testStagingStorageKey,
    s3UploadId: "s3-upload-id-1",
    observationScope: testObservationScope,
  };
  const dependencies = {
    s3Client: client,
    getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
  };

  await assert.rejects(
    abortMultipartMediaAssetUploadWithDependencies(
      { ...input, signal: deadlineController.signal },
      dependencies,
    ),
    (error: unknown): boolean => error === deadlineError,
  );
  await abortMultipartMediaAssetUploadWithDependencies(
    { ...input, signal: retrySignal },
    dependencies,
  );
  assert.equal(abortAttempts, 4);
});

test("completeMultipartMediaAssetUploadWithDependencies completes parts and validates the stored blob", async () => {
  const sentCommands: Array<string> = [];
  let stagingObjectNormalized = false;
  const controller = new AbortController();
  const abortListenerCountBefore =
    getEventListeners(controller.signal, "abort").length;
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
          checksumSha256: stagingObjectNormalized
            ? testSha256
            : "c".repeat(64),
          checksumType: stagingObjectNormalized
            ? "FULL_OBJECT"
            : "COMPOSITE",
          eTag: stagingObjectNormalized
            ? "\"normalized-etag\""
            : "\"multipart-etag\"",
        });
      }

      return createHeadObjectResponse({
        sizeBytes: testObjectBytes.byteLength,
        mimeType: "image/png",
        sha256: testSha256,
      });
    }

    if (command instanceof CopyObjectCommand) {
      assert.equal(command.input.Key, testStagingStorageKey);
      assert.equal(
        command.input.CopySource,
        `test-media-assets-bucket/${testStagingStorageKey}`,
      );
      assert.equal(command.input.CopySourceIfMatch, "\"multipart-etag\"");
      assert.equal(command.input.ChecksumAlgorithm, "SHA256");
      assert.equal(command.input.MetadataDirective, "REPLACE");
      assert.equal(command.input.ContentType, "image/png");
      assert.deepEqual(command.input.Metadata, {
        "flashcards-workspace-id": testWorkspaceId,
        "flashcards-media-asset-id": testMediaAssetId,
        "flashcards-last-operation-id-sha256": testLastOperationIdSha256,
        "flashcards-sha256": testSha256,
      });
      sentCommands.push(`copy:${String(command.input.Key)}`);
      stagingObjectNormalized = true;
      return {};
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await completeMultipartMediaAssetUploadWithCapabilityVerifier(
    {
      ...createAuthorizedCompletionInput({
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
      }),
      signal: controller.signal,
    },
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
    verifyTestMultipartStorageCapability,
  );

  assert.deepEqual(sentCommands, [
    `complete:${testStagingStorageKey}:s3-upload-id-1:1:${Buffer.from("b".repeat(64), "hex").toString("base64")}`,
    `head:${testStagingStorageKey}`,
    `copy:${testStagingStorageKey}`,
    `head:${testStagingStorageKey}`,
    `head:${testBlobStorageKey}`,
  ]);
  assert.equal(
    getEventListeners(controller.signal, "abort").length,
    abortListenerCountBefore,
  );
});

test("synchronous multipart authorization gates complete, normalization, and promotion mutations", async (context) => {
  for (const [phase, deniedAuthorizationCall, expectedMutations] of [
    ["complete", 1, []],
    ["normalize", 2, ["complete"]],
    ["promote", 3, ["complete", "normalize"]],
  ] as const) {
    await context.test(phase, async () => {
      let stagingState: "missing" | "composite" | "full" = "missing";
      let blobAvailable = false;
      const mutations: Array<string> = [];
      const client = createTestS3Client();
      client.send = (async (command: unknown) => {
        if (command instanceof CompleteMultipartUploadCommand) {
          mutations.push("complete");
          stagingState = "composite";
          return {};
        }
        if (command instanceof HeadObjectCommand) {
          if (command.input.Key === testBlobStorageKey) {
            if (!blobAvailable) {
              throw createS3Error(
                404,
                "NoSuchKey",
                "Blob is not available.",
              );
            }
            return createHeadObjectResponse({
              sizeBytes: testObjectBytes.byteLength,
              mimeType: "image/png",
              sha256: testSha256,
            });
          }
          return createHeadObjectResponse({
            sizeBytes: testObjectBytes.byteLength,
            mimeType: "image/png",
            sha256: testSha256,
            checksumSha256: stagingState === "full"
              ? testSha256
              : "c".repeat(64),
            checksumType: stagingState === "full"
              ? "FULL_OBJECT"
              : "COMPOSITE",
            eTag: stagingState === "full"
              ? "\"normalized-etag\""
              : "\"multipart-etag\"",
          });
        }
        if (command instanceof CopyObjectCommand) {
          if (command.input.Key === testStagingStorageKey) {
            mutations.push("normalize");
            stagingState = "full";
            return {};
          }
          if (command.input.Key === testBlobStorageKey) {
            mutations.push("promote");
            blobAvailable = true;
            return {};
          }
        }
        throw new Error(
          `Unexpected S3 command ${getUnexpectedS3CommandName(command)}`,
        );
      }) as S3Client["send"];
      const cutoffError = new MediaBlobWriterFenceError(
        `test_${phase}_synchronous_cutoff`,
      );
      let authorizationCalls = 0;
      const input = createAuthorizedCompletionInput({
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        stagingStorageKey: testStagingStorageKey,
        blobStorageKey: testBlobStorageKey,
        s3UploadId: "s3-upload-id-1",
        mimeType: "image/png",
        sizeBytes: testObjectBytes.byteLength,
        sha256: testSha256,
        lastOperationId: testLastOperationId,
        parts: [{
          partNumber: 1,
          eTag: "\"etag-1\"",
          sha256: "b".repeat(64),
        }],
        observationScope: testObservationScope,
      });

      await assert.rejects(
        completeMultipartMediaAssetUploadWithCapabilityVerifier(
          {
            ...input,
            assertStorageMutationAuthorized: () => {
              authorizationCalls += 1;
              if (authorizationCalls >= deniedAuthorizationCall) {
                throw cutoffError;
              }
            },
          },
          {
            s3Client: client,
            getMediaAssetsStorageConfigFn:
              getTestMediaAssetsStorageConfig,
          },
          verifyTestMultipartStorageCapability,
        ),
        (error: unknown): boolean => error === cutoffError,
      );
      assert.deepEqual(mutations, expectedMutations);
    });
  }
});

test("multipart checksum normalization resolves an unknown copy outcome through HEAD without reading bytes", async () => {
  const sentCommands: Array<string> = [];
  let stagingObjectNormalized = false;
  let stagingHeadCount = 0;
  let copyAttempts = 0;
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof CompleteMultipartUploadCommand) {
      sentCommands.push("complete");
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      sentCommands.push(`head:${String(command.input.Key)}`);
      if (command.input.Key === testBlobStorageKey) {
        return createHeadObjectResponse({
          sizeBytes: testObjectBytes.byteLength,
          mimeType: "image/png",
          sha256: testSha256,
        });
      }
      stagingHeadCount += 1;
      return createHeadObjectResponse({
        sizeBytes: testObjectBytes.byteLength,
        mimeType: "image/png",
        sha256: testSha256,
        checksumSha256: stagingObjectNormalized
          ? testSha256
          : "c".repeat(64),
        checksumType: stagingObjectNormalized
          ? "FULL_OBJECT"
          : "COMPOSITE",
        eTag: stagingObjectNormalized
          ? "\"normalized-etag\""
          : "\"multipart-etag\"",
      });
    }
    if (command instanceof CopyObjectCommand) {
      copyAttempts += 1;
      sentCommands.push("copy");
      stagingObjectNormalized = true;
      throw createS3Error(
        500,
        "InternalError",
        "Copy committed but its response was lost.",
      );
    }
    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await completeMultipartMediaAssetUploadWithCapabilityVerifier(
    createAuthorizedCompletionInput({
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      stagingStorageKey: testStagingStorageKey,
      blobStorageKey: testBlobStorageKey,
      s3UploadId: "s3-upload-id-1",
      mimeType: "image/png",
      sizeBytes: testObjectBytes.byteLength,
      sha256: testSha256,
      lastOperationId: testLastOperationId,
      parts: [{
        partNumber: 1,
        eTag: "\"etag-1\"",
        sha256: "b".repeat(64),
      }],
      observationScope: testObservationScope,
    }),
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
    verifyTestMultipartStorageCapability,
  );

  assert.equal(copyAttempts, 1);
  assert.equal(stagingHeadCount, 3);
  assert.deepEqual(sentCommands, [
    "complete",
    `head:${testStagingStorageKey}`,
    "copy",
    `head:${testStagingStorageKey}`,
    `head:${testStagingStorageKey}`,
    `head:${testBlobStorageKey}`,
  ]);
});

test("multipart completion preserves the deadline reason and does not retry after cancellation", async () => {
  const controller = new AbortController();
  const deadlineError = new HttpError(
    503,
    "Multipart completion deadline reached.",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
  let completeAttempts = 0;
  const client = createTestS3Client();
  client.send = (async (
    command: unknown,
    options?: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    assert.equal(options?.abortSignal, controller.signal);
    if (command instanceof CompleteMultipartUploadCommand) {
      completeAttempts += 1;
      controller.abort(deadlineError);
      throw createS3Error(500, "InternalError", "Retryable failure");
    }
    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    completeMultipartMediaAssetUploadWithCapabilityVerifier(
      {
        ...createAuthorizedCompletionInput({
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          stagingStorageKey: testStagingStorageKey,
          blobStorageKey: testBlobStorageKey,
          s3UploadId: "s3-upload-id-1",
          mimeType: "image/png",
          sizeBytes: testObjectBytes.byteLength,
          sha256: testSha256,
          lastOperationId: testLastOperationId,
          parts: [{
            partNumber: 1,
            eTag: "\"etag-1\"",
            sha256: "b".repeat(64),
          }],
          observationScope: testObservationScope,
        }),
        signal: controller.signal,
      },
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
      verifyTestMultipartStorageCapability,
    ),
    (error: unknown): boolean => error === deadlineError,
  );
  assert.equal(completeAttempts, 1);
});

test("multipart checksum normalization preserves the deadline reason and stops copy retries", async () => {
  const controller = new AbortController();
  const deadlineError = new HttpError(
    503,
    "Multipart completion deadline reached.",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
  let copyAttempts = 0;
  const client = createTestS3Client();
  client.send = (async (
    command: unknown,
    options?: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    assert.equal(options?.abortSignal, controller.signal);
    if (command instanceof CompleteMultipartUploadCommand) return {};
    if (command instanceof HeadObjectCommand) {
      return createHeadObjectResponse({
        sizeBytes: testObjectBytes.byteLength,
        mimeType: "image/png",
        sha256: testSha256,
        checksumSha256: "c".repeat(64),
        checksumType: "COMPOSITE",
      });
    }
    if (command instanceof CopyObjectCommand) {
      copyAttempts += 1;
      controller.abort(deadlineError);
      throw createS3Error(500, "InternalError", "Copy response unavailable");
    }
    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    completeMultipartMediaAssetUploadWithCapabilityVerifier(
      {
        ...createAuthorizedCompletionInput({
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          stagingStorageKey: testStagingStorageKey,
          blobStorageKey: testBlobStorageKey,
          s3UploadId: "s3-upload-id-1",
          mimeType: "image/png",
          sizeBytes: testObjectBytes.byteLength,
          sha256: testSha256,
          lastOperationId: testLastOperationId,
          parts: [{
            partNumber: 1,
            eTag: "\"etag-1\"",
            sha256: "b".repeat(64),
          }],
          observationScope: testObservationScope,
        }),
        signal: controller.signal,
      },
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
      verifyTestMultipartStorageCapability,
    ),
    (error: unknown): boolean => error === deadlineError,
  );
  assert.equal(copyAttempts, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("completeMultipartMediaAssetUploadWithDependencies rejects unsealed authority before S3", async () => {
  let sendCalls = 0;
  const client = createTestS3Client();
  client.send = (async () => {
    sendCalls += 1;
    return {};
  }) as S3Client["send"];

  await assert.rejects(
    completeMultipartMediaAssetUploadWithDependencies(
      createAuthorizedCompletionInput({
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        stagingStorageKey: testStagingStorageKey,
        blobStorageKey: testBlobStorageKey,
        s3UploadId: "s3-upload-id-1",
        mimeType: "image/png",
        sizeBytes: testObjectBytes.byteLength,
        sha256: testSha256,
        lastOperationId: testLastOperationId,
        parts: [{
          partNumber: 1,
          eTag: "\"etag-1\"",
          sha256: "b".repeat(64),
        }],
        observationScope: testObservationScope,
      }),
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    MediaBlobWriterFenceError,
  );
  assert.equal(sendCalls, 0);
});

test("completeMultipartMediaAssetUploadWithDependencies rejects a normalized full-object checksum mismatch", async () => {
  const sentCommands: Array<string> = [];
  let normalized = false;
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof CompleteMultipartUploadCommand) {
      sentCommands.push("complete");
      return {};
    }

    if (command instanceof HeadObjectCommand) {
      sentCommands.push(`head:${String(command.input.Key)}`);
      return createHeadObjectResponse({
        sizeBytes: normalized
          ? testObjectBytes.byteLength + 1
          : testObjectBytes.byteLength,
        mimeType: "image/png",
        sha256: testSha256,
        checksumSha256: "c".repeat(64),
        checksumType: normalized ? "FULL_OBJECT" : "COMPOSITE",
      });
    }

    if (command instanceof CopyObjectCommand) {
      sentCommands.push(`copy:${String(command.input.Key)}`);
      normalized = true;
      return {};
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    async () => completeMultipartMediaAssetUploadWithCapabilityVerifier(
      createAuthorizedCompletionInput({
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
      }),
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
      verifyTestMultipartStorageCapability,
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
    `copy:${testStagingStorageKey}`,
    `head:${testStagingStorageKey}`,
  ]);
});

test("completeMultipartMediaAssetUploadWithDependencies treats checksum copy 403 as storage unavailable", async () => {
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

    if (command instanceof CopyObjectCommand) {
      sentCommands.push(`copy:${String(command.input.Key)}`);
      throw createS3Error(403, "Forbidden", `Forbidden for s3://test-media-assets-bucket/${testStagingStorageKey}`);
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    async () => completeMultipartMediaAssetUploadWithCapabilityVerifier(
      createAuthorizedCompletionInput({
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
      }),
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
      verifyTestMultipartStorageCapability,
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_STORAGE_UNAVAILABLE");
      assert.deepEqual(error.details?.mediaAssetStorage, {
        operation: "copy_object",
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        s3StatusCode: 403,
        s3ErrorClass: "Forbidden",
        reason: "storage_temporarily_unavailable",
        retryable: true,
      });
      assert.doesNotMatch(error.message, /copy_object|complete_multipart_upload|head_object|Forbidden|InternalError|s3StatusCode|s3ErrorClass/);
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
    `copy:${testStagingStorageKey}`,
    `head:${testStagingStorageKey}`,
    `copy:${testStagingStorageKey}`,
    `head:${testStagingStorageKey}`,
    `copy:${testStagingStorageKey}`,
  ]);
});

test("completeMultipartMediaAssetUploadWithDependencies exposes multipart storage error details", async () => {
  await assert.rejects(
    async () => completeMultipartMediaAssetUploadWithCapabilityVerifier(
      createAuthorizedCompletionInput({
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
      }),
      {
        s3Client: createFailingS3Client(createS3Error(500, "InternalError", `Failed complete for s3://test-media-assets-bucket/${testStagingStorageKey}`)),
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
      verifyTestMultipartStorageCapability,
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
