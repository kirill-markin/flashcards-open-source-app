import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import test from "node:test";
import {
  configureBackendRuntimeObservability,
  resetBackendRuntimeObservability,
} from "../../../observability/runtime";
import type { BackendBreadcrumbEvent } from "../../../observability/sentry/events";
import {
  MultipartCompletionReconciliationStorageTerminalError,
  MultipartCompletionReconciliationStorageTransientError,
} from "../errors";
import {
  createMultipartCompletedPartsFingerprint,
  reconcileMultipartMediaAssetUploadWithDependencies,
} from "./reconciliation";
import {
  createS3Error,
  getTestMediaAssetsStorageConfig,
  getUnexpectedS3CommandName,
  testBlobStorageKey,
  testMediaAssetId,
  testObservationScope,
  testSha256,
  testWorkspaceId,
} from "../testHelpers";
import {
  createInput,
  createListPartsResponse,
  createMultipartHeadResponse,
  createNormalizationBoundaryS3Client,
  createPermanentBlobHeadResponse,
  createPromotionBoundaryS3Client,
  createS3ClientWithSend,
  listedParts,
} from "./reconciliation.testSupport";

test("preserves missing storage configuration before HEAD", async () => {
  const configurationError = new Error(
    "MEDIA_ASSETS_S3_BUCKET_NAME is required for media asset storage.",
  );
  let s3Calls = 0;
  const s3Client = createS3ClientWithSend(async () => {
    s3Calls += 1;
    return {};
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => undefined,
      ),
      {
        s3Client,
        getMediaAssetsStorageConfigFn: () => {
          throw configurationError;
        },
      },
    ),
    (error: unknown) => error === configurationError,
  );
  assert.equal(s3Calls, 0);
});

test("rejects invalid storage configuration before HEAD", async () => {
  let s3Calls = 0;
  const s3Client = createS3ClientWithSend(async () => {
    s3Calls += 1;
    return {};
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => undefined,
      ),
      {
        s3Client,
        getMediaAssetsStorageConfigFn: () => ({ bucketName: " " }),
      },
    ),
    {
      name: "Error",
      message:
        "Media asset storage bucket name must be a non-empty trimmed string.",
    },
  );
  assert.equal(s3Calls, 0);
});

test("preserves a local HEAD request-construction failure", async () => {
  const localError = new TypeError("local HEAD request construction failed");
  const s3Client = createS3ClientWithSend(async (command) => {
    assert.ok(command instanceof HeadObjectCommand);
    throw localError;
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => undefined,
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === localError,
  );
});

test("preserves a fake metadata-shaped error from HEAD", async () => {
  const localError = Object.assign(
    new Error("local error with HTTP-shaped metadata"),
    { $metadata: { httpStatusCode: 503 } },
  );
  const s3Client = createS3ClientWithSend(async (command) => {
    assert.ok(command instanceof HeadObjectCommand);
    throw localError;
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => undefined,
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === localError,
  );
});

test("treats an S3 403 HEAD response as an explicit storage rejection", async () => {
  let s3Calls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    assert.ok(command instanceof HeadObjectCommand);
    s3Calls += 1;
    throw createS3Error(403, "AccessDenied", "HEAD access denied");
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => undefined,
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => {
      assert.ok(
        error instanceof MultipartCompletionReconciliationStorageTerminalError,
      );
      assert.equal(error.code, "S3_REQUEST_REJECTED");
      return true;
    },
  );
  assert.equal(s3Calls, 1);
});

test("treats an S3 404 HEAD response as object absence", async () => {
  let blobPresent = false;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        if (blobPresent) return createPermanentBlobHeadResponse(testSha256);
        throw createS3Error(404, "NotFound", "missing blob");
      }
      return createMultipartHeadResponse("FULL_OBJECT", "\"staging-etag\"");
    }
    if (command instanceof CopyObjectCommand) {
      assert.equal(command.input.Key, testBlobStorageKey);
      blobPresent = true;
      return {};
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });

  await reconcileMultipartMediaAssetUploadWithDependencies(
    createInput(
      createMultipartCompletedPartsFingerprint(listedParts),
      async () => undefined,
    ),
    { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
  );

  assert.equal(blobPresent, true);
});

