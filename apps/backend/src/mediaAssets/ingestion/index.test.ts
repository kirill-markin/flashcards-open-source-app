import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DatabaseCommitOutcomeUnknownError } from "../../database/transient";
import { createBackendObservationScope } from "../../observability/sentry";
import { HttpError } from "../../shared/errors";
import {
  beginDirectMediaBlobWriterAttemptWithOwner,
  type DirectMediaBlobStorageCapability,
  type DirectMediaBlobWriterAttemptExactInput,
  type DirectMediaBlobWriterAttemptInput,
  type DirectMediaBlobWriterAttemptLease,
  type DirectMediaBlobWriterAttemptResult,
  MediaBlobWriterOperationDeadlineExpiredError,
} from "../blobLifecycle";
import { buildMediaBlobStorageKey } from "../storageKeys";
import {
  imageJpegCardMediaBlobMimeType,
  imageJpegCardMediaBlobNormalizationVersion,
  passthroughMediaBlobNormalizationVersion,
  type MediaAsset,
  type MediaAssetImageIngestionMetadataInput,
  type MediaBlob,
  type NormalizedImageMediaAssetInput,
} from "../types";
import {
  directImageIngestionLeaseTerminalMarginMs,
  directImageIngestionMinimumAcquisitionBudgetMs,
  directImageIngestionRequestBudgetMs,
  directImageIngestionWorkCompletionMarginMs,
  ingestImageMediaAssetWithDependencies as ingestImageMediaAssetWithDependenciesAndDeadline,
  type DirectImageIngestionRequestDeadline,
  type ImageMediaAssetIngestionDependencies,
} from "./index";

const testUserId = "user-1";
const testWorkspaceId = "11111111-1111-4111-8111-111111111111";
const testMediaAssetId = "22222222-2222-4222-8222-222222222222";
const testMediaBlobId = "33333333-3333-4333-8333-333333333333";
const testReplicaId = "44444444-4444-4444-8444-444444444444";
const testAttemptToken = "66666666-6666-4666-8666-666666666666";
const testReservationToken = "77777777-7777-4777-8777-777777777777";
const testOperationId = "operation-image-1";
const testOriginalBytes = Buffer.from("original-image-bytes");
const testNormalizedBytes = Buffer.from("normalized-jpeg-bytes");
const testNormalizedSha256 = createHash("sha256").update(testNormalizedBytes).digest("hex");
const testStartedAtMs = Date.parse("2026-07-27T10:00:00.000Z");
const testObservationScope = createBackendObservationScope(
  "backend-api",
  "request-1",
  "/workspaces/:workspaceId/media-assets/images",
  "POST",
  testUserId,
  testWorkspaceId,
  null,
  null,
  null,
  null,
  null,
);

function createMetadata(): MediaAssetImageIngestionMetadataInput {
  return {
    mediaAssetId: testMediaAssetId,
    sourceUrl: "https://example.com/image.png",
    createdAt: "2026-02-28T09:00:00.000Z",
    clientUpdatedAt: "2026-02-28T10:00:00.000Z",
    lastModifiedByReplicaId: testReplicaId,
    lastOperationId: testOperationId,
  };
}

function createInput() {
  return {
    userId: testUserId,
    workspaceId: testWorkspaceId,
    metadata: createMetadata(),
    imageBytes: testOriginalBytes,
    observationScope: testObservationScope,
  };
}

function createDirectAttemptInput(): DirectMediaBlobWriterAttemptInput {
  const metadata = createMetadata();
  return {
    attemptToken: testAttemptToken,
    userId: testUserId,
    workspaceId: testWorkspaceId,
    mediaAssetId: metadata.mediaAssetId,
    operationId: metadata.lastOperationId,
    lastModifiedByReplicaId: metadata.lastModifiedByReplicaId,
    sha256: testNormalizedSha256,
    storageKey: buildMediaBlobStorageKey(testNormalizedSha256),
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes: testNormalizedBytes.byteLength,
    normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
    sourceUrl: metadata.sourceUrl,
    assetCreatedAt: metadata.createdAt,
    clientUpdatedAt: metadata.clientUpdatedAt,
  };
}

