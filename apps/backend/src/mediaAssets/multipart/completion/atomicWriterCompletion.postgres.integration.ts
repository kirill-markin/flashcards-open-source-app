import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import test from "node:test";
import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DatabaseCommitOutcomeUnknownError,
} from "../../../database/transient";
import { HttpError } from "../../../shared/errors";
import {
  withPostgresIntegrationFixture,
} from "../../../testSupport/postgresIntegration";
import { buildMediaMultipartUploadStagingStorageKey } from "../../storageKeys";
import {
  acquireMediaAssetUploadSessionCreationClaimForWorkspace,
  beginMediaAssetUploadSessionAbortForWorkspace,
  beginMediaAssetUploadSessionCompletionAttemptWithOwner,
  beginMediaAssetUploadSessionCompletionWithOwner,
  checkMediaAssetCompletionPendingForWorkspace,
  completeMediaAssetUploadSessionForWorkspace,
  createMediaAssetFromAvailableBlobForWorkspace,
  createMediaAssetUploadSessionCompletedPartsFingerprint,
  handoffMediaAssetUploadSessionCompletionAttempt,
  loadMediaAssetUploadSessionCreationReplayForWorkspace,
  loadMediaAssetUploadSessionForCompletionForWorkspace,
  recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
  releaseMediaAssetUploadSessionCreationClaimForWorkspace,
  type MediaAssetUploadSessionCompletionWithOwnerInput,
  type MultipartMediaBlobWriterAttemptInput,
} from "../../uploadSessions";
import {
  completeMultipartMediaAssetUploadWithDependencies,
} from "../../storage/multipart/multipart";
import {
  claimMultipartCompletionReconciliations,
} from "./completionReconciliation";
import {
  createS3Error,
  getTestMediaAssetsStorageConfig,
  getUnexpectedS3CommandName,
} from "../../storage/testHelpers";
import {
  createMultipartCompletionRequestDeadline,
} from "../requestBoundary";
import {
  createMultipartUploadSessionAtApplicationBoundary,
} from "../creation/creationBoundary";
import {
  abortMultipartUploadSessionAtApplicationBoundary,
  completeMultipartUploadSessionAtApplicationBoundary,
} from "./completionBoundary";
import {
  createMultipartCompletionWriterLeaseTargetAtMs,
} from "../../../server/mediaRequests/multipartCompletionRequestTiming";
import {
  applicationAttemptResolutionDependencies,
  applicationObservationScope,
  applyClaimedMultipartWithWorkerStorage,
  applyHandedOffMultipartWithWorkerStorage,
  close,
  completionParts,
  completeLegacyMultipartSession,
  createApplicationDeadlines,
  createDurableMultipartStorageFixture,
  createMultipartHeadResponse,
  digest,
  insertSession,
  session,
} from "../atomicWriterPostgresTestSupport";

