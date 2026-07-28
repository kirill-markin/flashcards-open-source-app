import assert from "node:assert/strict";
import test from "node:test";
import {
  createPresignedMediaAssetDownloadWithDependencies,
  createPresignedMediaAssetUploadPartsWithDependencies,
  createPresignedMediaAssetUploadWithDependencies,
} from ".";
import {
  createTestS3Client,
  getTestMediaAssetsStorageConfig,
  testBlobStorageKey,
  testLastOperationId,
  testLastOperationIdSha256,
  testMediaAssetId,
  testObservationScope,
  testStagingStorageKey,
  testUploadStorageKey,
  testWorkspaceId,
} from "./testHelpers";

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
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
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

test("createPresignedMediaAssetUploadWithDependencies rejects permanent blob targets", async () => {
  await assert.rejects(
    createPresignedMediaAssetUploadWithDependencies(
      {
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        storageKey: testBlobStorageKey,
        mimeType: "image/png",
        sha256: "a".repeat(64),
        lastOperationId: testLastOperationId,
        observationScope: testObservationScope,
      },
      {
        s3Client: createTestS3Client(),
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    TypeError,
  );
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
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
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

test("createPresignedMediaAssetDownloadWithDependencies creates a direct range-compatible S3 GET URL", async () => {
  const download = await createPresignedMediaAssetDownloadWithDependencies(
    {
      workspaceId: testWorkspaceId,
      mediaAssetId: testMediaAssetId,
      storageKey: testBlobStorageKey,
      observationScope: testObservationScope,
    },
    {
      s3Client: createTestS3Client(),
      getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
    },
  );

  const downloadUrl = new URL(download.url);
  const signedHeaders = downloadUrl.searchParams.get("X-Amz-SignedHeaders");

  assert.equal(download.method, "GET");
  assert.equal(download.rangeRequests, true);
  assert.equal(downloadUrl.protocol, "https:");
  assert.equal(downloadUrl.hostname, "test-media-assets-bucket.s3.us-east-1.amazonaws.com");
  assert.equal(decodeURIComponent(downloadUrl.pathname), `/${testBlobStorageKey}`);
  assert.equal(signedHeaders, "host");
});