function createRequestDeadline(): DirectImageIngestionRequestDeadline {
  return {
    requestDeadlineAtMs: testStartedAtMs + directImageIngestionRequestBudgetMs,
    preprocessingDeadlineAtMs:
      testStartedAtMs
      + directImageIngestionRequestBudgetMs
      - directImageIngestionMinimumAcquisitionBudgetMs,
    requestSignal: new AbortController().signal,
    preprocessingSignal: new AbortController().signal,
    getRemainingInvocationTimeMs: () =>
      directImageIngestionRequestBudgetMs + 2_000,
    disposePreprocessing: () => {},
    dispose: () => {},
  };
}

function ingestImageMediaAssetWithDependencies(
  input: ReturnType<typeof createInput>,
  dependencies: ImageMediaAssetIngestionDependencies,
) {
  return ingestImageMediaAssetWithDependenciesAndDeadline(
    input,
    createRequestDeadline(),
    dependencies,
  );
}

function createMediaBlob(
  normalizationVersion: MediaBlob["normalizationVersion"],
): MediaBlob {
  return {
    mediaBlobId: testMediaBlobId,
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes: testNormalizedBytes.byteLength,
    sha256: testNormalizedSha256,
    storageKey: buildMediaBlobStorageKey(testNormalizedSha256),
    normalizationVersion,
    createdAt: "2026-02-28T10:00:01.000Z",
    updatedAt: "2026-02-28T10:00:01.000Z",
  };
}

function createMediaAsset(input: NormalizedImageMediaAssetInput): MediaAsset {
  return {
    mediaAssetId: input.mediaAssetId,
    workspaceId: testWorkspaceId,
    mimeType: imageJpegCardMediaBlobMimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    sourceUrl: input.sourceUrl,
    createdAt: input.createdAt,
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    lastOperationId: input.lastOperationId,
    updatedAt: "2026-02-28T10:00:01.000Z",
    deletedAt: null,
  };
}

function createCapability(): DirectMediaBlobStorageCapability {
  return Object.freeze({}) as DirectMediaBlobStorageCapability;
}

function acquiredAttempt(
  status: "acquired" | "replayed" | "expired_takeover",
  capability: DirectMediaBlobStorageCapability,
  normalizationVersion: MediaBlob["normalizationVersion"],
): DirectMediaBlobWriterAttemptResult {
  return {
    status,
    reservationToken: testReservationToken,
    normalizationVersion,
    leaseExpiresAt: new Date(
      testStartedAtMs
      + directImageIngestionRequestBudgetMs
      - directImageIngestionLeaseTerminalMarginMs,
    ).toISOString(),
    storageCapability: capability,
  };
}

type IngestionHarness = Readonly<{
  dependencies: ImageMediaAssetIngestionDependencies;
  setNowMs: (nowMs: number) => void;
  attemptTokenCalls: Array<string>;
  signalDeadlines: Array<Readonly<{ deadlineAtMs: number; phase: string }>>;
  beginCalls: Array<Readonly<{
    attemptToken: string;
    lease: DirectMediaBlobWriterAttemptLease;
  }>>;
  storageCalls: Array<Readonly<{
    writer: DirectMediaBlobWriterAttemptExactInput;
    storageCapability: DirectMediaBlobStorageCapability;
    signal: AbortSignal;
  }>>;
  applyCalls: Array<Readonly<{
    writer: DirectMediaBlobWriterAttemptExactInput;
    operationDeadlineAt: string;
  }>>;
  failureCalls: Array<DirectMediaBlobWriterAttemptExactInput>;
  revocationCalls: Array<DirectMediaBlobWriterAttemptExactInput>;
  waitCalls: Array<Readonly<{ leaseExpiresAt: string; requestDeadlineAtMs: number }>>;
  replayStatuses: Array<string>;
  replayDeadlines: Array<number>;
  reusableDeadlines: Array<number>;
  storageSignal: AbortSignal;
  abortHandleDisposals: Array<string>;
  capabilities: ReadonlyArray<DirectMediaBlobStorageCapability>;
}>;

