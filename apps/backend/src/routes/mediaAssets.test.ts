import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
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
import {
  createMultipartCompletionRequestTiming,
  runWithMultipartCompletionRequestTiming,
} from "../server/multipartCompletionRequestTiming";
import {
  createMediaAssetsRoutes,
  createMultipartCompletionRequestDeadline,
  createMultipartCompletionResolutionError,
  createMultipartWriterHeartbeat,
  isExpiredMultipartCompletionCleanupRequired,
  replayCompletedMultipartResultWithDependencies,
  replayMultipartDatabaseCommitUnknownUntilDeadline,
  resolveMultipartOperationExactlyUntilSafe,
} from "./mediaAssets";

function createMediaAssetsTestApp(): Hono<AppEnv> {
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
  app.route("/", createMediaAssetsRoutes({ allowedOrigins: [] }));
  return app;
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
