import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { RequestAuthInputs } from "../auth/requestSecurity";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../database/transient";
import type {
  MultipartMediaBlobStorageCapability,
} from "../mediaAssets/uploadSessions";
import type {
  MediaAsset,
  MediaAssetUploadSession,
} from "../mediaAssets/types";
import { createBackendObservationScope } from "../observability/sentry";
import { HttpError } from "../shared/errors";
import type { AppEnv } from "../server/appEnv";
import type { RequestContext } from "../server/requestContext";
import {
  createMultipartCompletionRequestTiming,
  runWithMultipartCompletionRequestTiming,
} from "../server/mediaRequests/multipartCompletionRequestTiming";
import {
  createMultipartCompletionRequestDeadline,
  replayMultipartDatabaseCommitUnknownUntilDeadline,
} from "../mediaAssets/multipart/requestBoundary";
import {
  createMultipartCompletionResolutionError,
  createMultipartWriterHeartbeat,
  isExpiredMultipartCompletionCleanupRequired,
  replayCompletedMultipartResultWithDependencies,
  resolveMultipartOperationExactlyUntilSafe,
} from "../mediaAssets/multipart/writerLifecycle/writerLease";
import {
  completeMultipartUploadSessionAtApplicationBoundary,
  type MultipartCompletionApplicationDependencies,
} from "../mediaAssets/multipart/completion/completionBoundary";
import { createMediaAssetsRoutes } from "./mediaAssets";

const legacyWorkspaceId = "35274129-ef97-d366-954c-955b4bb0fbf0";
const uppercaseLegacyWorkspaceId = legacyWorkspaceId.toUpperCase();
const testMediaAssetId = "33333333-3333-4333-8333-333333333333";
const testReplicaId = "44444444-4444-4444-8444-444444444444";
const testTimestamp = "2026-07-28T10:00:00.000Z";

const requestAuthInputs: RequestAuthInputs = {
  authorizationHeader: undefined,
  sessionToken: undefined,
  csrfTokenHeader: undefined,
  originHeader: undefined,
  refererHeader: undefined,
  secFetchSiteHeader: undefined,
};

const requestContext: RequestContext = {
  userId: "user-1",
  subjectUserId: "subject-1",
  selectedWorkspaceId: legacyWorkspaceId,
  email: "user@example.com",
  locale: "en",
  userSettingsCreatedAt: testTimestamp,
  preferences: {
    reviewReactionAnimationsEnabled: true,
  },
  transport: "bearer",
  connectionId: null,
  guestSessionId: null,
  guestPlatform: null,
};

function createLoadedRequestContext(): Readonly<{
  requestAuthInputs: RequestAuthInputs;
  requestContext: RequestContext;
}> {
  return {
    requestAuthInputs,
    requestContext,
  };
}

function createMediaAssetsRouteTestApp(routes: Hono<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    context.set("clientAppVersion", null);
    context.set("clientPlatform", null);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      return context.json(
        { error: error.message, code: error.code },
        error.statusCode as ContentfulStatusCode,
      );
    }
    throw error;
  });
  app.route("/", routes);
  return app;
}

function createMediaAssetsTestApp(): Hono<AppEnv> {
  return createMediaAssetsRouteTestApp(
    createMediaAssetsRoutes({ allowedOrigins: [] }),
  );
}

function uploadSession(
  state: MediaAssetUploadSession["state"],
  expiresAt: string,
): MediaAssetUploadSession {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    mediaAssetId: "33333333-3333-4333-8333-333333333333",
    mediaBlobSha256: "a".repeat(64),
    stagingStorageKey: "media/staging/test",
    blobStorageKey: `media/blobs/${"a".repeat(64)}`,
    s3UploadId: "s3-upload-id",
    mimeType: "image/png",
    sizeBytes: 42,
    partSizeBytes: 42,
    partCount: 1,
    state,
    sourceUrl: null,
    assetCreatedAt: "2026-07-28T10:00:00.000Z",
    clientUpdatedAt: "2026-07-28T10:00:00.000Z",
    lastModifiedByReplicaId: "44444444-4444-4444-8444-444444444444",
    lastOperationId: "operation-1",
    expiresAt,
    createdAt: "2026-07-28T10:00:00.000Z",
    completedAt: null,
    abortedAt: null,
  };
}