function createHarness(reusableBlob: MediaBlob | null): IngestionHarness {
  let nowMs = testStartedAtMs;
  let beginCallCount = 0;
  const attemptTokenCalls: Array<string> = [];
  const signalDeadlines: IngestionHarness["signalDeadlines"][number][] = [];
  const beginCalls: IngestionHarness["beginCalls"][number][] = [];
  const storageCalls: IngestionHarness["storageCalls"][number][] = [];
  const applyCalls: IngestionHarness["applyCalls"][number][] = [];
  const failureCalls: Array<DirectMediaBlobWriterAttemptExactInput> = [];
  const revocationCalls: Array<DirectMediaBlobWriterAttemptExactInput> = [];
  const waitCalls: IngestionHarness["waitCalls"][number][] = [];
  const replayStatuses: Array<string> = [];
  const replayDeadlines: Array<number> = [];
  const reusableDeadlines: Array<number> = [];
  const storageSignal = new AbortController().signal;
  const abortHandleDisposals: Array<string> = [];
  const capabilities = [createCapability(), createCapability(), createCapability()];
  const normalizationVersion = reusableBlob?.normalizationVersion
    ?? imageJpegCardMediaBlobNormalizationVersion;

  return {
    attemptTokenCalls,
    signalDeadlines,
    beginCalls,
    storageCalls,
    applyCalls,
    failureCalls,
    revocationCalls,
    waitCalls,
    replayStatuses,
    replayDeadlines,
    reusableDeadlines,
    storageSignal,
    abortHandleDisposals,
    capabilities,
    setNowMs: (value) => {
      nowMs = value;
    },
    dependencies: {
      createAttemptTokenFn: () => {
        attemptTokenCalls.push(testAttemptToken);
        return testAttemptToken;
      },
      createAbortHandleFn: (deadlineAtMs, phase) => {
        signalDeadlines.push({ deadlineAtMs, phase });
        return {
          signal: storageSignal,
          dispose: () => abortHandleDisposals.push(phase),
        };
      },
      nowFn: () => nowMs,
      waitForWriterLeaseExpiryFn: async (leaseExpiresAt, requestDeadlineAtMs) => {
        waitCalls.push({ leaseExpiresAt, requestDeadlineAtMs });
      },
      normalizeImageBytesForCardFn: async (inputBytes) => {
        assert.deepEqual(inputBytes, testOriginalBytes);
        return {
          bytes: testNormalizedBytes,
          mimeType: imageJpegCardMediaBlobMimeType,
          sizeBytes: testNormalizedBytes.byteLength,
        };
      },
      beginDirectMediaBlobWriterAttemptWithOwnerFn: async (input, lease) => {
        beginCalls.push({ attemptToken: input.attemptToken, lease });
        const capability = capabilities[Math.min(beginCallCount, capabilities.length - 1)];
        if (capability === undefined) throw new Error("Missing test storage capability.");
        const status = beginCallCount === 0 ? "acquired" : "replayed";
        beginCallCount += 1;
        return acquiredAttempt(status, capability, normalizationVersion);
      },
      resolveDirectMediaBlobWriterAttemptAfterAccessRevocationFn: async (writer) => {
        revocationCalls.push(writer);
        return "unreferenced";
      },
      resolveDirectMediaBlobWriterAttemptFailureWithOwnerFn: async (writer) => {
        failureCalls.push(writer);
        return "unreferenced";
      },
      loadReusableImageMediaBlobForWorkspaceFn: async (
        userId,
        workspaceId,
        input,
        deadlineAtMs,
      ) => {
        assert.equal(userId, testUserId);
        assert.equal(workspaceId, testWorkspaceId);
        assert.equal(input.sha256, testNormalizedSha256);
        reusableDeadlines.push(deadlineAtMs);
        return reusableBlob;
      },
      replayImageNormalizedMediaAssetForWorkspaceFn: async (
        userId,
        workspaceId,
        input,
        status,
        requestDeadlineAtMs,
      ) => {
        assert.equal(userId, testUserId);
        assert.equal(workspaceId, testWorkspaceId);
        replayStatuses.push(status);
        replayDeadlines.push(requestDeadlineAtMs);
        return { mediaAsset: createMediaAsset(input), applied: false };
      },
      storeMediaAssetBlobBytesIfAbsentFn: async (input) => {
        storageCalls.push({
          writer: input.writer,
          storageCapability: input.storageCapability,
          signal: input.signal,
        });
        assert.equal(input.storageKey, buildMediaBlobStorageKey(testNormalizedSha256));
        assert.deepEqual(input.bytes, testNormalizedBytes);
      },
      applyImageNormalizedMediaAssetWithDirectWriterForWorkspaceFn: async (
        userId,
        workspaceId,
        input,
        writer,
        operationDeadlineAt,
      ) => {
        assert.equal(userId, testUserId);
        assert.equal(workspaceId, testWorkspaceId);
        applyCalls.push({ writer, operationDeadlineAt });
        return { mediaAsset: createMediaAsset(input), applied: true };
      },
    },
  };
}

