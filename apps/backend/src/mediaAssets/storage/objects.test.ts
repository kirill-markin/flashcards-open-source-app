import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import {
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPublicHttpErrorDetails, HttpError } from "../../shared/errors";
import {
  loadMediaAssetObjectBytesWithDependencies,
  type LoadMediaAssetObjectBytesInput,
} from ".";
import {
  createFailingS3Client,
  createS3Error,
  createTestS3Client,
  getTestMediaAssetsStorageConfig,
  getUnexpectedS3CommandName,
  testBlobStorageKey,
  testMediaAssetId,
  testObjectBytes,
  testObservationScope,
  testSha256,
  testWorkspaceId,
} from "./testHelpers";

function createLoadBytesInput(
  fixture: Readonly<{
    mimeType: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    maxByteSize: number;
  }>,
): LoadMediaAssetObjectBytesInput {
  return {
    workspaceId: testWorkspaceId,
    mediaAssetId: testMediaAssetId,
    storageKey: testBlobStorageKey,
    mimeType: fixture.mimeType,
    sizeBytes: fixture.sizeBytes,
    sha256: fixture.sha256,
    maxByteSize: fixture.maxByteSize,
    observationScope: testObservationScope,
  };
}

test("loadMediaAssetObjectBytesWithDependencies downloads verified object bytes", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      sentCommands.push([
        "get",
        String(command.input.Bucket),
        String(command.input.Key),
      ].join(":"));
      return {
        ContentLength: testObjectBytes.byteLength,
        Body: Readable.from([testObjectBytes]),
      };
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  const objectBytes = await loadMediaAssetObjectBytesWithDependencies(
    createLoadBytesInput({
      mimeType: "image/png",
      sizeBytes: testObjectBytes.byteLength,
      sha256: testSha256,
      maxByteSize: testObjectBytes.byteLength,
    }),
    {
      s3Client: client,
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
  );

  assert.equal(objectBytes.bytes.equals(testObjectBytes), true);
  assert.equal(objectBytes.mimeType, "image/png");
  assert.equal(objectBytes.sizeBytes, testObjectBytes.byteLength);
  assert.equal(objectBytes.sha256, testSha256);
  assert.deepEqual(sentCommands, [
    `get:test-media-assets-bucket:${testBlobStorageKey}`,
  ]);
});

test("loadMediaAssetObjectBytesWithDependencies treats missing objects as unavailable uploads", async () => {
  await assert.rejects(
    async () => loadMediaAssetObjectBytesWithDependencies(
      createLoadBytesInput({
        mimeType: "image/png",
        sizeBytes: testObjectBytes.byteLength,
        sha256: testSha256,
        maxByteSize: testObjectBytes.byteLength,
      }),
      {
        s3Client: createFailingS3Client(createS3Error(404, "NoSuchKey", `Missing s3://test-media-assets-bucket/${testBlobStorageKey}`)),
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_UPLOAD_NOT_FOUND");
      assert.doesNotMatch(error.message, /NoSuchKey|media\/blobs|s3:\/\//);
      assert.deepEqual(error.details?.mediaAssetStorage, {
        operation: "get_object",
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        s3StatusCode: 404,
        s3ErrorClass: "NoSuchKey",
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

test("loadMediaAssetObjectBytesWithDependencies rejects objects above the caller size cap", async () => {
  const sentCommands: Array<string> = [];
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      sentCommands.push(`get:${String(command.input.Key)}`);
      return {
        Body: Readable.from([
          Buffer.from("pass"),
          Buffer.from("word"),
        ]),
      };
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    async () => loadMediaAssetObjectBytesWithDependencies(
      createLoadBytesInput({
        mimeType: "image/png",
        sizeBytes: null,
        sha256: null,
        maxByteSize: testObjectBytes.byteLength - 1,
      }),
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 413);
      assert.equal(error.code, "MEDIA_ASSET_OBJECT_BYTES_TOO_LARGE");
      assert.match(error.message, /maxByteSize=7/);
      assert.match(error.message, /actualSizeBytes=8/);
      assert.doesNotMatch(error.message, /storageKey|media\/blobs|s3:\/\//);
      return true;
    },
  );
  assert.deepEqual(sentCommands, [
    `get:${testBlobStorageKey}`,
  ]);
});

test("loadMediaAssetObjectBytesWithDependencies rejects byte-size mismatches", async () => {
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      return {
        Body: Readable.from([testObjectBytes]),
      };
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    async () => loadMediaAssetObjectBytesWithDependencies(
      createLoadBytesInput({
        mimeType: "image/png",
        sizeBytes: testObjectBytes.byteLength + 1,
        sha256: testSha256,
        maxByteSize: testObjectBytes.byteLength + 1,
      }),
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_OBJECT_BYTES_MISMATCH");
      assert.match(error.message, /mismatchedFields=sizeBytes/);
      assert.doesNotMatch(error.message, /storageKey|media\/blobs|s3:\/\/|sha256=/);
      assert.doesNotMatch(error.message, new RegExp(testSha256));
      return true;
    },
  );
});

test("loadMediaAssetObjectBytesWithDependencies rejects sha256 mismatches", async () => {
  const bytes = Buffer.from("not-password");
  const client = createTestS3Client();
  client.send = (async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      return {
        Body: Readable.from([bytes]),
      };
    }

    throw new Error(`Unexpected S3 command ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    async () => loadMediaAssetObjectBytesWithDependencies(
      createLoadBytesInput({
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
        sha256: testSha256,
        maxByteSize: bytes.byteLength,
      }),
      {
        s3Client: client,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_OBJECT_BYTES_MISMATCH");
      assert.match(error.message, /mismatchedFields=sha256/);
      assert.doesNotMatch(error.message, /storageKey|media\/blobs|s3:\/\/|sha256=/);
      assert.doesNotMatch(error.message, new RegExp(testSha256));
      return true;
    },
  );
});