function multipartResolutionTestScope() {
  return createBackendObservationScope(
    "backend-api",
    "request-1",
    "/workspaces/:workspaceId/media-assets/upload-sessions/:sessionId/complete",
    "POST",
    "user-1",
    "22222222-2222-4222-8222-222222222222",
    null,
    null,
    null,
    null,
    null,
  );
}

type MultipartCompletionBoundaryTestContext = Readonly<{
  timing: ReturnType<typeof createMultipartCompletionRequestTiming>;
  operationDeadline: ReturnType<
    typeof createMultipartCompletionRequestDeadline
  >;
  requestDeadline: ReturnType<
    typeof createMultipartCompletionRequestDeadline
  >;
  storageCapability: MultipartMediaBlobStorageCapability;
  run: (
    dependencies: MultipartCompletionApplicationDependencies,
  ) => ReturnType<typeof completeMultipartUploadSessionAtApplicationBoundary>;
  dispose: () => void;
}>;

function createMultipartCompletionBoundaryTestContext():
MultipartCompletionBoundaryTestContext {
  const observedAtMs = Date.now();
  const timing = createMultipartCompletionRequestTiming(
    observedAtMs,
    observedAtMs,
    60_000,
  );
  const operationDeadline = createMultipartCompletionRequestDeadline(
    timing.operationDeadlineAtMs,
  );
  const requestDeadline = createMultipartCompletionRequestDeadline(
    timing.requestDeadlineAtMs,
  );
  const session = uploadSession(
    "active",
    new Date(observedAtMs + 60_000).toISOString(),
  );
  return {
    timing,
    operationDeadline,
    requestDeadline,
    storageCapability: {} as MultipartMediaBlobStorageCapability,
    run: (dependencies) =>
      completeMultipartUploadSessionAtApplicationBoundary(
        "user-1",
        session,
        [{ partNumber: 1, eTag: "etag-1", sha256: "b".repeat(64) }],
        "66666666-6666-4666-8666-666666666666",
        multipartResolutionTestScope(),
        operationDeadline,
        timing.writerLeaseTargetAtMs,
        requestDeadline,
        dependencies,
      ),
    dispose: () => {
      operationDeadline.dispose();
      requestDeadline.dispose();
    },
  };
}

function createMultipartCompletionBoundaryTestDependencies(
  beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn:
    MultipartCompletionApplicationDependencies[
      "beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn"
    ],
  completeMultipartMediaAssetUploadFn:
    MultipartCompletionApplicationDependencies[
      "completeMultipartMediaAssetUploadFn"
    ],
  handoffCompletionAttemptAfterAccessRevocationFn:
    MultipartCompletionApplicationDependencies[
      "handoffCompletionAttemptAfterAccessRevocationFn"
    ],
  resolveCompletionAttemptFailureWithOwnerFn:
    MultipartCompletionApplicationDependencies[
      "resolveCompletionAttemptFailureWithOwnerFn"
    ],
): MultipartCompletionApplicationDependencies {
  return {
    abortMultipartMediaAssetUploadFn: async () => {
      throw new Error("Completion recovery must not abort storage.");
    },
    beginCompletionAttemptAtLeaseTargetWithOwnerUntilSettledFn,
    completeMultipartMediaAssetUploadFn,
    completeMediaAssetUploadSessionForWorkspaceFn: async () => {
      throw new Error("Completion test must not enter database apply.");
    },
    handoffCompletionAttemptAfterAccessRevocationFn,
    loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn: async () => {
      throw new Error("Completion test must not replay a completed asset.");
    },
    resolveCompletionAttemptFailureWithOwnerFn,
  };
}