test("direct ingestion uses one sub-29-second deadline, token, capability chain, and abort signal", async () => {
  const harness = createHarness(null);
  const result = await ingestImageMediaAssetWithDependencies(
    createInput(),
    harness.dependencies,
  );

  assert.equal(result.applied, true);
  assert.equal(directImageIngestionRequestBudgetMs, 13_000);
  assert.ok(directImageIngestionRequestBudgetMs < 29_000);
  assert.deepEqual(harness.attemptTokenCalls, [testAttemptToken]);
  assert.deepEqual(
    harness.beginCalls.map((call) => call.attemptToken),
    [testAttemptToken, testAttemptToken, testAttemptToken],
  );
  const operationDeadlineAt = new Date(
    testStartedAtMs
    + directImageIngestionRequestBudgetMs
    - directImageIngestionWorkCompletionMarginMs,
  ).toISOString();
  assert.ok(harness.beginCalls.every((call) => call.lease.operationDeadlineAt === operationDeadlineAt));
  assert.ok(harness.beginCalls.every(
    (call) => Date.parse(call.lease.leaseTargetAt)
      > Date.parse(call.lease.operationDeadlineAt),
  ));
  assert.deepEqual(harness.signalDeadlines, [{
    deadlineAtMs:
      testStartedAtMs
      + directImageIngestionRequestBudgetMs
      - directImageIngestionWorkCompletionMarginMs,
    phase: "storage_and_apply",
  },
  ]);
  assert.equal(harness.storageCalls.length, 1);
  assert.equal(harness.storageCalls[0]?.storageCapability, harness.capabilities[1]);
  assert.equal(harness.storageCalls[0]?.signal, harness.storageSignal);
  assert.equal(harness.storageCalls[0]?.writer.attemptToken, testAttemptToken);
  assert.equal(harness.applyCalls.length, 1);
  assert.equal(harness.applyCalls[0]?.operationDeadlineAt, operationDeadlineAt);
  assert.deepEqual(harness.reusableDeadlines, [
    Date.parse(operationDeadlineAt),
  ]);
  assert.deepEqual(harness.abortHandleDisposals, ["storage_and_apply"]);
  assert.deepEqual(harness.failureCalls, []);
});

test("an exhausted ingress budget stops before normalization, acquisition, or storage", async () => {
  const harness = createHarness(null);
  const requestDeadline = createRequestDeadline();
  harness.setNowMs(requestDeadline.preprocessingDeadlineAtMs);
  let normalizationCalls = 0;
  const dependencies: ImageMediaAssetIngestionDependencies = {
    ...harness.dependencies,
    normalizeImageBytesForCardFn: async () => {
      normalizationCalls += 1;
      throw new Error("Normalization must not start after its ingress cutoff.");
    },
  };

  await assert.rejects(
    ingestImageMediaAssetWithDependenciesAndDeadline(
      createInput(),
      requestDeadline,
      dependencies,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
      return true;
    },
  );
  assert.equal(normalizationCalls, 0);
  assert.deepEqual(harness.attemptTokenCalls, []);
  assert.deepEqual(harness.beginCalls, []);
  assert.deepEqual(harness.storageCalls, []);
  assert.deepEqual(harness.abortHandleDisposals, ["storage_and_apply"]);
});

