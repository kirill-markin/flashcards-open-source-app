import assert from "node:assert/strict";
import test from "node:test";
import {
  CopyObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  MediaBlobWriterFenceError,
  type DirectMediaBlobStorageCapability,
  type DirectMediaBlobWriterAttemptExactInput,
} from "../blobLifecycle";
import { createPublicHttpErrorDetails, HttpError } from "../../shared/errors";
import {
  assertMediaAssetObjectMatchesWithDependencies,
  loadMediaAssetObjectMetadataWithDependencies,
  promoteMediaAssetUploadToBlobWithDependencies,
  storeMediaAssetBlobBytesIfAbsentWithDependencies,
} from ".";
import { storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier } from "./promotion";
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

const testWriter: DirectMediaBlobWriterAttemptExactInput = {
  attemptToken: "66666666-6666-4666-8666-666666666666",
  reservationToken: "77777777-7777-4777-8777-777777777777",
  userId: "user-1",
  workspaceId: testWorkspaceId,
  mediaAssetId: testMediaAssetId,
  operationId: testLastOperationId,
  lastModifiedByReplicaId: "88888888-8888-4888-8888-888888888888",
  sha256: testSha256,
  storageKey: testBlobStorageKey,
  mimeType: "image/jpeg",
  sizeBytes: testObjectBytes.byteLength,
  normalizationVersion: "image-jpeg-card-v1",
  sourceUrl: null,
  assetCreatedAt: "2026-07-27T10:00:00.000Z",
  clientUpdatedAt: "2026-07-27T10:00:00.000Z",
};
const testStorageCapability =
  Object.freeze({}) as DirectMediaBlobStorageCapability;

function createDirectStoreInput(
  signal: AbortSignal,
  writer: DirectMediaBlobWriterAttemptExactInput,
  storageCapability: DirectMediaBlobStorageCapability,
) {
  return {
    writer,
    storageCapability,
    signal,
    workspaceId: testWorkspaceId,
    mediaAssetId: testMediaAssetId,
    storageKey: testBlobStorageKey,
    mimeType: "image/jpeg",
    sha256: testSha256,
    lastOperationId: testLastOperationId,
    bytes: testObjectBytes,
    observationScope: testObservationScope,
  };
}

