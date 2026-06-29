import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createBackendObservationScope } from "../observability/sentry";
import { createPublicHttpErrorDetails, HttpError } from "../shared/errors";
import {
  assertMediaAssetObjectMatchesWithDependencies,
  completeMultipartMediaAssetUploadWithDependencies,
  createMultipartMediaAssetUploadWithDependencies,
  createPresignedMediaAssetUploadWithDependencies,
  createPresignedMediaAssetUploadPartsWithDependencies,
  loadMediaAssetObjectMetadataWithDependencies,
  promoteMediaAssetUploadToBlobWithDependencies,
} from "./storage";
import {
  buildMediaBlobStorageKey,
  buildMediaMultipartUploadStagingStorageKey,
  buildMediaUploadStagingStorageKey,
} from "./storageKeys";

type S3Error = Error & {
  $metadata: Readonly<{
    httpStatusCode: number;
  }>;
};

const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const testSessionId = "33333333-3333-4333-8333-333333333333";
const testLastOperationId = "operation-1";
const testLastOperationIdSha256 = "187f0349dd12b6dc73d76d86f421cd454facccc36ef9a2ba6956b37abbb31102";
const testSha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
const testObjectBytes = Buffer.from("password");
const testBlobStorageKey = buildMediaBlobStorageKey(testSha256);
const testUploadStorageKey = buildMediaUploadStagingStorageKey(
  testWorkspaceId,
  testMediaAssetId,
  testLastOperationId,
);
const testStagingStorageKey = buildMediaMultipartUploadStagingStorageKey(
  testWorkspaceId,
  testMediaAssetId,
  testSessionId,
);
const testObservationScope = createBackendObservationScope(
  "backend-api",
  "request-1",
  "/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/complete",
  "POST",
  "user-1",
  testWorkspaceId,
  null,
  null,
  null,
  null,
  null,
);

function createS3Error(statusCode: number, name: string, message: string): S3Error {
  const error = new Error(message) as S3Error;
  error.name = name;
  error.$metadata = {
    httpStatusCode: statusCode,
  };
  return error;
}

function createFailingS3Client(error: S3Error): S3Client {
  const client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
  client.send = (async () => {
    throw error;
  }) as S3Client["send"];
  return client;
}

function createTestS3Client(): S3Client {
  return new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
}

function createHeadObjectResponse(fixture: Readonly<{
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  workspaceId?: string;
  mediaAssetId?: string;
  lastOperationIdSha256?: string;
  checksumSha256?: string;
  checksumType?: "COMPOSITE" | "FULL_OBJECT";
}>): Readonly<{
  ContentLength: number;
  ContentType: string;
  ChecksumSHA256: string;
  ChecksumType: "COMPOSITE" | "FULL_OBJECT";
  Metadata: Readonly<Record<string, string>>;
}> {
  return {
    ContentLength: fixture.sizeBytes,
    ContentType: fixture.mimeType,
    ChecksumSHA256: Buffer.from(fixture.checksumSha256 ?? fixture.sha256, "hex").toString("base64"),
    ChecksumType: fixture.checksumType ?? "FULL_OBJECT",
    Metadata: {
      "flashcards-sha256": fixture.sha256,
      "flashcards-workspace-id": fixture.workspaceId ?? testWorkspaceId,
      "flashcards-media-asset-id": fixture.mediaAssetId ?? testMediaAssetId,
      "flashcards-last-operation-id-sha256": fixture.lastOperationIdSha256 ?? testLastOperationIdSha256,
    },
  };
}

function getUnexpectedS3CommandName(command: unknown): string {
  return typeof command === "object" && command !== null ? command.constructor.name : typeof command;
}

test("createPresignedMediaAssetUploadWithDependencies signs all returned required upload headers", async () => {
  const upload = await createPresignedMediaAssetUploadWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      storageKey: testUploadStorageKey,
      mimeType: "image/png",
      sha256: "a".repeat(64),
      lastOperationId: testLastOperationId,
      observationScope: testObservationScope,
    },
    {
      s3Client: createTestS3Client(),
      getMediaAssetsStorageConfigFn: () => ({
        bucketName: "test-media-assets-bucket",
      }),
    },
  );

  const signedHeaders = new URL(upload.url).searchParams.get("X-Amz-SignedHeaders");
  assert.notEqual(signedHeaders, null);
  const signedHeaderSet = new Set(signedHeaders?.split(";") ?? []);
  for (const headerName of Object.keys(upload.headers)) {
    assert.ok(signedHeaderSet.has(headerName), `Expected ${headerName} to be signed`);
  }
  assert.equal(upload.headers["x-amz-meta-flashcards-workspace-id"], testWorkspaceId);
  assert.equal(upload.headers["x-amz-meta-flashcards-media-asset-id"], testMediaAssetId);
  assert.equal(upload.headers["x-amz-meta-flashcards-sha256"], "a".repeat(64));
  assert.equal(upload.headers["x-amz-meta-flashcards-last-operation-id-sha256"], testLastOperationIdSha256);
});