test("uppercase historical workspace path reaches direct image ingestion as lowercase", async () => {
  const forwardedWorkspaceIds: Array<string> = [];
  const app = createMediaAssetsRouteTestApp(createMediaAssetsRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestWithAbortSignalFn: async () =>
      createLoadedRequestContext(),
    assertUserHasWorkspaceAccessFn: async (_userId, workspaceId) => {
      forwardedWorkspaceIds.push(workspaceId);
    },
    assertImageMediaAssetIngestionPreconditionsForWorkspaceFn:
      async (_userId, workspaceId) => {
        forwardedWorkspaceIds.push(workspaceId);
      },
    ingestImageMediaAssetWithRequestDeadlineFn: async (input) => {
      forwardedWorkspaceIds.push(input.workspaceId);
      return {
        mediaAsset: {
          mediaAssetId: testMediaAssetId,
          workspaceId: input.workspaceId,
          mimeType: "image/jpeg",
          sizeBytes: 1,
          sha256: "a".repeat(64),
          sourceUrl: null,
          createdAt: testTimestamp,
          clientUpdatedAt: testTimestamp,
          lastModifiedByReplicaId: testReplicaId,
          lastOperationId: "operation-1",
          updatedAt: testTimestamp,
          deletedAt: null,
        },
        applied: true,
      };
    },
  }));

  const response = await app.request(
    `http://localhost/workspaces/${uppercaseLegacyWorkspaceId}/media-assets/images`,
    {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-media-asset-id": testMediaAssetId,
        "x-media-created-at": testTimestamp,
        "x-media-client-updated-at": testTimestamp,
        "x-media-last-modified-by-replica-id": testReplicaId,
        "x-media-last-operation-id": "operation-1",
      },
      body: new Uint8Array([1]),
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(forwardedWorkspaceIds, [
    legacyWorkspaceId,
    legacyWorkspaceId,
    legacyWorkspaceId,
  ]);
});

test("uppercase historical workspace path reaches multipart create and replay as lowercase", async () => {
  const forwardedWorkspaceIds: Array<string> = [];
  const session = uploadSession(
    "active",
    new Date(Date.now() + 60_000).toISOString(),
  );
  const app = createMediaAssetsRouteTestApp(createMediaAssetsRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => createLoadedRequestContext(),
    assertUserHasWorkspaceAccessFn: async (_userId, workspaceId) => {
      assert.equal(workspaceId, legacyWorkspaceId);
    },
    multipartUploadSessionCreationApplicationDependencies: {
      abortMultipartMediaAssetUploadUntilDeadlineFn: async () => {
        throw new Error("Finalized creation replay must not abort storage.");
      },
      acquireCreationClaimFn: async (_userId, workspaceId) => {
        forwardedWorkspaceIds.push(workspaceId);
        return {
          status: "finalized",
          uploadSessionId: session.sessionId,
        };
      },
      createMediaAssetFromAvailableBlobForWorkspaceFn: async () => {
        throw new Error("Finalized creation replay must not create media.");
      },
      createMultipartMediaAssetUploadFn: async () => {
        throw new Error("Finalized creation replay must not create storage.");
      },
      loadCreationReplayFn: async (_userId, workspaceId) => {
        forwardedWorkspaceIds.push(workspaceId);
        return {
          state: "active",
          uploadSession: {
            ...session,
            workspaceId,
          },
        };
      },
      recordUploadSessionWithCreationClaimFn: async () => {
        throw new Error("Finalized creation replay must not record a session.");
      },
      releaseCreationClaimFn: async () => {
        throw new Error("Finalized creation replay must not release its claim.");
      },
    },
  }));
  const requestBody = JSON.stringify({
    mediaAssetId: testMediaAssetId,
    mimeType: "image/png",
    sizeBytes: 1,
    sha256: "a".repeat(64),
    partSizeBytes: 1,
    partCount: 1,
    sourceUrl: null,
    createdAt: testTimestamp,
    clientUpdatedAt: testTimestamp,
    lastModifiedByReplicaId: testReplicaId,
    lastOperationId: "operation-1",
  });
  const requestUrl =
    `http://localhost/workspaces/${uppercaseLegacyWorkspaceId}/media-assets/upload-sessions`;

  const replayResponse = await app.request(requestUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: requestBody,
  });

  assert.equal(replayResponse.status, 201);
  const replayResponseBody = await replayResponse.json() as Readonly<{
    workspaceId: string;
  }>;
  assert.equal(replayResponseBody.workspaceId, legacyWorkspaceId);
  assert.deepEqual(forwardedWorkspaceIds, [
    legacyWorkspaceId,
    legacyWorkspaceId,
  ]);
});