test("retries a real S3 service failure and an identified transport failure", async () => {
  const failures = [
    createS3Error(503, "ServiceUnavailable", "S3 temporarily unavailable"),
    Object.assign(new Error("socket timed out"), { code: "ETIMEDOUT" }),
  ] as const;

  for (const failure of failures) {
    let s3Calls = 0;
    const s3Client = createS3ClientWithSend(async (command) => {
      assert.ok(command instanceof HeadObjectCommand);
      s3Calls += 1;
      throw failure;
    });

    await assert.rejects(
      reconcileMultipartMediaAssetUploadWithDependencies(
        createInput(
          createMultipartCompletedPartsFingerprint(listedParts),
          async () => undefined,
        ),
        {
          s3Client,
          getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
        },
      ),
      (error: unknown) => {
        assert.ok(
          error
            instanceof MultipartCompletionReconciliationStorageTransientError,
        );
        assert.equal(error.operation, "head_object");
        return true;
      },
    );
    assert.equal(s3Calls, 3);
  }
});

test("preserves a local ListParts request-construction failure", async () => {
  const localError = new TypeError(
    "local ListParts request construction failed",
  );
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      throw createS3Error(404, "NotFound", "missing object");
    }
    if (command instanceof ListPartsCommand) throw localError;
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => undefined,
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === localError,
  );
});

test("preserves a local CompleteMultipartUpload request-construction failure", async () => {
  const localError = new TypeError(
    "local CompleteMultipartUpload request construction failed",
  );
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      throw createS3Error(404, "NotFound", "missing object");
    }
    if (command instanceof ListPartsCommand) {
      return {
        Parts: listedParts.map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.eTag,
          ChecksumSHA256: Buffer.from(
            part.sha256,
            "hex",
          ).toString("base64"),
        })),
        IsTruncated: false,
      };
    }
    if (command instanceof CompleteMultipartUploadCommand) throw localError;
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => undefined,
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === localError,
  );
});

test("preserves a local staging normalization request-construction failure", async () => {
  const localError = new TypeError(
    "local staging normalization request construction failed",
  );
  const s3Client = createNormalizationBoundaryS3Client(async () => {
    throw localError;
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => undefined,
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === localError,
  );
});

test("preserves a local blob promotion request-construction failure", async () => {
  const localError = new TypeError(
    "local blob promotion request construction failed",
  );
  const s3Client = createPromotionBoundaryS3Client(async () => {
    throw localError;
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => undefined,
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === localError,
  );
});

test("preserves sanitized runtime diagnostics for a terminal S3 rejection", async (context) => {
  const breadcrumbs: Array<BackendBreadcrumbEvent> = [];
  configureBackendRuntimeObservability(
    "multipart-completion-reconciliation",
    {
      addBreadcrumb: (event) => {
        breadcrumbs.push(event);
      },
      captureWarning: () => undefined,
      captureException: () => undefined,
    },
  );
  context.after(() => {
    resetBackendRuntimeObservability();
  });
  const s3Error = new S3ServiceException({
    name: "AccessDenied",
    $fault: "client",
    $metadata: {
      httpStatusCode: 400,
      requestId: "aws-request-id",
      extendedRequestId: "aws-extended-request-id",
    },
    message: "completion rejected with private provider context",
  });
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      throw createS3Error(404, "NotFound", "missing object");
    }
    if (command instanceof ListPartsCommand) {
      return createListPartsResponse();
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      throw s3Error;
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => undefined,
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => {
      assert.ok(
        error instanceof MultipartCompletionReconciliationStorageTerminalError,
      );
      assert.equal(error.code, "S3_REQUEST_REJECTED");
      assert.equal(error.cause, s3Error);
      assert.deepEqual(error.s3Diagnostics, {
        operation: "complete_multipart_upload",
        statusCode: 400,
        errorClass: "AccessDenied",
        awsRequestId: "aws-request-id",
        awsExtendedRequestId: "aws-extended-request-id",
      });
      return true;
    },
  );
  assert.deepEqual(breadcrumbs, [
    {
      action: "media_asset_storage_terminal",
      scope: testObservationScope,
      details: {
        workspaceId: testWorkspaceId,
        mediaAssetId: testMediaAssetId,
        operation: "complete_multipart_upload",
        statusCode: 400,
        errorClass: "AccessDenied",
        awsRequestId: "aws-request-id",
        awsExtendedRequestId: "aws-extended-request-id",
      },
    },
  ]);
  assert.equal(
    JSON.stringify(breadcrumbs).includes("private provider context"),
    false,
  );
});