test("createMultipartMediaAssetUploadWithDependencies starts uploads at a session-scoped staging key", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof CreateMultipartUploadCommand) {
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
      getMediaAssetsStorageConfigFn: () => ({
        bucketName: "test-media-assets-bucket",
      }),
    },
  );

  assert.equal(upload.storageKey, testStagingStorageKey);
  assert.equal(upload.s3UploadId, "s3-upload-id-1");
  assert.match(upload.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(sentCommands, [
    `${testStagingStorageKey}:image/png:SHA256:${testSha256}`,
  ]);
});

test("createPresignedMediaAssetUploadPartsWithDependencies signs per-part checksum headers", async () => {
  const partUrls = await createPresignedMediaAssetUploadPartsWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      stagingStorageKey: testStagingStorageKey,
      s3UploadId: "s3-upload-id-1",
      parts: [
        {
          partNumber: 1,
          sha256: "a".repeat(64),
        },
      ],
      observationScope: testObservationScope,
    },
    {
      s3Client: createTestS3Client(),
      getMediaAssetsStorageConfigFn: () => ({
        bucketName: "test-media-assets-bucket",
      }),
    },
  );

  const partUrl = partUrls[0];
  assert.notEqual(partUrl, undefined);
  assert.equal(partUrl?.method, "PUT");
  assert.equal(partUrl?.partNumber, 1);
  assert.equal(
    partUrl?.headers["x-amz-checksum-sha256"],
    Buffer.from("a".repeat(64), "hex").toString("base64"),
  );
  const signedHeaders = new URL(partUrl?.url ?? "").searchParams.get("X-Amz-SignedHeaders");
  assert.notEqual(signedHeaders, null);
  assert.ok(new Set(signedHeaders?.split(";") ?? []).has("x-amz-checksum-sha256"));
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
        getMediaAssetsStorageConfigFn: () => ({
          bucketName: "test-media-assets-bucket",
        }),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_UPLOAD_NOT_FOUND");
      assert.doesNotMatch(error.message, /Forbidden|media\/blobs|s3:\/\//);
      assert.deepEqual(error.details?.mediaAssetStorage, {
        operation: "head_object",
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        storageKey: testStagingStorageKey,
        bucketName: "test-media-assets-bucket",
        s3StatusCode: 403,
        s3ErrorClass: "Forbidden",
        s3ErrorMessage: `Forbidden for s3://test-media-assets-bucket/${testStagingStorageKey}`,
      });
      assert.deepEqual(createPublicHttpErrorDetails(error.details), {
        mediaAssetStorage: {
          operation: "head_object",
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          s3StatusCode: 403,
          s3ErrorClass: "Forbidden",
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
      getMediaAssetsStorageConfigFn: () => ({
        bucketName: "test-media-assets-bucket",
      }),
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
        getMediaAssetsStorageConfigFn: () => ({
          bucketName: "test-media-assets-bucket",
        }),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH");
      assert.doesNotMatch(error.message, /storageKey|media\/blobs|s3:\/\//);
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
      getMediaAssetsStorageConfigFn: () => ({
        bucketName: "test-media-assets-bucket",
      }),
    },
  );

  assert.deepEqual(sentCommands, [
    `head:${testUploadStorageKey}`,
    `head:${testBlobStorageKey}`,
  ]);
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
      getMediaAssetsStorageConfigFn: () => ({
        bucketName: "test-media-assets-bucket",
      }),
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
        getMediaAssetsStorageConfigFn: () => ({
          bucketName: "test-media-assets-bucket",
        }),
      },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_UPLOAD_MISMATCH");
      assert.doesNotMatch(error.message, /storageKey|media\/blobs|s3:\/\//);
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
        getMediaAssetsStorageConfigFn: () => ({
          bucketName: "test-media-assets-bucket",
        }),
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
        storageKey: testStagingStorageKey,
        bucketName: "test-media-assets-bucket",
        s3StatusCode: 403,
        s3ErrorClass: "Forbidden",
        s3ErrorMessage: `Forbidden for s3://test-media-assets-bucket/${testStagingStorageKey}`,
      });
      assert.deepEqual(createPublicHttpErrorDetails(error.details), {
        mediaAssetStorage: {
          operation: "get_object",
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          s3StatusCode: 403,
          s3ErrorClass: "Forbidden",
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
        getMediaAssetsStorageConfigFn: () => ({
          bucketName: "test-media-assets-bucket",
        }),
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
        storageKey: testStagingStorageKey,
        bucketName: "test-media-assets-bucket",
        s3StatusCode: 500,
        s3ErrorClass: "InternalError",
        s3ErrorMessage: `Failed complete for s3://test-media-assets-bucket/${testStagingStorageKey}`,
      });
      assert.deepEqual(createPublicHttpErrorDetails(error.details), {
        mediaAssetStorage: {
          operation: "complete_multipart_upload",
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          s3StatusCode: 500,
          s3ErrorClass: "InternalError",
        },
      });
      return true;
    },
  );
});
