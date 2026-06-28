import assert from "node:assert/strict";
import test from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { createBackendObservationScope } from "../observability/sentry";
import { HttpError } from "../shared/errors";
import {
  createPresignedMediaAssetUploadWithDependencies,
  loadMediaAssetObjectMetadataWithDependencies,
} from "./storage";

type S3Error = Error & {
  $metadata: Readonly<{
    httpStatusCode: number;
  }>;
};

const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const testStorageKey = `media-assets/workspaces/${testWorkspaceId}/media/${testMediaAssetId}/original`;
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

function createS3Error(statusCode: number): S3Error {
  const error = new Error("Forbidden") as S3Error;
  error.name = "Forbidden";
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

test("createPresignedMediaAssetUploadWithDependencies signs all returned required upload headers", async () => {
  const upload = await createPresignedMediaAssetUploadWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      storageKey: testStorageKey,
      mimeType: "image/png",
      sha256: "a".repeat(64),
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
        observationScope: testObservationScope,
      },
      {
        s3Client: createFailingS3Client(createS3Error(403)),
        getMediaAssetsStorageConfigFn: () => ({
          bucketName: "test-media-assets-bucket",
        }),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "MEDIA_ASSET_UPLOAD_NOT_FOUND");
      assert.deepEqual(error.details?.mediaAssetStorage, {
        operation: "head_object",
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        storageKey: testStorageKey,
        bucketName: "test-media-assets-bucket",
        s3StatusCode: 403,
        s3ErrorClass: "Forbidden",
        s3ErrorMessage: "Forbidden",
      });
      return true;
    },
  );
});