test("multipart completion application boundary resolves durable storage and database races", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const legacyReplayInput = session(fixture, "active", future);
    await insertSession(fixture, legacyReplayInput, "active");
    const legacyStart =
      await beginMediaAssetUploadSessionCompletionWithOwner(
        legacyReplayInput,
      );
    assert.equal(legacyStart.status, "started");
    assert.ok("reservation" in legacyStart);
    await completeLegacyMultipartSession(
      fixture,
      legacyReplayInput,
      legacyStart.reservation.reservationToken,
      legacyStart.reservation.normalizationVersion,
    );
    const legacyReplaySession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        legacyReplayInput.userId,
        legacyReplayInput.workspaceId,
        legacyReplayInput.sessionId,
      );
    const legacyReplayDeadlines = createApplicationDeadlines(5_000, 10_000);
    let legacyStorageCalls = 0;
    let legacyApplyCalls = 0;
    try {
      const legacyReplay =
        await completeMultipartUploadSessionAtApplicationBoundary(
          legacyReplayInput.userId,
          legacyReplaySession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(legacyReplayInput),
          legacyReplayDeadlines.operation,
          legacyReplayDeadlines.writerLeaseTargetAtMs,
          legacyReplayDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {
              throw new Error(
                "Legacy completed replay must not abort multipart storage.",
              );
            },
            completeMultipartMediaAssetUploadFn: async () => {
              legacyStorageCalls += 1;
            },
            completeMediaAssetUploadSessionForWorkspaceFn: async () => {
              legacyApplyCalls += 1;
              throw new Error(
                "Legacy completed replay must not apply the asset again.",
              );
            },
          },
        );
      assert.equal(legacyReplay.applied, false);
      assert.equal(
        legacyReplay.mediaAsset.mediaAssetId,
        legacyReplayInput.mediaAssetId,
      );
    } finally {
      legacyReplayDeadlines.operation.dispose();
      legacyReplayDeadlines.request.dispose();
    }
    assert.equal(legacyStorageCalls, 0);
    assert.equal(legacyApplyCalls, 0);
    assert.equal(
      (await fixture.ownerPool.query<Readonly<{ count: number }>>(
        `SELECT count(*)::int AS count
         FROM content.media_blob_writer_attempts
         WHERE media_upload_session_id=$1`,
        [legacyReplayInput.sessionId],
      )).rows[0].count,
      0,
    );

    let completedAbortStorageCalls = 0;
    await assert.rejects(
      async () => {
        const abortStart =
          await beginMediaAssetUploadSessionAbortForWorkspace(
            legacyReplayInput.userId,
            legacyReplayInput.workspaceId,
            legacyReplayInput.sessionId,
          );
        await abortMultipartUploadSessionAtApplicationBoundary(
          legacyReplayInput.userId,
          abortStart,
          applicationObservationScope(legacyReplayInput),
          new AbortController().signal,
          <Result>(operation: () => Promise<Result>): Promise<Result> =>
            operation(),
          async () => {
            completedAbortStorageCalls += 1;
          },
        );
      },
      (error: unknown) =>
        error instanceof HttpError
        && error.statusCode === 409
        && error.code === "MEDIA_ASSET_UPLOAD_SESSION_COMPLETED",
    );
    assert.equal(completedAbortStorageCalls, 0);

    const alreadyAbortedInput = session(fixture, "active", future);
    await insertSession(fixture, alreadyAbortedInput, "active");
    assert.equal(
      (await beginMediaAssetUploadSessionAbortForWorkspace(
        alreadyAbortedInput.userId,
        alreadyAbortedInput.workspaceId,
        alreadyAbortedInput.sessionId,
      )).status,
      "abort_required",
    );
    assert.equal(
      await close(alreadyAbortedInput, alreadyAbortedInput.sizeBytes),
      "no_writer_closed",
    );
    const alreadyAbortedStart =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        alreadyAbortedInput.userId,
        alreadyAbortedInput.workspaceId,
        alreadyAbortedInput.sessionId,
      );
    assert.equal(alreadyAbortedStart.status, "already_aborted");
    let replayedAbortStorageCalls = 0;
    const replayedAbort =
      await abortMultipartUploadSessionAtApplicationBoundary(
        alreadyAbortedInput.userId,
        alreadyAbortedStart,
        applicationObservationScope(alreadyAbortedInput),
        new AbortController().signal,
        <Result>(operation: () => Promise<Result>): Promise<Result> =>
          operation(),
        async () => {
          replayedAbortStorageCalls += 1;
        },
      );
    assert.equal(replayedAbort.state, "aborted");
    assert.equal(
      replayedAbort.abortedAt,
      alreadyAbortedStart.uploadSession.abortedAt,
    );
    assert.equal(replayedAbortStorageCalls, 0);

    const copyRetryInput = session(fixture, "active", future);
    await insertSession(fixture, copyRetryInput, "active");
    const copyRetrySession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        copyRetryInput.userId,
        copyRetryInput.workspaceId,
        copyRetryInput.sessionId,
      );
    const copyRetryParts = completionParts();
    let stagingNormalized = false;
    let copyAttempts = 0;
    const client = new S3Client({
      credentials: {
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      },
      region: "us-east-1",
    });
    client.send = (async (command: unknown) => {
      if (command instanceof CompleteMultipartUploadCommand) return {};
      if (command instanceof HeadObjectCommand) {
        if (command.input.Key === copyRetryInput.blobStorageKey) {
          return createMultipartHeadResponse(
            copyRetryInput,
            "FULL_OBJECT",
            copyRetryInput.sha256,
            "\"blob-etag\"",
          );
        }
        return createMultipartHeadResponse(
          copyRetryInput,
          stagingNormalized ? "FULL_OBJECT" : "COMPOSITE",
          stagingNormalized ? copyRetryInput.sha256 : digest(),
          stagingNormalized ? "\"normalized-etag\"" : "\"multipart-etag\"",
        );
      }
      if (command instanceof CopyObjectCommand) {
        copyAttempts += 1;
        stagingNormalized = true;
        throw createS3Error(
          500,
          "InternalError",
          "Copy committed but its response was lost.",
        );
      }
      throw new Error(
        `Unexpected S3 command ${getUnexpectedS3CommandName(command)}`,
      );
    }) as S3Client["send"];
    let applyCalls = 0;
    const copyRetryDeadlines = createApplicationDeadlines(5_000, 10_000);
    try {
      const result =
        await completeMultipartUploadSessionAtApplicationBoundary(
          copyRetryInput.userId,
          copyRetrySession,
          copyRetryParts,
          randomUUID(),
          applicationObservationScope(copyRetryInput),
          copyRetryDeadlines.operation,
          copyRetryDeadlines.writerLeaseTargetAtMs,
          copyRetryDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: (input) =>
              completeMultipartMediaAssetUploadWithDependencies(input, {
                s3Client: client,
                getMediaAssetsStorageConfigFn:
                  getTestMediaAssetsStorageConfig,
              }),
            completeMediaAssetUploadSessionForWorkspaceFn:
              async (userId, workspaceId, sessionId, writer) => {
                applyCalls += 1;
                const applied =
                  await completeMediaAssetUploadSessionForWorkspace(
                    userId,
                    workspaceId,
                    sessionId,
                    writer,
                  );
                if (applyCalls === 1) {
                  throw new DatabaseCommitOutcomeUnknownError(
                    new Error("Commit response was lost."),
                  );
                }
                return applied;
              },
          },
        );
      assert.equal(result.applied, false);
    } finally {
      copyRetryDeadlines.operation.dispose();
      copyRetryDeadlines.request.dispose();
    }
    assert.equal(copyAttempts, 1);
    assert.equal(applyCalls, 2);
    assert.equal(
      (await loadMediaAssetUploadSessionForCompletionForWorkspace(
        copyRetryInput.userId,
        copyRetryInput.workspaceId,
        copyRetryInput.sessionId,
      )).state,
      "completed",
    );

    const deadlineInput = session(fixture, "active", future);
    await insertSession(fixture, deadlineInput, "active");
    const deadlineSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.sessionId,
    );
    const deadlineParts = completionParts();
    const deadlineStorage = createDurableMultipartStorageFixture(
      deadlineInput,
      deadlineParts,
      "complete",
    );
    const deadlineBoundaries = createApplicationDeadlines(1_500, 6_000);
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          deadlineInput.userId,
          deadlineSession,
          deadlineParts,
          randomUUID(),
          applicationObservationScope(deadlineInput),
          deadlineBoundaries.operation,
          deadlineBoundaries.writerLeaseTargetAtMs,
          deadlineBoundaries.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: (storageInput) =>
              completeMultipartMediaAssetUploadWithDependencies(
                storageInput,
                {
                  s3Client: deadlineStorage.client,
                  getMediaAssetsStorageConfigFn:
                    getTestMediaAssetsStorageConfig,
                },
              ),
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpError);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
          );
          assert.equal(error.statusCode, 503);
          return true;
        },
      );
      await deadlineStorage.mutationStarted;
    } finally {
      deadlineBoundaries.operation.dispose();
      deadlineBoundaries.request.dispose();
    }
    assert.equal(
      await checkMediaAssetCompletionPendingForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.mediaAssetId,
      ),
      true,
    );
    assert.equal(
      (await loadMediaAssetUploadSessionForCompletionForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.sessionId,
      )).state,
      "completing",
    );
    const pendingAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.sessionId,
      );
    assert.equal(pendingAbort.status, "completion_pending");
    let pendingAbortStorageCalls = 0;
    await assert.rejects(
      abortMultipartUploadSessionAtApplicationBoundary(
        deadlineInput.userId,
        pendingAbort,
        applicationObservationScope(deadlineInput),
        new AbortController().signal,
        <Result>(operation: () => Promise<Result>): Promise<Result> =>
          operation(),
        async () => {
          pendingAbortStorageCalls += 1;
        },
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        );
        assert.equal(error.statusCode, 409);
        return true;
      },
    );
    assert.equal(pendingAbortStorageCalls, 0);
    assert.equal(
      (await fixture.ownerPool.query<Readonly<{ count: number }>>(
        `SELECT count(*)::int AS count
         FROM content.media_upload_sessions
         WHERE workspace_id=$1 AND media_asset_id=$2`,
        [deadlineInput.workspaceId, deadlineInput.mediaAssetId],
      )).rows[0].count,
      1,
    );
    const replacementCreateInput = {
      mediaAssetId: deadlineInput.mediaAssetId,
      mimeType: deadlineInput.mimeType,
      sizeBytes: deadlineInput.sizeBytes,
      sha256: deadlineInput.sha256,
      partSizeBytes: deadlineInput.partSizeBytes,
      partCount: deadlineInput.partCount,
      sourceUrl: deadlineInput.sourceUrl,
      createdAt: deadlineInput.assetCreatedAt,
      clientUpdatedAt: deadlineInput.clientUpdatedAt,
      lastModifiedByReplicaId: deadlineInput.lastModifiedByReplicaId,
      lastOperationId: deadlineInput.lastOperationId,
    };
    let replacementMultipartCreateCalls = 0;
    let replacementMultipartAbortCalls = 0;
    const replacementCreationDependencies = {
      abortMultipartMediaAssetUploadUntilDeadlineFn: async () => {
        replacementMultipartAbortCalls += 1;
      },
      acquireCreationClaimFn:
        acquireMediaAssetUploadSessionCreationClaimForWorkspace,
      createMediaAssetFromAvailableBlobForWorkspaceFn:
        createMediaAssetFromAvailableBlobForWorkspace,
      createMultipartMediaAssetUploadFn: async (): Promise<never> => {
        replacementMultipartCreateCalls += 1;
        throw new Error(
          "Released-client replacement create must not start multipart storage.",
        );
      },
      loadCreationReplayFn:
        loadMediaAssetUploadSessionCreationReplayForWorkspace,
      recordUploadSessionWithCreationClaimFn:
        recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
      releaseCreationClaimFn:
        releaseMediaAssetUploadSessionCreationClaimForWorkspace,
    };
    const createReplacement = () => {
      const replacementSessionId = randomUUID();
      return createMultipartUploadSessionAtApplicationBoundary(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        replacementSessionId,
        randomUUID(),
        replacementCreateInput,
        buildMediaMultipartUploadStagingStorageKey(
          deadlineInput.workspaceId,
          deadlineInput.mediaAssetId,
          replacementSessionId,
        ),
        deadlineInput.blobStorageKey,
        applicationObservationScope(deadlineInput),
        new AbortController().signal,
        60_000,
        replacementCreationDependencies,
      );
    };
    await assert.rejects(
      createReplacement(),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        );
        return true;
      },
    );
    assert.equal(replacementMultipartCreateCalls, 0);
    assert.equal(replacementMultipartAbortCalls, 0);
    const reconciliationJobs =
      await claimMultipartCompletionReconciliations({
        leaseOwner: `application-handoff-${randomUUID()}`,
        leaseDurationMs: 60_000,
        limit: 1,
        deadlineAtMs: Date.now() + 30_000,
      });
    assert.equal(reconciliationJobs.length, 1);
    const reconciliationJob = reconciliationJobs[0];
    assert.ok(reconciliationJob !== undefined);
    const leasedAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.sessionId,
      );
    assert.equal(leasedAbort.status, "completion_pending");
    let leasedAbortStorageCalls = 0;
    await assert.rejects(
      abortMultipartUploadSessionAtApplicationBoundary(
        deadlineInput.userId,
        leasedAbort,
        applicationObservationScope(deadlineInput),
        new AbortController().signal,
        <Result>(operation: () => Promise<Result>): Promise<Result> =>
          operation(),
        async () => {
          leasedAbortStorageCalls += 1;
        },
      ),
      (error: unknown): boolean => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 409);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
        );
        return true;
      },
    );
    assert.equal(leasedAbortStorageCalls, 0);
    const pendingReplayDeadlines = createApplicationDeadlines(5_000, 10_000);
    let pendingReplayStorageCalls = 0;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          deadlineInput.userId,
          deadlineSession,
          deadlineParts,
          randomUUID(),
          applicationObservationScope(deadlineInput),
          pendingReplayDeadlines.operation,
          pendingReplayDeadlines.writerLeaseTargetAtMs,
          pendingReplayDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {
              pendingReplayStorageCalls += 1;
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
          );
          assert.equal(error.statusCode, 503);
          return true;
        },
      );
    } finally {
      pendingReplayDeadlines.operation.dispose();
      pendingReplayDeadlines.request.dispose();
    }
    assert.equal(pendingReplayStorageCalls, 0);
    await applyClaimedMultipartWithWorkerStorage(
      deadlineInput,
      deadlineStorage,
      reconciliationJob,
    );
    assert.equal(
      await checkMediaAssetCompletionPendingForWorkspace(
        deadlineInput.userId,
        deadlineInput.workspaceId,
        deadlineInput.mediaAssetId,
      ),
      false,
    );
    const replacementCreateReplay = await createReplacement();
    assert.equal(
      replacementCreateReplay.sessionResult.status,
      "already_available",
    );
    assert.equal(replacementCreateReplay.multipartUploadCreated, false);
    assert.equal(replacementMultipartCreateCalls, 0);
    assert.equal(replacementMultipartAbortCalls, 0);

    const durableReplayDeadlines = createApplicationDeadlines(5_000, 10_000);
    let durableReplayStorageCalls = 0;
    try {
      const durableReplay =
        await completeMultipartUploadSessionAtApplicationBoundary(
          deadlineInput.userId,
          deadlineSession,
          deadlineParts,
          randomUUID(),
          applicationObservationScope(deadlineInput),
          durableReplayDeadlines.operation,
          durableReplayDeadlines.writerLeaseTargetAtMs,
          durableReplayDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {
              durableReplayStorageCalls += 1;
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        );
      assert.equal(durableReplay.applied, false);
    } finally {
      durableReplayDeadlines.operation.dispose();
      durableReplayDeadlines.request.dispose();
    }
    assert.equal(durableReplayStorageCalls, 0);
    assert.equal(
      (await fixture.ownerPool.query<Readonly<{ count: number }>>(
        `SELECT count(*)::int AS count
         FROM content.media_upload_sessions
         WHERE workspace_id=$1 AND media_asset_id=$2`,
        [deadlineInput.workspaceId, deadlineInput.mediaAssetId],
      )).rows[0].count,
      1,
    );

    const busyInput = session(fixture, "active", future);
    await insertSession(fixture, busyInput, "active");
    const busySession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        busyInput.userId,
        busyInput.workspaceId,
        busyInput.sessionId,
      );
    const busyParts = completionParts();
    let releaseStorage!: () => void;
    const storageRelease = new Promise<void>((resolveStorage) => {
      releaseStorage = resolveStorage;
    });
    let signalStorageStarted!: () => void;
    const storageStarted = new Promise<void>((resolveStarted) => {
      signalStorageStarted = resolveStarted;
    });
    let storageCalls = 0;
    const busyDependencies = {
      ...applicationAttemptResolutionDependencies,
      abortMultipartMediaAssetUploadFn: async () => {},
      completeMultipartMediaAssetUploadFn: async () => {
        storageCalls += 1;
        signalStorageStarted();
        await storageRelease;
      },
      completeMediaAssetUploadSessionForWorkspaceFn:
        completeMediaAssetUploadSessionForWorkspace,
    };
    const firstBusyDeadlines = createApplicationDeadlines(5_000, 10_000);
    const secondBusyDeadlines = createApplicationDeadlines(5_000, 10_000);
    try {
      const firstCompletion =
        completeMultipartUploadSessionAtApplicationBoundary(
          busyInput.userId,
          busySession,
          busyParts,
          randomUUID(),
          applicationObservationScope(busyInput),
          firstBusyDeadlines.operation,
          firstBusyDeadlines.writerLeaseTargetAtMs,
          firstBusyDeadlines.request,
          busyDependencies,
        );
      await storageStarted;
      const secondCompletion =
        completeMultipartUploadSessionAtApplicationBoundary(
          busyInput.userId,
          busySession,
          busyParts,
          randomUUID(),
          applicationObservationScope(busyInput),
          secondBusyDeadlines.operation,
          secondBusyDeadlines.writerLeaseTargetAtMs,
          secondBusyDeadlines.request,
          busyDependencies,
        );
      await wait(50);
      releaseStorage();
      const [firstResult, secondResult] = await Promise.all([
        firstCompletion,
        secondCompletion,
      ]);
      assert.equal(firstResult.applied, true);
      assert.equal(secondResult.applied, false);
    } finally {
      firstBusyDeadlines.operation.dispose();
      firstBusyDeadlines.request.dispose();
      secondBusyDeadlines.operation.dispose();
      secondBusyDeadlines.request.dispose();
    }
    assert.equal(storageCalls, 1);

    const takeoverInput = session(fixture, "active", future);
    await insertSession(fixture, takeoverInput, "active");
    const takeoverParts = completionParts();
    const orphanAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner({
        ...takeoverInput,
        attemptToken: randomUUID(),
        completedPartsFingerprint:
          createMediaAssetUploadSessionCompletedPartsFingerprint(
            takeoverParts,
          ),
      }, 150);
    assert.equal(orphanAttempt.status, "acquired");
    const takeoverSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        takeoverInput.userId,
        takeoverInput.workspaceId,
        takeoverInput.sessionId,
      );
    const takeoverDeadlines = createApplicationDeadlines(3_000, 5_000);
    try {
      const takeoverResult =
        await completeMultipartUploadSessionAtApplicationBoundary(
          takeoverInput.userId,
          takeoverSession,
          takeoverParts,
          randomUUID(),
          applicationObservationScope(takeoverInput),
          takeoverDeadlines.operation,
          takeoverDeadlines.writerLeaseTargetAtMs,
          takeoverDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {},
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        );
      assert.equal(takeoverResult.applied, true);
    } finally {
      takeoverDeadlines.operation.dispose();
      takeoverDeadlines.request.dispose();
    }

    const abortRaceInput = session(fixture, "active", future);
    await insertSession(fixture, abortRaceInput, "active");
    const abortRaceSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        abortRaceInput.userId,
        abortRaceInput.workspaceId,
        abortRaceInput.sessionId,
      );
    let releaseAbortRaceStorage!: () => void;
    const abortRaceStorageRelease = new Promise<void>((resolveStorage) => {
      releaseAbortRaceStorage = resolveStorage;
    });
    let signalAbortRaceStorageStarted!: () => void;
    const abortRaceStorageStarted = new Promise<void>((resolveStarted) => {
      signalAbortRaceStorageStarted = resolveStarted;
    });
    const abortRaceDeadlines = createApplicationDeadlines(3_000, 5_000);
    try {
      const completion =
        completeMultipartUploadSessionAtApplicationBoundary(
          abortRaceInput.userId,
          abortRaceSession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(abortRaceInput),
          abortRaceDeadlines.operation,
          abortRaceDeadlines.writerLeaseTargetAtMs,
          abortRaceDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {
              signalAbortRaceStorageStarted();
              await abortRaceStorageRelease;
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        );
      await abortRaceStorageStarted;
      const abortStart =
        await beginMediaAssetUploadSessionAbortForWorkspace(
          abortRaceInput.userId,
          abortRaceInput.workspaceId,
          abortRaceInput.sessionId,
        );
      assert.equal(abortStart.status, "completion_in_progress");
      let abortStorageCalls = 0;
      await assert.rejects(
        abortMultipartUploadSessionAtApplicationBoundary(
          abortRaceInput.userId,
          abortStart,
          applicationObservationScope(abortRaceInput),
          new AbortController().signal,
          <Result>(operation: () => Promise<Result>): Promise<Result> =>
            operation(),
          async () => {
            abortStorageCalls += 1;
          },
        ),
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
      assert.equal(abortStorageCalls, 0);
      assert.deepEqual(
        (await fixture.ownerPool.query<Readonly<{
          session_state: string;
          attempt_state: string;
          reservation_state: string;
        }>>(
          `SELECT sessions.state AS session_state,
             attempts.state AS attempt_state,
             reservations.state AS reservation_state
           FROM content.media_upload_sessions AS sessions
           INNER JOIN content.media_blob_writer_attempts AS attempts
             ON attempts.media_upload_session_id=sessions.media_upload_session_id
           INNER JOIN content.media_blob_writer_reservations AS reservations
             ON reservations.reservation_token=attempts.reservation_token
           WHERE sessions.media_upload_session_id=$1`,
          [abortRaceInput.sessionId],
        )).rows[0],
        {
          session_state: "completing",
          attempt_state: "leased",
          reservation_state: "active",
        },
      );
      releaseAbortRaceStorage();
      assert.equal((await completion).applied, true);
    } finally {
      releaseAbortRaceStorage();
      abortRaceDeadlines.operation.dispose();
      abortRaceDeadlines.request.dispose();
    }
    assert.equal(
      (await loadMediaAssetUploadSessionForCompletionForWorkspace(
        abortRaceInput.userId,
        abortRaceInput.workspaceId,
        abortRaceInput.sessionId,
      )).state,
      "completed",
    );
  });
});