test("storeMediaAssetBlobBytesIfAbsentWithDependencies writes content-addressed bytes directly", async () => {
  const sentCommands: Array<string> = [];
  const signal = AbortSignal.timeout(10_000);
  let capabilityChecks = 0;
  const client = createTestS3Client();
  client.send = (async (command: unknown, options: Readonly<{ abortSignal?: AbortSignal }>) => {
    assert.equal(options.abortSignal, signal);
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

  await storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier(
    createDirectStoreInput(signal, testWriter, testStorageCapability),
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
    (capability, writer) => {
      capabilityChecks += 1;
      assert.equal(capability, testStorageCapability);
      assert.equal(writer, testWriter);
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
  assert.equal(capabilityChecks, 2);
});

test("storeMediaAssetBlobBytesIfAbsentWithDependencies verifies an existing conditional-write winner", async () => {
  const sentCommands: Array<string> = [];
  const signal = AbortSignal.timeout(10_000);
  let capabilityChecks = 0;
  const client = createTestS3Client();
  client.send = (async (command: unknown, options: Readonly<{ abortSignal?: AbortSignal }>) => {
    assert.equal(options.abortSignal, signal);
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

  await storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier(
    createDirectStoreInput(signal, testWriter, testStorageCapability),
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
    (capability, writer) => {
      capabilityChecks += 1;
      assert.equal(capability, testStorageCapability);
      assert.equal(writer, testWriter);
    },
  );

  assert.deepEqual(sentCommands, [
    `put:${testBlobStorageKey}`,
    `head:${testBlobStorageKey}`,
  ]);
  assert.equal(capabilityChecks, 3);
});

test("direct conditional PutObject retries 409 without verification and succeeds on retry", async () => {
  const sentCommands: Array<string> = [];
  const signal = AbortSignal.timeout(10_000);
  const client = createTestS3Client();
  client.send = (async (
    command: unknown,
    options: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    assert.equal(options.abortSignal, signal);
    if (!(command instanceof PutObjectCommand)) {
      throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
    }
    sentCommands.push(`put:${String(command.input.Key)}`);
    if (sentCommands.length === 1) {
      throw createS3Error(409, "ConditionalRequestConflict", "Conditional write conflicted");
    }
    return {};
  }) as S3Client["send"];

  await storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier(
    createDirectStoreInput(signal, testWriter, testStorageCapability),
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
    () => {},
  );

  assert.deepEqual(sentCommands, [
    `put:${testBlobStorageKey}`,
    `put:${testBlobStorageKey}`,
  ]);
});

test("direct conditional winner verification maps unavailable HeadObject to retryable storage", async () => {
  const signal = AbortSignal.timeout(10_000);
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (
    command: unknown,
    options: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    assert.equal(options.abortSignal, signal);
    if (command instanceof PutObjectCommand) {
      sentCommands.push("put");
      throw createS3Error(412, "PreconditionFailed", "Object already exists");
    }
    if (command instanceof HeadObjectCommand) {
      sentCommands.push("head");
      throw createS3Error(403, "Forbidden", "Permanent object verification unavailable");
    }
    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier(
      createDirectStoreInput(signal, testWriter, testStorageCapability),
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
      () => {},
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_STORAGE_UNAVAILABLE");
      assert.deepEqual(error.details?.mediaAssetStorage, {
        operation: "put_object",
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        s3StatusCode: 403,
        s3ErrorClass: "Forbidden",
        reason: "storage_temporarily_unavailable",
        retryable: true,
      });
      return true;
    },
  );
  assert.deepEqual(sentCommands, ["put", "head", "head", "head"]);
});

test("direct permanent storage propagates one abort signal and keeps retries bounded", async () => {
  const signal = AbortSignal.timeout(10_000);
  const observedSignals: Array<AbortSignal | undefined> = [];
  const client = createTestS3Client();
  client.send = (async (
    _command: unknown,
    options: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    observedSignals.push(options.abortSignal);
    throw createS3Error(500, "InternalError", "retryable storage failure");
  }) as S3Client["send"];

  await assert.rejects(
    storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier(
      createDirectStoreInput(signal, testWriter, testStorageCapability),
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
      () => {},
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_STORAGE_UNAVAILABLE");
      return true;
    },
  );
  assert.deepEqual(observedSignals, [signal, signal, signal]);
});

test("final direct storage attempt preserves the live deadline abort reason", async () => {
  const controller = new AbortController();
  const deadlineError = new HttpError(
    503,
    "Media image ingestion cannot safely finish within its request deadline.",
    "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
  let sendCalls = 0;
  const client = createTestS3Client();
  client.send = (async (
    _command: unknown,
    options: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    assert.equal(options.abortSignal, controller.signal);
    sendCalls += 1;
    if (sendCalls < 3) {
      throw createS3Error(500, "InternalError", "retryable storage failure");
    }

    controller.abort(deadlineError);
    const abortError = new Error("Request aborted", { cause: deadlineError });
    abortError.name = "AbortError";
    throw abortError;
  }) as S3Client["send"];

  await assert.rejects(
    storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier(
      createDirectStoreInput(
        controller.signal,
        testWriter,
        testStorageCapability,
      ),
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
      () => {},
    ),
    (error: unknown) => {
      assert.equal(error, deadlineError);
      assert.ok(error instanceof HttpError);
      assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
      assert.equal(error.details?.retryAfterSeconds, 1);
      return true;
    },
  );
  assert.equal(sendCalls, 3);
});

test("aborting direct permanent storage stops the in-flight S3 request", async () => {
  const controller = new AbortController();
  let sendCalls = 0;
  const client = createTestS3Client();
  client.send = (async (
    _command: unknown,
    options: Readonly<{ abortSignal?: AbortSignal }>,
  ) => {
    sendCalls += 1;
    const signal = options.abortSignal;
    if (signal === undefined) throw new Error("Missing S3 abort signal.");
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      setImmediate(() => controller.abort(new Error("request deadline")));
    });
  }) as S3Client["send"];

  await assert.rejects(
    storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier(
      createDirectStoreInput(
        controller.signal,
        testWriter,
        testStorageCapability,
      ),
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
      () => {},
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      return true;
    },
  );
  assert.equal(sendCalls, 1);
});

test("missing, copied, mixed, expired, and payload-mismatched authority makes zero S3 calls", async () => {
  const invalidCapabilities = [
    undefined as unknown as DirectMediaBlobStorageCapability,
    Object.freeze({
      attemptToken: testWriter.attemptToken,
    }) as unknown as DirectMediaBlobStorageCapability,
    Object.freeze({ ...testStorageCapability }) as DirectMediaBlobStorageCapability,
    Object.freeze({
      expiredAt: "2026-07-27T09:59:59.000Z",
    }) as unknown as DirectMediaBlobStorageCapability,
  ];
  for (const capability of invalidCapabilities) {
    let sendCalls = 0;
    const client = createTestS3Client();
    client.send = (async () => {
      sendCalls += 1;
      return {};
    }) as S3Client["send"];
    await assert.rejects(
      storeMediaAssetBlobBytesIfAbsentWithDependencies(
        createDirectStoreInput(
          AbortSignal.timeout(10_000),
          testWriter,
          capability,
        ),
        {
          s3Client: client,
          getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
        },
      ),
      MediaBlobWriterFenceError,
    );
    assert.equal(sendCalls, 0);
  }

  let mismatchedSendCalls = 0;
  const mismatchedClient = createTestS3Client();
  mismatchedClient.send = (async () => {
    mismatchedSendCalls += 1;
    return {};
  }) as S3Client["send"];
  await assert.rejects(
    storeMediaAssetBlobBytesIfAbsentWithCapabilityVerifier(
      {
        ...createDirectStoreInput(
          AbortSignal.timeout(10_000),
          testWriter,
          testStorageCapability,
        ),
        mediaAssetId: "99999999-9999-4999-8999-999999999999",
      },
      {
        s3Client: mismatchedClient,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
      () => {},
    ),
    MediaBlobWriterFenceError,
  );
  assert.equal(mismatchedSendCalls, 0);
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