test("expired multipart completion cleanup resumes only active or aborting sessions", () => {
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  const futureAt = new Date(Date.now() + 60_000).toISOString();

  assert.equal(
    isExpiredMultipartCompletionCleanupRequired(
      uploadSession("active", expiredAt),
    ),
    true,
  );
  assert.equal(
    isExpiredMultipartCompletionCleanupRequired(
      uploadSession("aborting", expiredAt),
    ),
    true,
  );
  assert.equal(
    isExpiredMultipartCompletionCleanupRequired(
      uploadSession("completing", expiredAt),
    ),
    false,
  );
  assert.equal(
    isExpiredMultipartCompletionCleanupRequired(
      uploadSession("aborting", futureAt),
    ),
    false,
  );
});

test("multipart completion rejects an ingress-expired request before authentication or writer mutation", async () => {
  const nowMs = Date.now();
  const timing = createMultipartCompletionRequestTiming(
    nowMs - 12_000,
    nowMs - 12_000,
    60_000,
  );
  const app = createMediaAssetsTestApp();

  const response = await runWithMultipartCompletionRequestTiming(
    timing,
    async () => app.request(
      "http://localhost/workspaces/22222222-2222-4222-8222-222222222222/media-assets/upload-sessions/11111111-1111-4111-8111-111111111111/complete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parts: [] }),
      },
    ),
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error:
      "Multipart completion could not safely finish within the request deadline. Retry the same completion request without aborting the upload session.",
    code: "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
  });
});

