import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
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
} from "../testHelpers";
import {
  createInput,
  createListPartsResponse,
  createMultipartHeadResponse,
  createPermanentBlobHeadResponse,
  createS3ClientWithSend,
  listedParts,
} from "./reconciliation.testSupport";

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

