import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import test from "node:test";
import {
  configureBackendRuntimeObservability,
  resetBackendRuntimeObservability,
} from "../../observability/runtime";
import type { BackendBreadcrumbEvent } from "../../observability/sentry/events";
import type { ReconcileMultipartMediaAssetUploadInput } from "./contracts";
import {
  MultipartCompletionReconciliationStorageTerminalError,
  MultipartCompletionReconciliationStorageTransientError,
} from "./errors";
import {
  createMultipartCompletedPartsFingerprint,
  reconcileMultipartMediaAssetUploadWithDependencies,
} from "./multipartReconciliation";
import {
  createHeadObjectResponse,
  createS3Error,
  getTestMediaAssetsStorageConfig,
  getUnexpectedS3CommandName,
  testBlobStorageKey,
  testLastOperationId,
  testMediaAssetId,
  testObservationScope,
  testSha256,
  testStagingStorageKey,
  testWorkspaceId,
} from "./testHelpers";

const listedParts = [
  {
    partNumber: 1,
    eTag: "\"part-one\"",
    sha256: "1".repeat(64),
  },
  {
    partNumber: 2,
    eTag: "\"part-two\"",
    sha256: "2".repeat(64),
  },
] as const;

function createListPartsResponse(): Readonly<{
  Parts: ReadonlyArray<Readonly<{
    PartNumber: number;
    ETag: string;
    ChecksumSHA256: string;
  }>>;
  IsTruncated: false;
}> {
  return {
    Parts: listedParts.map((part) => ({
      PartNumber: part.partNumber,
      ETag: part.eTag,
      ChecksumSHA256: Buffer.from(part.sha256, "hex").toString("base64"),
    })),
    IsTruncated: false,
  };
}

function createInput(
  completedPartsFingerprint: string,
  renewLease: () => Promise<void>,
): ReconcileMultipartMediaAssetUploadInput {
  return {
    workspaceId: testWorkspaceId,
    mediaAssetId: testMediaAssetId,
    stagingStorageKey: testStagingStorageKey,
    blobStorageKey: testBlobStorageKey,
    s3UploadId: "s3-upload-id",
    mimeType: "application/octet-stream",
    sizeBytes: 10,
    sha256: testSha256,
    lastOperationId: testLastOperationId,
    partCount: listedParts.length,
    completedPartsFingerprint,
    renewLease,
    signal: new AbortController().signal,
    observationScope: testObservationScope,
  };
}

function createMultipartHeadResponse(
  checksumType: "COMPOSITE" | "FULL_OBJECT",
  eTag: string,
): ReturnType<typeof createHeadObjectResponse> {
  return createHeadObjectResponse({
    sizeBytes: 10,
    mimeType: "application/octet-stream",
    sha256: testSha256,
    checksumSha256: checksumType === "FULL_OBJECT"
      ? testSha256
      : "a".repeat(64),
    checksumType,
    eTag,
  });
}

function createPermanentBlobHeadResponse(
  checksumSha256: string,
): ReturnType<typeof createHeadObjectResponse> {
  return {
    ...createHeadObjectResponse({
      sizeBytes: 10,
      mimeType: "application/octet-stream",
      sha256: testSha256,
      checksumSha256,
      checksumType: "FULL_OBJECT",
      eTag: "\"blob-etag\"",
    }),
    Metadata: {
      "flashcards-sha256": testSha256,
    },
  };
}

function createS3ClientWithSend(
  send: (command: unknown) => Promise<unknown>,
): S3Client {
  const s3Client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
  s3Client.send = send as S3Client["send"];
  return s3Client;
}

function createNormalizationBoundaryS3Client(
  onCopy: () => Promise<unknown>,
): S3Client {
  return createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        throw createS3Error(404, "NotFound", "missing blob");
      }
      return createMultipartHeadResponse(
        "COMPOSITE",
        "\"multipart-etag\"",
      );
    }
    if (command instanceof CopyObjectCommand) {
      assert.equal(command.input.Key, testStagingStorageKey);
      return onCopy();
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });
}

