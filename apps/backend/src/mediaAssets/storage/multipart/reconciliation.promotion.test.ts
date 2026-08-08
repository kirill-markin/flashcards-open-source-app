import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import assert from "node:assert/strict";
import test from "node:test";
import {
  MultipartCompletionReconciliationStorageTerminalError,
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
  testSha256,
  testStagingStorageKey,
  testWorkspaceId,
} from "../testHelpers";
import {
  createInput,
  createMultipartHeadResponse,
  createNormalizationBoundaryS3Client,
  createPermanentBlobHeadResponse,
  createPromotionBoundaryS3Client,
  listedParts,
} from "./reconciliation.testSupport";

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