test("direct ingestion rejects insufficient post-preprocessing budget before acquisition", async () => {
  const harness = createHarness(null);
  const dependencies: ImageMediaAssetIngestionDependencies = {
    ...harness.dependencies,
    normalizeImageBytesForCardFn: async (bytes) => {
      harness.setNowMs(
        testStartedAtMs
        + directImageIngestionRequestBudgetMs
        - directImageIngestionMinimumAcquisitionBudgetMs,
      );
      return harness.dependencies.normalizeImageBytesForCardFn(
        bytes,
        createRequestDeadline().preprocessingDeadlineAtMs,
        createRequestDeadline().preprocessingSignal,
      );
    },
  };

  await assert.rejects(
    ingestImageMediaAssetWithDependencies(createInput(), dependencies),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
      return true;
    },
  );
  assert.deepEqual(harness.attemptTokenCalls, []);
  assert.deepEqual(harness.beginCalls, []);
  assert.deepEqual(harness.storageCalls, []);
});

test("direct ingestion rejects insufficient storage budget before permanent mutation", async () => {
  const harness = createHarness(null);
  const begin = harness.dependencies.beginDirectMediaBlobWriterAttemptWithOwnerFn;
  let beginCalls = 0;
  const dependencies: ImageMediaAssetIngestionDependencies = {
    ...harness.dependencies,
    beginDirectMediaBlobWriterAttemptWithOwnerFn: async (input, lease) => {
      const result = await begin(input, lease);
      beginCalls += 1;
      if (beginCalls === 2) {
        harness.setNowMs(
          testStartedAtMs
          + directImageIngestionRequestBudgetMs
          - directImageIngestionWorkCompletionMarginMs
          - 6_000,
        );
      }
      return result;
    },
  };

  await assert.rejects(
    ingestImageMediaAssetWithDependencies(createInput(), dependencies),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
      return true;
    },
  );
  assert.deepEqual(harness.storageCalls, []);
  assert.deepEqual(harness.applyCalls, []);
  assert.equal(harness.failureCalls.length, 1);
});

test("direct ingestion terminalizes an acquired lease beyond its absolute target before storage", async () => {
  const harness = createHarness(null);
  const begin = harness.dependencies.beginDirectMediaBlobWriterAttemptWithOwnerFn;
  const dependencies: ImageMediaAssetIngestionDependencies = {
    ...harness.dependencies,
    beginDirectMediaBlobWriterAttemptWithOwnerFn: async (input, lease) => {
      const result = await begin(input, lease);
      if (!("reservationToken" in result)) {
        throw new Error("Test acquisition did not return an exact writer.");
      }
      return {
        ...result,
        leaseExpiresAt: new Date(Date.parse(lease.leaseTargetAt) + 1).toISOString(),
      };
    },
  };

  await assert.rejects(
    ingestImageMediaAssetWithDependencies(createInput(), dependencies),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
      return true;
    },
  );
  assert.equal(harness.beginCalls.length, 1);
  assert.equal(harness.failureCalls.length, 1);
  assert.deepEqual(harness.storageCalls, []);
  assert.deepEqual(harness.applyCalls, []);
});

test("direct ingestion terminalizes a late renewal before storage", async () => {
  const harness = createHarness(null);
  const begin = harness.dependencies.beginDirectMediaBlobWriterAttemptWithOwnerFn;
  let beginCalls = 0;
  const dependencies: ImageMediaAssetIngestionDependencies = {
    ...harness.dependencies,
    beginDirectMediaBlobWriterAttemptWithOwnerFn: async (input, lease) => {
      beginCalls += 1;
      const result = await begin(input, lease);
      if (beginCalls === 1 || !("reservationToken" in result)) {
        return result;
      }
      return {
        ...result,
        leaseExpiresAt: new Date(Date.parse(lease.leaseTargetAt) + 1).toISOString(),
      };
    },
  };

  await assert.rejects(
    ingestImageMediaAssetWithDependencies(createInput(), dependencies),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
      return true;
    },
  );
  assert.equal(harness.beginCalls.length, 2);
  assert.equal(harness.failureCalls.length, 1);
  assert.deepEqual(harness.storageCalls, []);
  assert.deepEqual(harness.applyCalls, []);
});