test("legacy noncanonical completion settles only after exact quiescence", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const legacyLastOperationId = "legacy\u00a0operation";
    const legacyInput = {
      ...session(fixture, "completing", future),
      lastOperationId: legacyLastOperationId,
    };
    await insertSession(fixture, legacyInput, "completing");
    const legacySession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        legacyInput.userId,
        legacyInput.workspaceId,
        legacyInput.sessionId,
      );
    const legacyDeadlines = createApplicationDeadlines(5_000, 10_000);
    let legacyAbortStorageCalls = 0;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          legacyInput.userId,
          legacySession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(legacyInput),
          legacyDeadlines.operation,
          legacyDeadlines.writerLeaseTargetAtMs,
          legacyDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {
              legacyAbortStorageCalls += 1;
            },
            completeMultipartMediaAssetUploadFn: async () => {
              throw new Error(
                "Legacy restart settlement must not complete storage.",
              );
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.statusCode, 409);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_RESTART_REQUIRED",
          );
          return true;
        },
      );
    } finally {
      legacyDeadlines.operation.dispose();
      legacyDeadlines.request.dispose();
    }
    assert.equal(legacyAbortStorageCalls, 1);
    assert.equal(
      (await loadMediaAssetUploadSessionForCompletionForWorkspace(
        legacyInput.userId,
        legacyInput.workspaceId,
        legacyInput.sessionId,
      )).state,
      "aborted",
    );

    const legacyAbortReplay =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        legacyInput.userId,
        legacyInput.workspaceId,
        legacyInput.sessionId,
      );
    assert.equal(legacyAbortReplay.status, "already_aborted");
    await abortMultipartUploadSessionAtApplicationBoundary(
      legacyInput.userId,
      legacyAbortReplay,
      applicationObservationScope(legacyInput),
      new AbortController().signal,
      <Result>(operation: () => Promise<Result>): Promise<Result> =>
        operation(),
      async () => {
        throw new Error(
          "Already-aborted legacy replay must not call storage.",
        );
      },
    );

    const replacementSessionId = randomUUID();
    const replacementLastOperationId = randomUUID();
    const replacement = await createMultipartUploadSessionAtApplicationBoundary(
      legacyInput.userId,
      legacyInput.workspaceId,
      replacementSessionId,
      randomUUID(),
      {
        mediaAssetId: legacyInput.mediaAssetId,
        mimeType: legacyInput.mimeType,
        sizeBytes: legacyInput.sizeBytes,
        sha256: legacyInput.sha256,
        partSizeBytes: legacyInput.partSizeBytes,
        partCount: legacyInput.partCount,
        sourceUrl: legacyInput.sourceUrl,
        createdAt: legacyInput.assetCreatedAt,
        clientUpdatedAt: legacyInput.clientUpdatedAt,
        lastModifiedByReplicaId: legacyInput.lastModifiedByReplicaId,
        lastOperationId: replacementLastOperationId,
      },
      buildMediaMultipartUploadStagingStorageKey(
        legacyInput.workspaceId,
        legacyInput.mediaAssetId,
        replacementSessionId,
      ),
      legacyInput.blobStorageKey,
      applicationObservationScope(legacyInput),
      new AbortController().signal,
      60_000,
      {
        abortMultipartMediaAssetUploadUntilDeadlineFn: async () => {},
        acquireCreationClaimFn:
          acquireMediaAssetUploadSessionCreationClaimForWorkspace,
        createMediaAssetFromAvailableBlobForWorkspaceFn:
          createMediaAssetFromAvailableBlobForWorkspace,
        createMultipartMediaAssetUploadFn: async (input) => ({
          storageKey: input.stagingStorageKey,
          s3UploadId: `replacement-${randomUUID()}`,
          expiresAt: future,
        }),
        loadCreationReplayFn:
          loadMediaAssetUploadSessionCreationReplayForWorkspace,
        recordUploadSessionWithCreationClaimFn:
          recordMediaAssetUploadSessionWithCreationClaimForWorkspace,
        releaseCreationClaimFn:
          releaseMediaAssetUploadSessionCreationClaimForWorkspace,
      },
    );
    assert.equal(replacement.multipartUploadCreated, true);
    assert.equal(replacement.sessionResult.status, "upload_required");

    const assertProtectedLegacyState = async (
      input: MediaAssetUploadSessionCompletionWithOwnerInput,
      expectedStatusCode: number,
      expectedAttemptState: string,
      expectedReconciliationState: string | null,
    ): Promise<void> => {
      const uploadSession =
        await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        );
      const deadlines = createApplicationDeadlines(5_000, 10_000);
      let storageCalls = 0;
      try {
        await assert.rejects(
          completeMultipartUploadSessionAtApplicationBoundary(
            input.userId,
            uploadSession,
            completionParts(),
            randomUUID(),
            applicationObservationScope(input),
            deadlines.operation,
            deadlines.writerLeaseTargetAtMs,
            deadlines.request,
            {
              ...applicationAttemptResolutionDependencies,
              abortMultipartMediaAssetUploadFn: async () => {
                storageCalls += 1;
              },
              completeMultipartMediaAssetUploadFn: async () => {
                storageCalls += 1;
              },
              completeMediaAssetUploadSessionForWorkspaceFn:
                completeMediaAssetUploadSessionForWorkspace,
            },
          ),
          (error: unknown): boolean => {
            assert.ok(error instanceof HttpError);
            assert.equal(error.statusCode, expectedStatusCode);
            assert.equal(
              error.code,
              "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
            );
            return true;
          },
        );
      } finally {
        deadlines.operation.dispose();
        deadlines.request.dispose();
      }
      assert.equal(storageCalls, 0);
      assert.deepEqual(
        (await fixture.ownerPool.query<Readonly<{
          session_state: string;
          attempt_state: string;
          reconciliation_state: string | null;
        }>>(
          `SELECT
             sessions.state AS session_state,
             attempts.state AS attempt_state,
             attempts.reconciliation_state
           FROM content.media_upload_sessions AS sessions
           INNER JOIN content.media_blob_writer_attempts AS attempts
             ON attempts.media_upload_session_id =
               sessions.media_upload_session_id
           WHERE sessions.media_upload_session_id=$1`,
          [input.sessionId],
        )).rows[0],
        {
          session_state: "completing",
          attempt_state: expectedAttemptState,
          reconciliation_state: expectedReconciliationState,
        },
      );
    };

    const liveInput = session(fixture, "active", future);
    await insertSession(fixture, liveInput, "active");
    const liveParts = completionParts();
    const liveAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...liveInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint:
        createMediaAssetUploadSessionCompletedPartsFingerprint(liveParts),
    };
    const liveAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        liveAttemptInput,
        60_000,
      );
    assert.equal(liveAttempt.status, "acquired");
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET last_operation_id=$2
       WHERE media_upload_session_id=$1`,
      [liveInput.sessionId, legacyLastOperationId],
    );
    await assertProtectedLegacyState(
      { ...liveInput, lastOperationId: legacyLastOperationId },
      503,
      "leased",
      null,
    );

    const pendingInput = session(fixture, "active", future);
    await insertSession(fixture, pendingInput, "active");
    const pendingParts = completionParts();
    const pendingAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...pendingInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint:
        createMediaAssetUploadSessionCompletedPartsFingerprint(
          pendingParts,
        ),
    };
    const pendingAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        pendingAttemptInput,
        60_000,
      );
    assert.equal(pendingAttempt.status, "acquired");
    assert.ok("reservationToken" in pendingAttempt);
    assert.equal(
      await handoffMediaAssetUploadSessionCompletionAttempt({
        ...pendingAttemptInput,
        reservationToken: pendingAttempt.reservationToken,
        normalizationVersion: pendingAttempt.normalizationVersion,
      }),
      "handed_off",
    );
    await fixture.ownerPool.query(
      `UPDATE content.media_upload_sessions
       SET last_operation_id=$2
       WHERE media_upload_session_id=$1`,
      [pendingInput.sessionId, legacyLastOperationId],
    );
    await assertProtectedLegacyState(
      { ...pendingInput, lastOperationId: legacyLastOperationId },
      409,
      "expired",
      "pending",
    );
  });
});

test("foreground completion deadlines hand every mutation phase to the durable worker", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const assertCompletionInProgress = (error: unknown): boolean => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(
        error.code,
        "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
      );
      assert.equal(error.details?.retryAfterSeconds, 1);
      return true;
    };
    const assertPendingHandoff = async (sessionId: string): Promise<void> => {
      const state = (await fixture.ownerPool.query<Readonly<{
        live_foreground_attempts: number;
        pending_reconciliations: number;
        session_state: string;
      }>>(
        `SELECT
           count(*) FILTER (
             WHERE attempts.state='leased'
               AND attempts.reconciliation_state IS NULL
           )::int AS live_foreground_attempts,
           count(*) FILTER (
             WHERE attempts.reconciliation_state='pending'
           )::int AS pending_reconciliations,
           min(sessions.state)::text AS session_state
         FROM content.media_upload_sessions AS sessions
         INNER JOIN content.media_blob_writer_attempts AS attempts
           ON attempts.media_upload_session_id=sessions.media_upload_session_id
         WHERE sessions.media_upload_session_id=$1`,
        [sessionId],
      )).rows[0];
      assert.deepEqual(state, {
        live_foreground_attempts: 0,
        pending_reconciliations: 1,
        session_state: "completing",
      });
    };

    const immediateInput = session(fixture, "active", future);
    await insertSession(fixture, immediateInput, "active");
    const immediateParts = completionParts();
    const immediateAttemptToken = randomUUID();
    const immediateAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        {
          ...immediateInput,
          attemptToken: immediateAttemptToken,
          completedPartsFingerprint:
            createMediaAssetUploadSessionCompletedPartsFingerprint(
              immediateParts,
            ),
        },
        60_000,
      );
    assert.equal(immediateAttempt.status, "acquired");
    const immediateSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        immediateInput.userId,
        immediateInput.workspaceId,
        immediateInput.sessionId,
      );
    const immediateStorage = createDurableMultipartStorageFixture(
      immediateInput,
      immediateParts,
      "complete",
    );
    const immediateObservedAtMs = Date.now();
    const immediateOperationDeadlineAtMs = immediateObservedAtMs - 1;
    const immediateRequestDeadlineAtMs = immediateObservedAtMs + 6_000;
    const immediateOperationDeadline =
      createMultipartCompletionRequestDeadline(
        immediateOperationDeadlineAtMs,
      );
    const immediateRequestDeadline =
      createMultipartCompletionRequestDeadline(
        immediateRequestDeadlineAtMs,
      );
    const immediateWriterLeaseTargetAtMs =
      createMultipartCompletionWriterLeaseTargetAtMs(
        immediateOperationDeadlineAtMs,
        immediateRequestDeadlineAtMs,
      );
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          immediateInput.userId,
          immediateSession,
          immediateParts,
          immediateAttemptToken,
          applicationObservationScope(immediateInput),
          immediateOperationDeadline,
          immediateWriterLeaseTargetAtMs,
          immediateRequestDeadline,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: (storageInput) =>
              completeMultipartMediaAssetUploadWithDependencies(
                storageInput,
                {
                  s3Client: immediateStorage.client,
                  getMediaAssetsStorageConfigFn:
                    getTestMediaAssetsStorageConfig,
                },
              ),
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
          },
        ),
        assertCompletionInProgress,
      );
    } finally {
      immediateOperationDeadline.dispose();
      immediateRequestDeadline.dispose();
    }
    await assertPendingHandoff(immediateInput.sessionId);
    immediateStorage.releaseMutation();
    await applyHandedOffMultipartWithWorkerStorage(
      immediateInput,
      immediateStorage,
    );

    for (const phase of [
      "complete",
      "normalize",
      "promote",
      "database",
    ] as const) {
      const input = session(fixture, "active", future);
      await insertSession(fixture, input, "active");
      const parts = completionParts();
      const uploadSession =
        await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        );
      const storage = createDurableMultipartStorageFixture(
        input,
        parts,
        phase,
      );
      const deadlines = createApplicationDeadlines(1_500, 6_000);
      const databaseApplication = phase === "database"
        ? async (): Promise<never> => {
          storage.markMutationStarted();
          return new Promise<never>((_resolve, reject) => {
            const rejectWithAbortReason = (): void =>
              reject(deadlines.operation.signal.reason);
            deadlines.operation.signal.addEventListener(
              "abort",
              rejectWithAbortReason,
              { once: true },
            );
            if (deadlines.operation.signal.aborted) {
              rejectWithAbortReason();
            }
          });
        }
        : completeMediaAssetUploadSessionForWorkspace;
      try {
        await assert.rejects(
          completeMultipartUploadSessionAtApplicationBoundary(
            input.userId,
            uploadSession,
            parts,
            randomUUID(),
            applicationObservationScope(input),
            deadlines.operation,
            deadlines.writerLeaseTargetAtMs,
            deadlines.request,
            {
              ...applicationAttemptResolutionDependencies,
              abortMultipartMediaAssetUploadFn: async () => {},
              completeMultipartMediaAssetUploadFn: (storageInput) =>
                completeMultipartMediaAssetUploadWithDependencies(
                  storageInput,
                  {
                    s3Client: storage.client,
                    getMediaAssetsStorageConfigFn:
                      getTestMediaAssetsStorageConfig,
                  },
                ),
              completeMediaAssetUploadSessionForWorkspaceFn:
                databaseApplication,
            },
          ),
          assertCompletionInProgress,
        );
        await storage.mutationStarted;
      } finally {
        deadlines.operation.dispose();
        deadlines.request.dispose();
      }
      await assertPendingHandoff(input.sessionId);
      await applyHandedOffMultipartWithWorkerStorage(input, storage);
      assert.equal(
        (await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        )).state,
        "completed",
      );
    }

    const cutoffAuthorizationCall = {
      complete: 1,
      normalize: 2,
      promote: 3,
    } as const;
    const completedBeforeCutoff = {
      complete: [],
      normalize: ["complete"],
      promote: ["complete", "normalize"],
    } as const;
    for (const phase of [
      "complete",
      "normalize",
      "promote",
    ] as const) {
      const input = session(fixture, "active", future);
      await insertSession(fixture, input, "active");
      const parts = completionParts();
      const uploadSession =
        await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        );
      const storage = createDurableMultipartStorageFixture(
        input,
        parts,
        "database",
      );
      const deadlines = createApplicationDeadlines(2_000, 7_000);
      let authorizationCalls = 0;
      let observedDelayedTimer = false;
      try {
        await assert.rejects(
          completeMultipartUploadSessionAtApplicationBoundary(
            input.userId,
            uploadSession,
            parts,
            randomUUID(),
            applicationObservationScope(input),
            deadlines.operation,
            deadlines.writerLeaseTargetAtMs,
            deadlines.request,
            {
              ...applicationAttemptResolutionDependencies,
              abortMultipartMediaAssetUploadFn: async () => {},
              completeMultipartMediaAssetUploadFn: (storageInput) =>
                completeMultipartMediaAssetUploadWithDependencies(
                  {
                    ...storageInput,
                    assertStorageMutationAuthorized: () => {
                      authorizationCalls += 1;
                      if (
                        authorizationCalls
                          === cutoffAuthorizationCall[phase]
                      ) {
                        while (
                          Date.now()
                            < deadlines.operation.deadlineAtMs
                        ) {
                          // Keep the event loop occupied past the absolute cutoff.
                        }
                        assert.equal(
                          deadlines.operation.signal.aborted,
                          false,
                        );
                        observedDelayedTimer = true;
                      }
                      storageInput.assertStorageMutationAuthorized();
                    },
                  },
                  {
                    s3Client: storage.client,
                    getMediaAssetsStorageConfigFn:
                      getTestMediaAssetsStorageConfig,
                  },
                ),
              completeMediaAssetUploadSessionForWorkspaceFn:
                completeMediaAssetUploadSessionForWorkspace,
            },
          ),
          assertCompletionInProgress,
        );
      } finally {
        deadlines.operation.dispose();
        deadlines.request.dispose();
      }
      assert.equal(observedDelayedTimer, true, phase);
      assert.deepEqual(
        storage.getMutationPhases(),
        completedBeforeCutoff[phase],
        phase,
      );
      await assertPendingHandoff(input.sessionId);
      await applyHandedOffMultipartWithWorkerStorage(input, storage);
      assert.equal(
        (await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        )).state,
        "completed",
      );
    }
  });
});

test("foreground completion preserves exact durable handoff after access revocation", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const replicaOwnerUserId = `revoked-replica-owner-${randomUUID()}`;
    const accessChanges = [
      {
        name: "membership",
        revoke: () => fixture.ownerPool.query(
          `DELETE FROM org.workspace_memberships
           WHERE workspace_id=$1 AND user_id=$2`,
          [fixture.workspaceId, fixture.userId],
        ),
        restore: () => fixture.ownerPool.query(
          `INSERT INTO org.workspace_memberships(workspace_id,user_id,role)
           VALUES ($1,$2,'owner')`,
          [fixture.workspaceId, fixture.userId],
        ),
      },
      {
        name: "replica",
        revoke: () => fixture.ownerPool.query(
          `WITH inserted_user AS (
             INSERT INTO org.user_settings(user_id) VALUES ($1)
             RETURNING 1
           )
           UPDATE sync.workspace_replicas
           SET user_id=$1
           WHERE replica_id=$2
             AND EXISTS (SELECT 1 FROM inserted_user)`,
          [replicaOwnerUserId, fixture.replicaId],
        ),
        restore: () => fixture.ownerPool.query(
          `WITH restored_replica AS (
             UPDATE sync.workspace_replicas
             SET user_id=$1
             WHERE replica_id=$2
             RETURNING 1
           )
           DELETE FROM org.user_settings
           WHERE user_id=$3
             AND EXISTS (SELECT 1 FROM restored_replica)`,
          [fixture.userId, fixture.replicaId, replicaOwnerUserId],
        ),
      },
    ] as const;

    for (const accessChange of accessChanges) {
      const input = session(
        fixture,
        "active",
        new Date(Date.now() + 3_600_000).toISOString(),
      );
      await insertSession(fixture, input, "active");
      const parts = completionParts();
      const uploadSession =
        await loadMediaAssetUploadSessionForCompletionForWorkspace(
          input.userId,
          input.workspaceId,
          input.sessionId,
        );
      const storage = createDurableMultipartStorageFixture(
        input,
        parts,
        "promote",
      );
      const deadlines = createApplicationDeadlines(5_000, 8_000);
      let accessRevoked = false;
      try {
        const completion =
          completeMultipartUploadSessionAtApplicationBoundary(
            input.userId,
            uploadSession,
            parts,
            randomUUID(),
            applicationObservationScope(input),
            deadlines.operation,
            deadlines.writerLeaseTargetAtMs,
            deadlines.request,
            {
              ...applicationAttemptResolutionDependencies,
              abortMultipartMediaAssetUploadFn: async () => {},
              completeMultipartMediaAssetUploadFn: (storageInput) =>
                completeMultipartMediaAssetUploadWithDependencies(
                  storageInput,
                  {
                    s3Client: storage.client,
                    getMediaAssetsStorageConfigFn:
                      getTestMediaAssetsStorageConfig,
                  },
                ),
              completeMediaAssetUploadSessionForWorkspaceFn:
                completeMediaAssetUploadSessionForWorkspace,
            },
          );
        await storage.mutationStarted;
        await accessChange.revoke();
        accessRevoked = true;
        storage.releaseMutation();
        await assert.rejects(
          completion,
          (error: unknown): boolean => {
            assert.ok(error instanceof HttpError);
            assert.equal(error.statusCode, 503, accessChange.name);
            assert.equal(
              error.code,
              "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
              accessChange.name,
            );
            return true;
          },
        );
        const handoff = (await fixture.ownerPool.query<Readonly<{
          attempt_state: string;
          reconciliation_state: string;
          reservation_state: string;
          completed_parts_fingerprint: string;
        }>>(
          `SELECT attempts.state AS attempt_state,
             attempts.reconciliation_state,
             reservations.state AS reservation_state,
             attempts.completed_parts_fingerprint
           FROM content.media_blob_writer_attempts AS attempts
           INNER JOIN content.media_blob_writer_reservations AS reservations
             ON reservations.reservation_token=attempts.reservation_token
           WHERE attempts.media_upload_session_id=$1`,
          [input.sessionId],
        )).rows[0];
        assert.deepEqual(
          handoff,
          {
            attempt_state: "expired",
            reconciliation_state: "pending",
            reservation_state: "active",
            completed_parts_fingerprint:
              createMediaAssetUploadSessionCompletedPartsFingerprint(parts),
          },
          accessChange.name,
        );
        await accessChange.restore();
        accessRevoked = false;
        await applyHandedOffMultipartWithWorkerStorage(input, storage);
        assert.equal(
          (await loadMediaAssetUploadSessionForCompletionForWorkspace(
            input.userId,
            input.workspaceId,
            input.sessionId,
          )).state,
          "completed",
        );
      } finally {
        storage.releaseMutation();
        deadlines.operation.dispose();
        deadlines.request.dispose();
        if (accessRevoked) await accessChange.restore();
      }
    }
  });
});