function createPromotionBoundaryS3Client(
  onCopy: () => Promise<unknown>,
): S3Client {
  return createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        throw createS3Error(404, "NotFound", "missing blob");
      }
      return createMultipartHeadResponse(
        "FULL_OBJECT",
        "\"normalized-etag\"",
      );
    }
    if (command instanceof CopyObjectCommand) {
      assert.equal(command.input.Key, testBlobStorageKey);
      return onCopy();
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });
}

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

test("accepts an exact permanent blob before reading expired staging state", async () => {
  const observedHeadKeys: Array<string | undefined> = [];
  const s3Client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
  s3Client.send = (async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      observedHeadKeys.push(command.input.Key);
      if (command.input.Key === testBlobStorageKey) {
        return createPermanentBlobHeadResponse(testSha256);
      }
      throw createS3Error(404, "NotFound", "expired staging");
    }
    throw new Error(`Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await reconcileMultipartMediaAssetUploadWithDependencies(
    createInput(
      createMultipartCompletedPartsFingerprint(listedParts),
      async () => undefined,
    ),
    { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
  );

  assert.deepEqual(observedHeadKeys, [testBlobStorageKey]);
});

test("rejects noncanonical permanent metadata without falling back to staging", async () => {
  let stagingRead = false;
  const s3Client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
  s3Client.send = (async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        return {
          ...createPermanentBlobHeadResponse(testSha256),
          Metadata: {
            "flashcards-sha256": testSha256,
            "flashcards-workspace-id": testWorkspaceId,
          },
        };
      }
      stagingRead = true;
      throw createS3Error(404, "NotFound", "expired staging");
    }
    throw new Error(`Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

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
      assert.equal(error.code, "MULTIPART_BLOB_OBJECT_MISMATCH");
      return true;
    },
  );
  assert.equal(stagingRead, false);
});

test("recovers completion between the initial staging HEAD and ListParts", async () => {
  let stagingState: "absent" | "composite" | "full" = "absent";
  let blobPresent = false;
  let completeCalls = 0;
  const copyKeys: Array<string | undefined> = [];
  const headKeys: Array<string | undefined> = [];
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      headKeys.push(command.input.Key);
      if (command.input.Key === testBlobStorageKey) {
        if (blobPresent === false) {
          throw createS3Error(404, "NotFound", "missing blob");
        }
        return createPermanentBlobHeadResponse(testSha256);
      }
      if (stagingState === "absent") {
        throw createS3Error(404, "NotFound", "missing staging");
      }
      return createMultipartHeadResponse(
        stagingState === "composite" ? "COMPOSITE" : "FULL_OBJECT",
        stagingState === "composite"
          ? "\"multipart-etag\""
          : "\"normalized-etag\"",
      );
    }
    if (command instanceof ListPartsCommand) {
      stagingState = "composite";
      throw createS3Error(
        404,
        "NoSuchUpload",
        "completion won before ListParts",
      );
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      completeCalls += 1;
      return {};
    }
    if (command instanceof CopyObjectCommand) {
      copyKeys.push(command.input.Key);
      if (command.input.Key === testStagingStorageKey) {
        stagingState = "full";
      } else {
        blobPresent = true;
      }
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

  assert.equal(completeCalls, 0);
  assert.deepEqual(copyKeys, [
    testStagingStorageKey,
    testBlobStorageKey,
  ]);
  assert.deepEqual(headKeys, [
    testBlobStorageKey,
    testStagingStorageKey,
    testBlobStorageKey,
    testStagingStorageKey,
    testStagingStorageKey,
    testBlobStorageKey,
    testBlobStorageKey,
  ]);
});

test("accepts exact permanent promotion observed after CompleteMultipartUpload NoSuchUpload", async () => {
  let blobHeadCalls = 0;
  let completeCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        blobHeadCalls += 1;
        if (blobHeadCalls === 1) {
          throw createS3Error(404, "NotFound", "missing blob");
        }
        return createPermanentBlobHeadResponse(testSha256);
      }
      throw createS3Error(404, "NotFound", "missing staging");
    }
    if (command instanceof ListPartsCommand) {
      return createListPartsResponse();
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      completeCalls += 1;
      throw createS3Error(
        404,
        "NoSuchUpload",
        "same-SHA promotion completed first",
      );
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

  assert.equal(blobHeadCalls, 2);
  assert.equal(completeCalls, 1);
});