test("direct ingestion reuses compatible normalized or passthrough blobs and renews before apply", async () => {
  for (const normalizationVersion of [
    imageJpegCardMediaBlobNormalizationVersion,
    passthroughMediaBlobNormalizationVersion,
  ] as const) {
    const harness = createHarness(createMediaBlob(normalizationVersion));
    const result = await ingestImageMediaAssetWithDependencies(
      createInput(),
      harness.dependencies,
    );

    assert.equal(result.applied, true);
    assert.deepEqual(harness.storageCalls, []);
    assert.equal(harness.beginCalls.length, 2);
    assert.equal(harness.applyCalls.length, 1);
    assert.equal(
      harness.applyCalls[0]?.writer.normalizationVersion,
      normalizationVersion,
    );
  }
});

test("direct ingestion replays acquisition commit uncertainty with the same token", async () => {
  const harness = createHarness(
    createMediaBlob(imageJpegCardMediaBlobNormalizationVersion),
  );
  const begin = harness.dependencies.beginDirectMediaBlobWriterAttemptWithOwnerFn;
  let loseFirstResponse = true;
  const observedTokens: Array<string> = [];
  const dependencies: ImageMediaAssetIngestionDependencies = {
    ...harness.dependencies,
    beginDirectMediaBlobWriterAttemptWithOwnerFn: async (input, lease) => {
      observedTokens.push(input.attemptToken);
      if (loseFirstResponse) {
        loseFirstResponse = false;
        await begin(input, lease);
        throw new DatabaseCommitOutcomeUnknownError(new Error("begin response lost"));
      }
      return begin(input, lease);
    },
  };

  await ingestImageMediaAssetWithDependencies(createInput(), dependencies);
  assert.ok(observedTokens.length >= 2);
  assert.ok(observedTokens.every((token) => token === testAttemptToken));
  assert.deepEqual(harness.attemptTokenCalls, [testAttemptToken]);
});

test("initial acquisition expiry after unknown commit keeps the deadline response", async () => {
  const harness = createHarness(null);
  const begin = harness.dependencies
    .beginDirectMediaBlobWriterAttemptWithOwnerFn;
  const observedTokens: Array<string> = [];
  let beginCalls = 0;
  const dependencies: ImageMediaAssetIngestionDependencies = {
    ...harness.dependencies,
    beginDirectMediaBlobWriterAttemptWithOwnerFn: async (input, lease) => {
      observedTokens.push(input.attemptToken);
      beginCalls += 1;
      if (beginCalls === 1) {
        await begin(input, lease);
        harness.setNowMs(Date.parse(lease.operationDeadlineAt));
        throw new DatabaseCommitOutcomeUnknownError(
          new Error("begin response lost at operation deadline"),
        );
      }
      throw new MediaBlobWriterOperationDeadlineExpiredError();
    },
  };

  await assert.rejects(
    ingestImageMediaAssetWithDependencies(createInput(), dependencies),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
      assert.equal(error.details?.retryAfterSeconds, 1);
      return true;
    },
  );
  assert.deepEqual(observedTokens, [testAttemptToken, testAttemptToken]);
  assert.deepEqual(harness.attemptTokenCalls, [testAttemptToken]);
  assert.equal(harness.storageSignal.aborted, false);
  assert.deepEqual(harness.failureCalls, []);
  assert.deepEqual(harness.storageCalls, []);
  assert.deepEqual(harness.applyCalls, []);
});