test("multipart commit-unknown replay is bounded by the exact request deadline", async () => {
  const controller = new AbortController();
  const deadlineError = new HttpError(
    503,
    "Multipart completion deadline reached.",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
  const timer = setTimeout(() => controller.abort(deadlineError), 35);
  let attempts = 0;
  try {
    await assert.rejects(
      replayMultipartDatabaseCommitUnknownUntilDeadline(
        async () => {
          attempts += 1;
          throw new DatabaseCommitOutcomeUnknownError(
            new Error("Commit response lost."),
          );
        },
        Date.now() + 500,
        controller.signal,
      ),
      (error: unknown): boolean => error === deadlineError,
    );
  } finally {
    clearTimeout(timer);
  }
  assert.ok(attempts >= 1);
  assert.ok(attempts <= 3);
});

test("multipart exact resolution retries transient and unknown database outcomes", async () => {
  const requestDeadline = createMultipartCompletionRequestDeadline(
    Date.now() + 1_000,
  );
  let transientAttempts = 0;
  let unknownCommitAttempts = 0;
  try {
    const transientResult =
      await resolveMultipartOperationExactlyUntilSafe(
        async () => {
          transientAttempts += 1;
          if (transientAttempts < 3) {
            throw new TransientDatabaseHttpError(
              Object.assign(
                new Error("Database connection was interrupted."),
                { code: "08006" },
              ),
            );
          }
          return "handed_off" as const;
        },
        Date.now() + 600,
        requestDeadline,
        multipartResolutionTestScope(),
      );
    assert.deepEqual(transientResult, {
      kind: "resolved",
      value: "handed_off",
    });
    assert.equal(transientAttempts, 3);

    const unknownCommitResult =
      await resolveMultipartOperationExactlyUntilSafe(
        async () => {
          unknownCommitAttempts += 1;
          if (unknownCommitAttempts === 1) {
            throw new DatabaseCommitOutcomeUnknownError(
              new Error("Handoff commit response was lost."),
            );
          }
          return "already_pending" as const;
        },
        Date.now() + 600,
        requestDeadline,
        multipartResolutionTestScope(),
      );
    assert.deepEqual(unknownCommitResult, {
      kind: "resolved",
      value: "already_pending",
    });
    assert.equal(unknownCommitAttempts, 2);
  } finally {
    requestDeadline.dispose();
  }
});

test("persistent multipart resolution failure returns only after the stopped writer lease is safely expired", async () => {
  const observedAtMs = Date.now();
  const leaseExpiresAtMs = observedAtMs + 100;
  const requestDeadline = createMultipartCompletionRequestDeadline(
    observedAtMs + 1_000,
  );
  let attempts = 0;
  try {
    const result = await resolveMultipartOperationExactlyUntilSafe(
      async () => {
        attempts += 1;
        throw new TransientDatabaseHttpError(
          Object.assign(
            new Error("Database remains unavailable."),
            { code: "08006" },
          ),
        );
      },
      leaseExpiresAtMs,
      requestDeadline,
      multipartResolutionTestScope(),
    );

    assert.equal(result.kind, "safe_lease_expired");
    if (result.kind === "safe_lease_expired") {
      assert.ok(result.resolutionError instanceof TransientDatabaseHttpError);
    }
    assert.ok(Date.now() >= leaseExpiresAtMs);
    assert.ok(attempts >= 1);
  } finally {
    requestDeadline.dispose();
  }
});

test("stalled multipart heartbeat aborts and awaits blocked storage before its confirmed lease expires", async () => {
  const observedAtMs = Date.now();
  const leaseExpiresAtMs = observedAtMs + 200;
  const storageCapability =
    {} as MultipartMediaBlobStorageCapability;
  let releaseRenewal!: () => void;
  const renewalRelease = new Promise<void>((resolveRelease) => {
    releaseRenewal = resolveRelease;
  });
  let signalRenewalStarted!: () => void;
  const renewalStarted = new Promise<void>((resolveStarted) => {
    signalRenewalStarted = resolveStarted;
  });
  const heartbeat = createMultipartWriterHeartbeat(
    {
      storageCapability,
      leaseExpiresAt: new Date(leaseExpiresAtMs).toISOString(),
    },
    new AbortController().signal,
    observedAtMs + 800,
    observedAtMs + 1_000,
    75,
    10,
    async () => {
      signalRenewalStarted();
      await renewalRelease;
      throw new TransientDatabaseHttpError(
        Object.assign(
          new Error("Heartbeat database operation stalled."),
          { code: "08006" },
        ),
      );
    },
  );
  let storageStoppedAtMs: number | null = null;
  const blockedStorage = new Promise<void>((_resolve, reject) => {
    const stopStorage = (): void => {
      storageStoppedAtMs = Date.now();
      reject(heartbeat.signal.reason);
    };
    heartbeat.signal.addEventListener("abort", stopStorage, { once: true });
  });

  await renewalStarted;
  await assert.rejects(blockedStorage);
  assert.ok(storageStoppedAtMs !== null);
  assert.ok(storageStoppedAtMs < leaseExpiresAtMs);
  releaseRenewal();
  await heartbeat.stop();
  assert.equal(
    heartbeat.getLastConfirmedLeaseExpiresAtMs(),
    leaseExpiresAtMs,
  );
});

test("multipart storage authorization rejects an elapsed absolute cutoff before its delayed timer fires", async () => {
  const observedAtMs = Date.now();
  const operationDeadlineAtMs = observedAtMs + 40;
  const operationDeadline = createMultipartCompletionRequestDeadline(
    operationDeadlineAtMs,
  );
  const heartbeat = createMultipartWriterHeartbeat(
    {
      storageCapability:
        {} as MultipartMediaBlobStorageCapability,
      leaseExpiresAt: new Date(observedAtMs + 300).toISOString(),
    },
    operationDeadline.signal,
    operationDeadlineAtMs,
    observedAtMs + 400,
    50,
    1_000,
    async () => {
      throw new Error("Storage cutoff test must not renew its lease.");
    },
  );

  try {
    while (Date.now() < operationDeadlineAtMs) {
      // Keep the event loop occupied so the deadline timer cannot run.
    }
    assert.equal(operationDeadline.signal.aborted, false);
    await assert.rejects(
      heartbeat.getStorageCapability(),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
        );
        return true;
      },
    );
    assert.equal(heartbeat.signal.aborted, true);
  } finally {
    await heartbeat.stop();
    operationDeadline.dispose();
  }
});