test("resumes exact staging observed after CompleteMultipartUpload NoSuchUpload", async () => {
  let stagingState: "absent" | "composite" | "full" = "absent";
  let blobPresent = false;
  let completeCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        if (blobPresent) return createPermanentBlobHeadResponse(testSha256);
        throw createS3Error(404, "NotFound", "missing blob");
      }
      if (stagingState === "absent") {
        throw createS3Error(404, "NotFound", "missing staging");
      }
      return createMultipartHeadResponse(
        stagingState === "composite" ? "COMPOSITE" : "FULL_OBJECT",
        stagingState === "composite"
          ? "\"multipart-etag\""
          : "\"normalized-etag\"",
      );
    }
    if (command instanceof ListPartsCommand) {
      return createListPartsResponse();
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      completeCalls += 1;
      stagingState = "composite";
      throw createS3Error(404, "NoSuchUpload", "completion became visible");
    }
    if (command instanceof CopyObjectCommand) {
      if (command.input.Key === testStagingStorageKey) {
        stagingState = "full";
      } else {
        blobPresent = true;
      }
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

  assert.equal(completeCalls, 1);
  assert.equal(stagingState, "full");
  assert.equal(blobPresent, true);
});

test("rejects mismatched permanent promotion after CompleteMultipartUpload NoSuchUpload", async () => {
  let blobHeadCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        blobHeadCalls += 1;
        if (blobHeadCalls === 1) {
          throw createS3Error(404, "NotFound", "missing blob");
        }
        return createPermanentBlobHeadResponse("f".repeat(64));
      }
      throw createS3Error(404, "NotFound", "missing staging");
    }
    if (command instanceof ListPartsCommand) {
      return createListPartsResponse();
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      throw createS3Error(404, "NoSuchUpload", "promotion raced");
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
      assert.equal(error.code, "MULTIPART_BLOB_OBJECT_MISMATCH");
      return true;
    },
  );
});

test("rejects mismatched staging observed after CompleteMultipartUpload NoSuchUpload", async () => {
  let stagingHeadCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        throw createS3Error(404, "NotFound", "missing blob");
      }
      stagingHeadCalls += 1;
      if (stagingHeadCalls === 1) {
        throw createS3Error(404, "NotFound", "missing staging");
      }
      return {
        ...createMultipartHeadResponse("COMPOSITE", "\"multipart-etag\""),
        ContentLength: 11,
      };
    }
    if (command instanceof ListPartsCommand) {
      return createListPartsResponse();
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      throw createS3Error(404, "NoSuchUpload", "staging raced");
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
      assert.equal(error.code, "MULTIPART_STAGING_OBJECT_MISMATCH");
      return true;
    },
  );
});

test("terminalizes CompleteMultipartUpload NoSuchUpload only after both objects remain absent", async () => {
  let blobHeadCalls = 0;
  let stagingHeadCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        blobHeadCalls += 1;
      } else {
        stagingHeadCalls += 1;
      }
      throw createS3Error(404, "NotFound", "missing object");
    }
    if (command instanceof ListPartsCommand) {
      return createListPartsResponse();
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      throw createS3Error(404, "NoSuchUpload", "upload disappeared");
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
      assert.equal(error.code, "MULTIPART_UPLOAD_NOT_FOUND");
      return true;
    },
  );
  assert.equal(blobHeadCalls, 2);
  assert.equal(stagingHeadCalls, 3);
});