test("busy and rejected acquisition statuses never enter storage, apply, or terminalization", async () => {
  const cases = [
    ["busy", 409],
    ["access_denied", 403],
    ["replica_mismatch", 400],
    ["ownership_mismatch", 409],
    ["writer_conflict", 409],
    ["cleanup_claimed", 503],
    ["stale", 409],
    ["stale_attempt", 409],
    ["unreferenced", 409],
    ["aborted", 409],
  ] as const;
  for (const [status, expectedStatusCode] of cases) {
    const harness = createHarness(null);
    const dependencies: ImageMediaAssetIngestionDependencies = {
      ...harness.dependencies,
      beginDirectMediaBlobWriterAttemptWithOwnerFn: async () => status === "busy"
        ? {
          status,
          leaseExpiresAt: new Date(testStartedAtMs + 1_000).toISOString(),
        }
        : { status },
    };
    await assert.rejects(
      ingestImageMediaAssetWithDependencies(createInput(), dependencies),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, expectedStatusCode);
        if (status === "busy") {
          assert.equal(error.code, "MEDIA_ASSET_WRITER_BUSY");
          assert.equal(error.details?.retryAfterSeconds, 1);
        }
        if (status === "cleanup_claimed") {
          assert.equal(error.code, "MEDIA_BLOB_LIFECYCLE_BUSY");
          assert.equal(error.details?.retryAfterSeconds, 1);
        }
        return true;
      },
    );
    assert.deepEqual(harness.storageCalls, []);
    assert.deepEqual(harness.applyCalls, []);
    assert.deepEqual(harness.failureCalls, []);
    assert.deepEqual(harness.revocationCalls, []);
  }
});

test("terminal acquisition replay returns matching peer state without storage", async () => {
  for (const status of [
    "already_applied",
    "live_applied",
    "referenced",
    "peer_conflict",
  ] as const) {
    const harness = createHarness(null);
    const result = await ingestImageMediaAssetWithDependencies(
      createInput(),
      {
        ...harness.dependencies,
        beginDirectMediaBlobWriterAttemptWithOwnerFn: async () => ({ status }),
      },
    );
    assert.equal(result.applied, false);
    assert.deepEqual(harness.replayStatuses, [status]);
    assert.deepEqual(harness.replayDeadlines, [
      testStartedAtMs + directImageIngestionRequestBudgetMs,
    ]);
    assert.deepEqual(harness.storageCalls, []);
    assert.deepEqual(harness.applyCalls, []);
  }
});

test("direct ingestion replays apply commit uncertainty with the exact writer and deadline", async () => {
  const harness = createHarness(
    createMediaBlob(imageJpegCardMediaBlobNormalizationVersion),
  );
  const apply = harness.dependencies
    .applyImageNormalizedMediaAssetWithDirectWriterForWorkspaceFn;
  const ambiguousCalls: IngestionHarness["applyCalls"][number][] = [];
  let loseFirstResponse = true;
  const dependencies: ImageMediaAssetIngestionDependencies = {
    ...harness.dependencies,
    applyImageNormalizedMediaAssetWithDirectWriterForWorkspaceFn: async (
      userId,
      workspaceId,
      input,
      writer,
      operationDeadlineAt,
    ) => {
      ambiguousCalls.push({ writer, operationDeadlineAt });
      if (loseFirstResponse) {
        loseFirstResponse = false;
        await apply(userId, workspaceId, input, writer, operationDeadlineAt);
        throw new DatabaseCommitOutcomeUnknownError(new Error("apply response lost"));
      }
      return { mediaAsset: createMediaAsset(input), applied: false };
    },
  };

  const result = await ingestImageMediaAssetWithDependencies(createInput(), dependencies);
  assert.equal(ambiguousCalls.length, 2);
  assert.deepEqual(ambiguousCalls[1], ambiguousCalls[0]);
  assert.equal(ambiguousCalls[0]?.writer.attemptToken, testAttemptToken);
  assert.equal(result.applied, false);
});