test("multipart terminal replay retries a read-only commit with unknown outcome", async () => {
  const controller = new AbortController();
  const session = uploadSession(
    "completed",
    new Date(Date.now() + 60_000).toISOString(),
  );
  const mediaAsset: MediaAsset = {
    mediaAssetId: session.mediaAssetId,
    workspaceId: session.workspaceId,
    mimeType: session.mimeType,
    sizeBytes: session.sizeBytes,
    sha256: session.mediaBlobSha256,
    sourceUrl: null,
    createdAt: session.assetCreatedAt,
    clientUpdatedAt: session.clientUpdatedAt,
    lastModifiedByReplicaId: session.lastModifiedByReplicaId,
    lastOperationId: session.lastOperationId,
    updatedAt: session.clientUpdatedAt,
    deletedAt: null,
  };
  let loadAttempts = 0;

  const result = await replayCompletedMultipartResultWithDependencies(
    "user-1",
    session,
    <Result>(operation: () => Promise<Result>): Promise<Result> =>
      replayMultipartDatabaseCommitUnknownUntilDeadline(
        operation,
        Date.now() + 500,
        controller.signal,
      ),
    async (userId, replaySession) => {
      assert.equal(userId, "user-1");
      assert.equal(replaySession, session);
      loadAttempts += 1;
      if (loadAttempts === 1) {
        throw new DatabaseCommitOutcomeUnknownError(
          new Error("Read-only commit response lost."),
        );
      }
      return mediaAsset;
    },
  );

  assert.equal(loadAttempts, 2);
  assert.deepEqual(result, { mediaAsset, applied: false });
});

test("multipart resolution preserves an actionable HTTP response and diagnostic cause", () => {
  const completionError = new Error("S3 completion failed.");
  const resolutionError = new HttpError(
    503,
    "Multipart completion deadline reached.",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );

  const error = createMultipartCompletionResolutionError(
    completionError,
    resolutionError,
  );

  assert.ok(error instanceof HttpError);
  assert.equal(error.statusCode, resolutionError.statusCode);
  assert.equal(error.code, resolutionError.code);
  assert.equal(error.message, resolutionError.message);
  assert.deepEqual(error.details, resolutionError.details);
  assert.ok(error.cause instanceof AggregateError);
  assert.deepEqual(error.cause.errors, [completionError, resolutionError]);
});

test("multipart renewal hands a durable reconciliation race back to the existing retryable response", async () => {
  const context = createMultipartCompletionBoundaryTestContext();
  const reservationToken = "55555555-5555-4555-8555-555555555555";
  let beginCalls = 0;
  let handoffCalls = 0;
  const dependencies = createMultipartCompletionBoundaryTestDependencies(
    async () => {
      beginCalls += 1;
      if (beginCalls === 1) {
        return {
          status: "acquired",
          reservationToken,
          normalizationVersion: "passthrough-v1",
          leaseExpiresAt:
            new Date(
              context.timing.writerLeaseTargetAtMs - 1_000,
            ).toISOString(),
          storageCapability: context.storageCapability,
        };
      }
      return { status: "stale_attempt" };
    },
    async () => {
      throw new Error("Rejected renewal must not enter storage.");
    },
    async () => {
      handoffCalls += 1;
      return "already_pending";
    },
    async () => {
      throw new Error(
        "Renewal ownership loss must use exact handoff resolution.",
      );
    },
  );

  try {
    await assert.rejects(
      context.run(dependencies),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        );
        assert.equal(error.details?.retryAfterSeconds, 1);
        return true;
      },
    );
    assert.equal(beginCalls, 2);
    assert.equal(handoffCalls, 1);
  } finally {
    context.dispose();
  }
});