test("preserves lease loss and deadline during CompleteMultipartUpload NoSuchUpload recovery", async () => {
  const leaseLostError = new Error("multipart reconciliation lease lost");
  let renewals = 0;
  const leaseClient = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      throw createS3Error(404, "NotFound", "missing object");
    }
    if (command instanceof ListPartsCommand) {
      return createListPartsResponse();
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      throw createS3Error(404, "NoSuchUpload", "upload disappeared");
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });
  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => {
          renewals += 1;
          if (renewals === 5) throw leaseLostError;
        },
      ),
      {
        s3Client: leaseClient,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown) => error === leaseLostError,
  );

  const controller = new AbortController();
  const deadlineError = new Error("multipart reconciliation deadline");
  const deadlineClient = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      throw createS3Error(404, "NotFound", "missing object");
    }
    if (command instanceof ListPartsCommand) {
      return createListPartsResponse();
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      controller.abort(deadlineError);
      throw createS3Error(404, "NoSuchUpload", "upload disappeared");
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });
  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      {
        ...createInput(
          createMultipartCompletedPartsFingerprint(listedParts),
          async () => undefined,
        ),
        signal: controller.signal,
      },
      {
        s3Client: deadlineClient,
        getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig,
      },
    ),
    (error: unknown) => error === deadlineError,
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

test("accepts exact permanent promotion completed before ListParts", async () => {
  let blobPresent = false;
  let stagingHeadCalls = 0;
  let copyCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        if (blobPresent === false) {
          throw createS3Error(404, "NotFound", "missing blob");
        }
        return createPermanentBlobHeadResponse(testSha256);
      }
      stagingHeadCalls += 1;
      throw createS3Error(404, "NotFound", "missing staging");
    }
    if (command instanceof ListPartsCommand) {
      blobPresent = true;
      throw createS3Error(
        404,
        "NoSuchUpload",
        "promotion won before ListParts",
      );
    }
    if (command instanceof CopyObjectCommand) {
      copyCalls += 1;
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

  assert.equal(stagingHeadCalls, 1);
  assert.equal(copyCalls, 0);
});

test("rejects mismatched permanent promotion observed after NoSuchUpload", async () => {
  let blobHeadCalls = 0;
  let stagingHeadCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        blobHeadCalls += 1;
        if (blobHeadCalls === 1) {
          throw createS3Error(404, "NotFound", "missing blob");
        }
        return createPermanentBlobHeadResponse("f".repeat(64));
      }
      stagingHeadCalls += 1;
      throw createS3Error(404, "NotFound", "missing staging");
    }
    if (command instanceof ListPartsCommand) {
      throw createS3Error(404, "NoSuchUpload", "upload disappeared");
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
      assert.equal(error.code, "MULTIPART_BLOB_OBJECT_MISMATCH");
      return true;
    },
  );
  assert.equal(blobHeadCalls, 2);
  assert.equal(stagingHeadCalls, 1);
});

test("rejects mismatched staging completion observed after NoSuchUpload", async () => {
  let stagingHeadCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        throw createS3Error(404, "NotFound", "missing blob");
      }
      stagingHeadCalls += 1;
      if (stagingHeadCalls === 1) {
        throw createS3Error(404, "NotFound", "missing staging");
      }
      return {
        ...createMultipartHeadResponse(
          "COMPOSITE",
          "\"multipart-etag\"",
        ),
        ContentLength: 11,
      };
    }
    if (command instanceof ListPartsCommand) {
      throw createS3Error(404, "NoSuchUpload", "upload disappeared");
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
      assert.equal(error.code, "MULTIPART_STAGING_OBJECT_MISMATCH");
      return true;
    },
  );
  assert.equal(stagingHeadCalls, 2);
});

test("terminalizes NoSuchUpload only after both object rechecks remain absent", async () => {
  let blobHeadCalls = 0;
  let stagingHeadCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testBlobStorageKey) {
        blobHeadCalls += 1;
      } else {
        stagingHeadCalls += 1;
      }
      throw createS3Error(404, "NotFound", "missing object");
    }
    if (command instanceof ListPartsCommand) {
      throw createS3Error(404, "NoSuchUpload", "upload disappeared");
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
      assert.equal(error.code, "MULTIPART_UPLOAD_NOT_FOUND");
      return true;
    },
  );
  assert.equal(blobHeadCalls, 2);
  assert.equal(stagingHeadCalls, 2);
});

