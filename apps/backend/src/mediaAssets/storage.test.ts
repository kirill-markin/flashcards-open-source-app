import assert from "node:assert/strict";
import test from "node:test";
import {
  CopyObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createBackendObservationScope } from "../observability/sentry";
import { createPublicHttpErrorDetails, HttpError } from "../shared/errors";
import {
  assertMediaAssetObjectMatchesWithDependencies,
  createPresignedMediaAssetUploadWithDependencies,
  loadMediaAssetObjectMetadataWithDependencies,
  promoteMediaAssetUploadToBlobWithDependencies,
} from "./storage";
import {
  buildMediaBlobStorageKey,
  buildMediaUploadStagingStorageKey,
} from "./storageKeys";

type S3Error = Error & {
  $metadata: Readonly<{
    httpStatusCode: number;
  }>;
};

const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const testLastOperationId = "operation-media-1";
const testSha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
const testStorageKey = buildMediaBlobStorageKey(testSha256);
const testUploadStorageKey = buildMediaUploadStagingStorageKey(
  testWorkspaceId,
  testMediaAssetId,
  testLastOperationId,
);
const testObservationScope = createBackendObservationScope(
  "backend-api",
  "request-1",
  "/workspaces/:workspaceId/media-assets/:mediaAssetId/complete",
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

function createHeadObjectS3Client(fixture: Readonly<{
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  workspaceId: string;
  mediaAssetId: string;
  lastOperationIdSha256: string;
}>): S3Client {
  const client = createTestS3Client();
  client.send = (async () => ({
    ContentLength: fixture.sizeBytes,
    ContentType: fixture.mimeType,
    ChecksumSHA256: Buffer.from(fixture.sha256, "hex").toString("base64"),
    Metadata: {
      "flashcards-workspace-id": fixture.workspaceId,
      "flashcards-media-asset-id": fixture.mediaAssetId,
      "flashcards-last-operation-id-sha256": fixture.lastOperationIdSha256,
      "flashcards-sha256": fixture.sha256,
    },
  })) as S3Client["send"];
  return client;
}

function createHeadObjectResponse(fixture: Readonly<{
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  workspaceId?: string;
  mediaAssetId?: string;
  lastOperationIdSha256?: string;
}>): Readonly<{
  ContentLength: number;
  ContentType: string;
  ChecksumSHA256: string;
  Metadata: Readonly<Record<string, string>>;
}> {
  return {
    ContentLength: fixture.sizeBytes,
    ContentType: fixture.mimeType,
    ChecksumSHA256: Buffer.from(fixture.sha256, "hex").toString("base64"),
    Metadata: {
      ...(fixture.workspaceId === undefined ? {} : { "flashcards-workspace-id": fixture.workspaceId }),
      ...(fixture.mediaAssetId === undefined ? {} : { "flashcards-media-asset-id": fixture.mediaAssetId }),
      ...(fixture.lastOperationIdSha256 === undefined ? {} : { "flashcards-last-operation-id-sha256": fixture.lastOperationIdSha256 }),
      "flashcards-sha256": fixture.sha256,
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
  assert.match(upload.headers["x-amz-meta-flashcards-last-operation-id-sha256"] ?? "", /^[0-9a-f]{64}$/);
});

test("loadMediaAssetObjectMetadataWithDependencies treats HeadObject 403 as upload not found", async () => {
  await assert.rejects(
    async () => loadMediaAssetObjectMetadataWithDependencies(
      {
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        storageKey: testStorageKey,
        mimeType: "image/png",
        sizeBytes: 123,
        sha256: "a".repeat(64),
        lastOperationId: testLastOperationId,
        observationScope: testObservationScope,
      },
      {
        s3Client: createFailingS3Client(createS3Error(403, "Forbidden", `Forbidden for s3://test-media-assets-bucket/${testStorageKey}`)),
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
        storageKey: testStorageKey,
        bucketName: "test-media-assets-bucket",
        s3StatusCode: 403,
        s3ErrorClass: "Forbidden",
        s3ErrorMessage: `Forbidden for s3://test-media-assets-bucket/${testStorageKey}`,
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
  await assertMediaAssetObjectMatchesWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      storageKey: testStorageKey,
      mimeType: "image/png",
      sizeBytes: 42,
      sha256: testSha256,
      lastOperationId: testLastOperationId,
      observationScope: testObservationScope,
    },
    {
      s3Client: createHeadObjectS3Client({
        sizeBytes: 42,
        mimeType: "image/png",
        sha256: testSha256,
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        lastOperationIdSha256: "e12febdf2c87aabeb4f0594f67409b7ec07fe532eb25e0c9e9f8f4f3febb0d6d",
      }),
      getMediaAssetsStorageConfigFn: () => ({
        bucketName: "test-media-assets-bucket",
      }),
    },
  );
});

test("assertMediaAssetObjectMatchesWithDependencies rejects existing blobs without matching upload proof", async () => {
  await assert.rejects(
    async () => assertMediaAssetObjectMatchesWithDependencies(
      {
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        storageKey: testStorageKey,
        mimeType: "image/png",
        sizeBytes: 42,
        sha256: testSha256,
        lastOperationId: testLastOperationId,
        observationScope: testObservationScope,
      },
      {
        s3Client: createHeadObjectS3Client({
          sizeBytes: 42,
          mimeType: "image/png",
          sha256: testSha256,
          workspaceId: "33333333-3333-4333-8333-333333333333",
          mediaAssetId: "44444444-4444-4444-8444-444444444444",
          lastOperationIdSha256: "0".repeat(64),
        }),
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
      if (key === testUploadStorageKey) {
        return createHeadObjectResponse({
          sizeBytes: 42,
          mimeType: "image/png",
          sha256: testSha256,
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          lastOperationIdSha256: "e12febdf2c87aabeb4f0594f67409b7ec07fe532eb25e0c9e9f8f4f3febb0d6d",
        });
      }

      if (key === testStorageKey) {
        return createHeadObjectResponse({
          sizeBytes: 42,
          mimeType: "image/png",
          sha256: testSha256,
        });
      }
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
      blobStorageKey: testStorageKey,
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
    `head:${testStorageKey}`,
  ]);
});

test("promoteMediaAssetUploadToBlobWithDependencies copies staging upload when blob is missing", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      const key = command.input.Key;
      sentCommands.push(`head:${String(key)}`);
      if (key === testUploadStorageKey) {
        return createHeadObjectResponse({
          sizeBytes: 42,
          mimeType: "image/png",
          sha256: testSha256,
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          lastOperationIdSha256: "e12febdf2c87aabeb4f0594f67409b7ec07fe532eb25e0c9e9f8f4f3febb0d6d",
        });
      }

      if (key === testStorageKey && sentCommands.filter((value) => value === `head:${testStorageKey}`).length <= 3) {
        throw createS3Error(404, "NoSuchKey", "Not Found");
      }

      if (key === testStorageKey) {
        return createHeadObjectResponse({
          sizeBytes: 42,
          mimeType: "image/png",
          sha256: testSha256,
        });
      }
    }

    if (command instanceof CopyObjectCommand) {
      sentCommands.push(`copy:${String(command.input.CopySource)}:${String(command.input.Key)}:${String(command.input.IfNoneMatch)}`);
      return {};
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await promoteMediaAssetUploadToBlobWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      uploadStorageKey: testUploadStorageKey,
      blobStorageKey: testStorageKey,
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
    `head:${testStorageKey}`,
    `head:${testStorageKey}`,
    `head:${testStorageKey}`,
    `copy:test-media-assets-bucket/${testUploadStorageKey}:${testStorageKey}:*`,
    `head:${testStorageKey}`,
  ]);
});

test("promoteMediaAssetUploadToBlobWithDependencies rereads blob after concurrent conditional copy conflict", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      const key = command.input.Key;
      sentCommands.push(`head:${String(key)}`);
      if (key === testUploadStorageKey) {
        return createHeadObjectResponse({
          sizeBytes: 42,
          mimeType: "image/png",
          sha256: testSha256,
          workspaceId: testWorkspaceId,
          mediaAssetId: testMediaAssetId,
          lastOperationIdSha256: "e12febdf2c87aabeb4f0594f67409b7ec07fe532eb25e0c9e9f8f4f3febb0d6d",
        });
      }

      if (key === testStorageKey && sentCommands.filter((value) => value === `head:${testStorageKey}`).length <= 3) {
        throw createS3Error(404, "NoSuchKey", "Not Found");
      }

      if (key === testStorageKey) {
        return createHeadObjectResponse({
          sizeBytes: 42,
          mimeType: "image/png",
          sha256: testSha256,
        });
      }
    }

    if (command instanceof CopyObjectCommand) {
      sentCommands.push(`copy:${String(command.input.IfNoneMatch)}`);
      throw createS3Error(412, "PreconditionFailed", "Precondition Failed");
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await promoteMediaAssetUploadToBlobWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      uploadStorageKey: testUploadStorageKey,
      blobStorageKey: testStorageKey,
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
    `head:${testStorageKey}`,
    `head:${testStorageKey}`,
    `head:${testStorageKey}`,
    "copy:*",
    `head:${testStorageKey}`,
  ]);
});