test("multipart renewal writer mismatch becomes the existing stale conflict instead of an internal fence error", async () => {
  const context = createMultipartCompletionBoundaryTestContext();
  let beginCalls = 0;
  const dependencies = createMultipartCompletionBoundaryTestDependencies(
    async () => {
      beginCalls += 1;
      return {
        status: beginCalls === 1 ? "acquired" : "replayed",
        reservationToken: beginCalls === 1
          ? "55555555-5555-4555-8555-555555555555"
          : "77777777-7777-4777-8777-777777777777",
        normalizationVersion: "passthrough-v1",
        leaseExpiresAt:
          new Date(
            context.timing.writerLeaseTargetAtMs - 1_000,
          ).toISOString(),
        storageCapability: context.storageCapability,
      };
    },
    async () => {
      throw new Error("Rejected renewal must not enter storage.");
    },
    async () => "stale_attempt",
    async () => {
      throw new Error(
        "Renewal ownership loss must use exact handoff resolution.",
      );
    },
  );

  try {
    await assert.rejects(
      context.run(dependencies),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 409);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_STATE_CONFLICT",
        );
        assert.match(error.message, /status=stale_attempt/u);
        return true;
      },
    );
    assert.equal(beginCalls, 2);
  } finally {
    context.dispose();
  }
});

test("multipart renewal replays an already applied durable result without handoff", async () => {
  const context = createMultipartCompletionBoundaryTestContext();
  const mediaAsset: MediaAsset = {
    mediaAssetId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    mimeType: "image/png",
    sizeBytes: 42,
    sha256: "a".repeat(64),
    sourceUrl: null,
    createdAt: "2026-07-28T10:00:00.000Z",
    clientUpdatedAt: "2026-07-28T10:00:00.000Z",
    lastModifiedByReplicaId: "44444444-4444-4444-8444-444444444444",
    lastOperationId: "operation-1",
    updatedAt: "2026-07-28T10:00:00.000Z",
    deletedAt: null,
  };
  let beginCalls = 0;
  const dependencies = {
    ...createMultipartCompletionBoundaryTestDependencies(
      async () => {
        beginCalls += 1;
        if (beginCalls === 1) {
          return {
            status: "acquired" as const,
            reservationToken: "55555555-5555-4555-8555-555555555555",
            normalizationVersion: "passthrough-v1" as const,
            leaseExpiresAt:
              new Date(
                context.timing.writerLeaseTargetAtMs - 1_000,
              ).toISOString(),
            storageCapability: context.storageCapability,
          };
        }
        return { status: "already_applied" as const };
      },
      async () => {
        throw new Error("Applied renewal must not enter storage.");
      },
      async () => {
        throw new Error("Applied renewal must not be handed off.");
      },
      async () => {
        throw new Error("Applied renewal must not enter failure recovery.");
      },
    ),
    loadMediaAssetForCompletedUploadSessionReplayForWorkspaceFn: async () =>
      mediaAsset,
  };

  try {
    assert.deepEqual(
      await context.run(dependencies),
      { mediaAsset, applied: false },
    );
    assert.equal(beginCalls, 2);
  } finally {
    context.dispose();
  }
});

test("multipart storage failure remains authoritative after the exact writer is restored", async () => {
  const context = createMultipartCompletionBoundaryTestContext();
  const storageError = new Error("Multipart storage failed.");
  let beginCalls = 0;
  const dependencies = createMultipartCompletionBoundaryTestDependencies(
    async () => {
      beginCalls += 1;
      return {
        status: beginCalls === 1 ? "acquired" : "replayed",
        reservationToken: "55555555-5555-4555-8555-555555555555",
        normalizationVersion: "passthrough-v1",
        leaseExpiresAt:
          new Date(
            context.timing.writerLeaseTargetAtMs - 1_000,
          ).toISOString(),
        storageCapability: context.storageCapability,
      };
    },
    async () => {
      throw storageError;
    },
    async () => {
      throw new Error("Restorable storage failure must not be handed off.");
    },
    async () => "unreferenced_restored",
  );

  try {
    await assert.rejects(
      context.run(dependencies),
      (error: unknown): boolean => error === storageError,
    );
    assert.equal(beginCalls, 2);
  } finally {
    context.dispose();
  }
});