test("retries a transient permanent-object recheck after NoSuchUpload", async () => {
  let blobHeadCalls = 0;
  let renewals = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testStagingStorageKey) {
        throw createS3Error(404, "NotFound", "missing staging");
      }
      blobHeadCalls += 1;
      if (blobHeadCalls === 1) {
        throw createS3Error(404, "NotFound", "missing blob");
      }
      if (blobHeadCalls === 2) {
        throw createS3Error(500, "InternalError", "temporary HEAD failure");
      }
      return createPermanentBlobHeadResponse(testSha256);
    }
    if (command instanceof ListPartsCommand) {
      throw createS3Error(404, "NoSuchUpload", "upload disappeared");
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });

  await reconcileMultipartMediaAssetUploadWithDependencies(
    createInput(
      createMultipartCompletedPartsFingerprint(listedParts),
      async () => {
        renewals += 1;
      },
    ),
    { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
  );

  assert.equal(blobHeadCalls, 3);
  assert.equal(renewals, 5);
});

test("stops NoSuchUpload recovery at the active deadline", async () => {
  const controller = new AbortController();
  const deadlineError = new Error("multipart reconciliation deadline");
  let headCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      headCalls += 1;
      throw createS3Error(404, "NotFound", "missing object");
    }
    if (command instanceof ListPartsCommand) {
      controller.abort(deadlineError);
      throw createS3Error(404, "NoSuchUpload", "upload disappeared");
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });
  const input = {
    ...createInput(
      createMultipartCompletedPartsFingerprint(listedParts),
      async () => undefined,
    ),
    signal: controller.signal,
  };

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      input,
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === deadlineError,
  );
  assert.equal(headCalls, 2);
});