test("direct ingestion terminalizes before translating operation-deadline expiry", async () => {
  const harness = createHarness(
    createMediaBlob(imageJpegCardMediaBlobNormalizationVersion),
  );
  let applyCalls = 0;
  const dependencies: ImageMediaAssetIngestionDependencies = {
    ...harness.dependencies,
    applyImageNormalizedMediaAssetWithDirectWriterForWorkspaceFn: async (
      _userId,
      _workspaceId,
      _input,
      _writer,
      operationDeadlineAt,
    ) => {
      applyCalls += 1;
      harness.setNowMs(Date.parse(operationDeadlineAt));
      throw new MediaBlobWriterOperationDeadlineExpiredError();
    },
  };

  await assert.rejects(
    ingestImageMediaAssetWithDependencies(createInput(), dependencies),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED");
      assert.equal(error.details?.retryAfterSeconds, 1);
      return true;
    },
  );
  assert.equal(harness.storageSignal.aborted, false);
  assert.equal(applyCalls, 1);
  assert.equal(harness.failureCalls.length, 1);
  assert.deepEqual(harness.storageCalls, []);
});

test("direct writer distinguishes elapsed and excessive operation deadlines", () => {
  const nowMs = Date.now();
  assert.throws(
    () => beginDirectMediaBlobWriterAttemptWithOwner(
      createDirectAttemptInput(),
      {
        operationDeadlineAt: new Date(nowMs - 1).toISOString(),
        leaseTargetAt: new Date(nowMs + 1_000).toISOString(),
      },
    ),
    MediaBlobWriterOperationDeadlineExpiredError,
  );
  assert.throws(
    () => beginDirectMediaBlobWriterAttemptWithOwner(
      createDirectAttemptInput(),
      {
        operationDeadlineAt: new Date(nowMs + 3_700_000).toISOString(),
        leaseTargetAt: new Date(nowMs + 3_800_000).toISOString(),
      },
    ),
    RangeError,
  );
});

test("direct ingestion terminalizes revoked storage failure after lease expiry without a second mutation", async () => {
  const harness = createHarness(null);
  const storageError = new Error("permanent storage failed");
  const failureCalls: Array<Readonly<{
    writer: DirectMediaBlobWriterAttemptExactInput;
    deadline: string;
  }>> = [];
  const revocationCalls: Array<Readonly<{
    writer: DirectMediaBlobWriterAttemptExactInput;
    deadline: string;
  }>> = [];
  let storageCalls = 0;
  let failureCallsCount = 0;
  const dependencies: ImageMediaAssetIngestionDependencies = {
    ...harness.dependencies,
    storeMediaAssetBlobBytesIfAbsentFn: async () => {
      storageCalls += 1;
      throw storageError;
    },
    resolveDirectMediaBlobWriterAttemptFailureWithOwnerFn: async (
      writer,
      _cleanupDelayMs,
      deadline,
    ) => {
      failureCalls.push({ writer, deadline });
      failureCallsCount += 1;
      if (failureCallsCount === 1) {
        throw new DatabaseCommitOutcomeUnknownError(
          new Error("failure resolution response lost"),
        );
      }
      return "access_denied";
    },
    resolveDirectMediaBlobWriterAttemptAfterAccessRevocationFn: async (
      writer,
      _cleanupDelayMs,
      deadline,
    ) => {
      revocationCalls.push({ writer, deadline });
      if (revocationCalls.length === 1) {
        throw new DatabaseCommitOutcomeUnknownError(
          new Error("revocation resolution response lost"),
        );
      }
      return revocationCalls.length === 2 ? "busy" : "unreferenced";
    },
  };

  await assert.rejects(
    ingestImageMediaAssetWithDependencies(createInput(), dependencies),
    (error: unknown) => error === storageError,
  );
  assert.equal(storageCalls, 1);
  assert.equal(failureCalls.length, 2);
  assert.equal(revocationCalls.length, 3);
  assert.equal(harness.waitCalls.length, 1);
  assert.deepEqual(failureCalls[1], failureCalls[0]);
  assert.deepEqual(revocationCalls[1], revocationCalls[0]);
  assert.deepEqual(revocationCalls[2], revocationCalls[0]);
  assert.deepEqual(revocationCalls[0]?.writer, failureCalls[0]?.writer);
  assert.equal(failureCalls[0]?.writer.attemptToken, testAttemptToken);
  assert.equal(
    failureCalls[0]?.deadline,
    new Date(testStartedAtMs + directImageIngestionRequestBudgetMs).toISOString(),
  );
});