test("propagates lease loss before NoSuchUpload object rechecks", async () => {
  const leaseLostError = new Error("multipart reconciliation lease lost");
  let renewals = 0;
  let headCalls = 0;
  const s3Client = createS3ClientWithSend(async (command) => {
    if (command instanceof HeadObjectCommand) {
      headCalls += 1;
      throw createS3Error(404, "NotFound", "missing object");
    }
    if (command instanceof ListPartsCommand) {
      throw createS3Error(404, "NoSuchUpload", "upload disappeared");
    }
    throw new Error(
      `Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`,
    );
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => {
          renewals += 1;
          if (renewals === 4) throw leaseLostError;
        },
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === leaseLostError,
  );
  assert.equal(renewals, 4);
  assert.equal(headCalls, 2);
});

test("preserves a staging normalization lease renewal failure", async () => {
  const leaseError = new Error("staging normalization lease renewal failed");
  let renewals = 0;
  let copyCalls = 0;
  const s3Client = createNormalizationBoundaryS3Client(async () => {
    copyCalls += 1;
    return {};
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => {
          renewals += 1;
          if (renewals === 3) throw leaseError;
        },
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === leaseError,
  );
  assert.equal(renewals, 3);
  assert.equal(copyCalls, 0);
});

test("preserves cancellation before staging normalization", async () => {
  const controller = new AbortController();
  const cancellationError = new Error("staging normalization cancelled");
  let renewals = 0;
  let copyCalls = 0;
  const s3Client = createNormalizationBoundaryS3Client(async () => {
    copyCalls += 1;
    return {};
  });
  const input = {
    ...createInput(
      createMultipartCompletedPartsFingerprint(listedParts),
      async () => {
        renewals += 1;
        if (renewals === 3) controller.abort(cancellationError);
      },
    ),
    signal: controller.signal,
  };

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      input,
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === cancellationError,
  );
  assert.equal(renewals, 3);
  assert.equal(copyCalls, 0);
});

test("normalizes a genuine staging normalization S3 rejection", async () => {
  let copyCalls = 0;
  const s3Client = createNormalizationBoundaryS3Client(async () => {
    copyCalls += 1;
    throw createS3Error(400, "AccessDenied", "normalization rejected");
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
  assert.equal(copyCalls, 1);
});

test("preserves a blob promotion lease renewal failure", async () => {
  const leaseError = new Error("blob promotion lease renewal failed");
  let renewals = 0;
  let copyCalls = 0;
  const s3Client = createPromotionBoundaryS3Client(async () => {
    copyCalls += 1;
    return {};
  });

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput(
        createMultipartCompletedPartsFingerprint(listedParts),
        async () => {
          renewals += 1;
          if (renewals === 4) throw leaseError;
        },
      ),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === leaseError,
  );
  assert.equal(renewals, 4);
  assert.equal(copyCalls, 0);
});

test("preserves cancellation before blob promotion", async () => {
  const controller = new AbortController();
  const cancellationError = new Error("blob promotion cancelled");
  let renewals = 0;
  let copyCalls = 0;
  const s3Client = createPromotionBoundaryS3Client(async () => {
    copyCalls += 1;
    return {};
  });
  const input = {
    ...createInput(
      createMultipartCompletedPartsFingerprint(listedParts),
      async () => {
        renewals += 1;
        if (renewals === 4) controller.abort(cancellationError);
      },
    ),
    signal: controller.signal,
  };

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      input,
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => error === cancellationError,
  );
  assert.equal(renewals, 4);
  assert.equal(copyCalls, 0);
});

test("normalizes a genuine blob promotion S3 rejection", async () => {
  let copyCalls = 0;
  const s3Client = createPromotionBoundaryS3Client(async () => {
    copyCalls += 1;
    throw createS3Error(400, "AccessDenied", "promotion rejected");
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
  assert.equal(copyCalls, 1);
});

test("reconciles paginated multipart parts, normalizes staging, and promotes without GET", async () => {
  let stagingState: "absent" | "composite" | "full" = "absent";
  let blobPresent = false;
  let renewals = 0;
  const listCommands: Array<ListPartsCommand> = [];
  const completeCommands: Array<CompleteMultipartUploadCommand> = [];
  const copyCommands: Array<CopyObjectCommand> = [];
  const s3Client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
  s3Client.send = (async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testStagingStorageKey) {
        if (stagingState === "absent") {
          throw createS3Error(404, "NotFound", "missing staging");
        }
        return createMultipartHeadResponse(
          stagingState === "composite" ? "COMPOSITE" : "FULL_OBJECT",
          stagingState === "composite"
            ? "\"multipart-etag\""
            : "\"normalized-etag\"",
        );
      }
      if (command.input.Key === testBlobStorageKey) {
        if (blobPresent === false) {
          throw createS3Error(404, "NotFound", "missing blob");
        }
        return createPermanentBlobHeadResponse(testSha256);
      }
    }
    if (command instanceof ListPartsCommand) {
      listCommands.push(command);
      if (command.input.PartNumberMarker === undefined) {
        return {
          Parts: [{
            PartNumber: 1,
            ETag: listedParts[0].eTag,
            ChecksumSHA256: Buffer.from(
              listedParts[0].sha256,
              "hex",
            ).toString("base64"),
          }],
          IsTruncated: true,
          NextPartNumberMarker: "1",
        };
      }
      return {
        Parts: [{
          PartNumber: 2,
          ETag: listedParts[1].eTag,
          ChecksumSHA256: Buffer.from(
            listedParts[1].sha256,
            "hex",
          ).toString("base64"),
        }],
        IsTruncated: false,
      };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      completeCommands.push(command);
      stagingState = "composite";
      return {};
    }
    if (command instanceof CopyObjectCommand) {
      copyCommands.push(command);
      if (command.input.Key === testStagingStorageKey) {
        stagingState = "full";
      } else if (command.input.Key === testBlobStorageKey) {
        blobPresent = true;
      }
      return {};
    }
    throw new Error(`Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await reconcileMultipartMediaAssetUploadWithDependencies(
    createInput(
      createMultipartCompletedPartsFingerprint(listedParts),
      async () => {
        renewals += 1;
      },
    ),
    { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
  );

  assert.equal(listCommands.length, 2);
  assert.equal(listCommands[0]?.input.PartNumberMarker, undefined);
  assert.equal(listCommands[1]?.input.PartNumberMarker, "1");
  assert.equal(completeCommands.length, 1);
  assert.deepEqual(
    completeCommands[0]?.input.MultipartUpload?.Parts?.map((part) => ({
      partNumber: part.PartNumber,
      eTag: part.ETag,
      sha256: Buffer.from(part.ChecksumSHA256 ?? "", "base64").toString("hex"),
    })),
    listedParts,
  );
  assert.equal(copyCommands.length, 2);
  assert.equal(copyCommands[0]?.input.Key, testStagingStorageKey);
  assert.equal(copyCommands[0]?.input.CopySourceIfMatch, "\"multipart-etag\"");
  assert.equal(copyCommands[1]?.input.Key, testBlobStorageKey);
  assert.equal(copyCommands[1]?.input.IfNoneMatch, "*");
  assert.ok(renewals >= 9);
});

test("rejects a ListParts fingerprint mismatch before completing", async () => {
  let completed = false;
  const s3Client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
  s3Client.send = (async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      throw createS3Error(404, "NotFound", "missing staging");
    }
    if (command instanceof ListPartsCommand) {
      return {
        Parts: listedParts.map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.eTag,
          ChecksumSHA256: Buffer.from(part.sha256, "hex").toString("base64"),
        })),
        IsTruncated: false,
      };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      completed = true;
      return {};
    }
    throw new Error(`Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await assert.rejects(
    reconcileMultipartMediaAssetUploadWithDependencies(
      createInput("f".repeat(64), async () => undefined),
      { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
    ),
    (error: unknown) => {
      assert.ok(
        error instanceof MultipartCompletionReconciliationStorageTerminalError,
      );
      assert.equal(error.code, "MULTIPART_PARTS_FINGERPRINT_MISMATCH");
      return true;
    },
  );
  assert.equal(completed, false);
});

test("resumes unknown complete, normalization, and promotion outcomes from HEAD state", async () => {
  let stagingState: "absent" | "composite" | "full" = "absent";
  let blobPresent = false;
  let completeCalls = 0;
  let stagingCopyCalls = 0;
  let blobCopyCalls = 0;
  const s3Client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    region: "us-east-1",
  });
  s3Client.send = (async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key === testStagingStorageKey) {
        if (stagingState === "absent") {
          throw createS3Error(404, "NotFound", "missing staging");
        }
        return createMultipartHeadResponse(
          stagingState === "composite" ? "COMPOSITE" : "FULL_OBJECT",
          stagingState === "composite"
            ? "\"multipart-etag\""
            : "\"normalized-etag\"",
        );
      }
      if (blobPresent === false) {
        throw createS3Error(404, "NotFound", "missing blob");
      }
      return createPermanentBlobHeadResponse(testSha256);
    }
    if (command instanceof ListPartsCommand) {
      return {
        Parts: listedParts.map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.eTag,
          ChecksumSHA256: Buffer.from(part.sha256, "hex").toString("base64"),
        })),
        IsTruncated: false,
      };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      completeCalls += 1;
      stagingState = "composite";
      throw createS3Error(500, "InternalError", "unknown complete outcome");
    }
    if (command instanceof CopyObjectCommand) {
      if (command.input.Key === testStagingStorageKey) {
        stagingCopyCalls += 1;
        stagingState = "full";
        throw createS3Error(500, "InternalError", "unknown normalize outcome");
      }
      blobCopyCalls += 1;
      blobPresent = true;
      throw createS3Error(500, "InternalError", "unknown promote outcome");
    }
    throw new Error(`Unexpected S3 command: ${getUnexpectedS3CommandName(command)}`);
  }) as S3Client["send"];

  await reconcileMultipartMediaAssetUploadWithDependencies(
    createInput(
      createMultipartCompletedPartsFingerprint(listedParts),
      async () => undefined,
    ),
    { s3Client, getMediaAssetsStorageConfigFn: getTestMediaAssetsStorageConfig },
  );

  assert.equal(completeCalls, 1);
  assert.equal(stagingCopyCalls, 1);
  assert.equal(blobCopyCalls, 1);
});
