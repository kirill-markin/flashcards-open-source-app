import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import test from "node:test";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../../../database/transient";
import { HttpError } from "../../../shared/errors";
import {
  withPostgresIntegrationFixture,
} from "../../../testSupport/postgresIntegration";
import {
  beginMediaAssetUploadSessionAbortForWorkspace,
  beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner,
  beginMediaAssetUploadSessionCompletionAttemptWithOwner,
  beginMediaAssetUploadSessionCompletionAttemptWithOwnerUntilSettled,
  completeMediaAssetUploadSessionForWorkspace,
  createMediaAssetUploadSessionCompletedPartsFingerprint,
  handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation,
  loadMediaAssetForCompletedUploadSessionReplayForWorkspace,
  loadMediaAssetUploadSessionForCompletionForWorkspace,
  resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner,
  type MultipartMediaBlobWriterAttemptExactInput,
  type MultipartMediaBlobWriterAttemptInput,
} from "../../uploadSessions";
import {
  createMultipartWriterHeartbeat,
  isExpiredMultipartCompletionCleanupRequired,
} from "./writerLease";
import {
  completeMultipartUploadSessionAtApplicationBoundary,
} from "../completion/completionBoundary";
import {
  createMultipartCompletionWriterLeaseTargetAtMs,
} from "../../../server/mediaRequests/multipartCompletionRequestTiming";
import {
  applicationAttemptResolutionDependencies,
  applicationObservationScope,
  close,
  completionParts,
  createApplicationDeadlines,
  digest,
  insertSession,
  session,
  transientDatabaseUnavailable,
} from "../atomicWriterPostgresTestSupport";

test("absolute foreground writer leases remain between operation abort and exact resolution", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, input, "active");
    const attemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...input,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const observedAtMs = Date.now();
    const operationDeadlineAtMs = observedAtMs + 1_000;
    const requestDeadlineAtMs = observedAtMs + 3_000;
    const writerLeaseTargetAtMs =
      createMultipartCompletionWriterLeaseTargetAtMs(
        operationDeadlineAtMs,
        requestDeadlineAtMs,
      );
    const acquired =
      await beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
        attemptInput,
        writerLeaseTargetAtMs,
      );
    assert.equal(acquired.status, "acquired");
    assert.ok("reservationToken" in acquired);
    const acquiredLeaseExpiresAtMs = Date.parse(acquired.leaseExpiresAt);
    assert.ok(operationDeadlineAtMs < acquiredLeaseExpiresAtMs);
    assert.ok(acquiredLeaseExpiresAtMs < writerLeaseTargetAtMs);
    assert.ok(writerLeaseTargetAtMs < requestDeadlineAtMs);

    await wait(50);
    const renewed =
      await beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
        attemptInput,
        writerLeaseTargetAtMs,
      );
    assert.equal(renewed.status, "replayed");
    assert.ok("reservationToken" in renewed);
    const renewedLeaseExpiresAtMs = Date.parse(renewed.leaseExpiresAt);
    assert.ok(operationDeadlineAtMs < renewedLeaseExpiresAtMs);
    assert.ok(renewedLeaseExpiresAtMs < writerLeaseTargetAtMs);
    assert.equal(
      renewed.reservationToken,
      acquired.reservationToken,
    );
    assert.equal(
      await resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner({
        ...attemptInput,
        reservationToken: acquired.reservationToken,
        normalizationVersion: acquired.normalizationVersion,
      }),
      "unreferenced_restored",
    );
  });
});

test("stalled foreground heartbeat stops storage before abort admission can fence the lease", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const input = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, input, "active");
    const attemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...input,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const writerLeaseTargetAtMs = Date.now() + 1_000;
    const acquired =
      await beginMediaAssetUploadSessionCompletionAttemptAtLeaseTargetWithOwner(
        attemptInput,
        writerLeaseTargetAtMs,
      );
    assert.equal(acquired.status, "acquired");
    assert.ok("reservationToken" in acquired);
    const confirmedLeaseExpiresAtMs = Date.parse(acquired.leaseExpiresAt);
    const operationDeadlineAtMs = writerLeaseTargetAtMs - 300;
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
        storageCapability: acquired.storageCapability,
        leaseExpiresAt: acquired.leaseExpiresAt,
      },
      new AbortController().signal,
      operationDeadlineAtMs,
      writerLeaseTargetAtMs,
      200,
      25,
      async () => {
        signalRenewalStarted();
        await renewalRelease;
        throw transientDatabaseUnavailable(
          "Foreground heartbeat remained unavailable.",
        );
      },
    );
    let storageMutationLive = true;
    let storageStoppedAtMs: number | null = null;
    const blockedStorage = new Promise<void>((_resolve, reject) => {
      const stopStorage = (): void => {
        storageMutationLive = false;
        storageStoppedAtMs = Date.now();
        reject(heartbeat.signal.reason);
      };
      heartbeat.signal.addEventListener(
        "abort",
        stopStorage,
        { once: true },
      );
    });

    await renewalStarted;
    const liveAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        input.userId,
        input.workspaceId,
        input.sessionId,
      );
    assert.equal(liveAbort.status, "completion_in_progress");
    assert.equal(storageMutationLive, true);

    await assert.rejects(blockedStorage);
    assert.equal(storageMutationLive, false);
    assert.ok(storageStoppedAtMs !== null);
    assert.ok(storageStoppedAtMs < confirmedLeaseExpiresAtMs);
    releaseRenewal();
    await heartbeat.stop();
    const waitUntilSafeExpiryMs =
      confirmedLeaseExpiresAtMs + 110 - Date.now();
    if (waitUntilSafeExpiryMs > 0) await wait(waitUntilSafeExpiryMs);

    const admittedAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        input.userId,
        input.workspaceId,
        input.sessionId,
      );
    assert.equal(storageMutationLive, false);
    assert.equal(admittedAbort.status, "abort_required");
    assert.equal(await close(input, input.sizeBytes), "aborted");
  });
});

test("foreground exact cleanup retries transient and unknown outcomes and waits out persistent failure safely", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const handoffInput = session(fixture, "active", future);
    await insertSession(fixture, handoffInput, "active");
    const handoffSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        handoffInput.userId,
        handoffInput.workspaceId,
        handoffInput.sessionId,
      );
    const handoffDeadlines = createApplicationDeadlines(1_500, 3_500);
    let handoffCalls = 0;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          handoffInput.userId,
          handoffSession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(handoffInput),
          handoffDeadlines.operation,
          handoffDeadlines.writerLeaseTargetAtMs,
          handoffDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async (storageInput) => {
              await new Promise<void>((_resolve, reject) => {
                const rejectWithAbortReason = (): void =>
                  reject(storageInput.signal.reason);
                storageInput.signal.addEventListener(
                  "abort",
                  rejectWithAbortReason,
                  { once: true },
                );
              });
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
            handoffCompletionAttemptAfterAccessRevocationFn:
              async (writer) => {
                handoffCalls += 1;
                if (handoffCalls < 3) {
                  throw transientDatabaseUnavailable(
                    "Durable handoff is temporarily unavailable.",
                  );
                }
                return handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation(
                  writer,
                );
              },
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
          );
          return true;
        },
      );
    } finally {
      handoffDeadlines.operation.dispose();
      handoffDeadlines.request.dispose();
    }
    assert.equal(handoffCalls, 3);

    const failureInput = session(fixture, "active", future);
    await insertSession(fixture, failureInput, "active");
    const failureSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        failureInput.userId,
        failureInput.workspaceId,
        failureInput.sessionId,
      );
    const failureDeadlines = createApplicationDeadlines(2_000, 4_000);
    const storageFailure = new Error("Foreground storage failed.");
    let failureResolutionCalls = 0;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          failureInput.userId,
          failureSession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(failureInput),
          failureDeadlines.operation,
          failureDeadlines.writerLeaseTargetAtMs,
          failureDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {
              throw storageFailure;
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
            resolveCompletionAttemptFailureWithOwnerFn:
              async (writer) => {
                failureResolutionCalls += 1;
                if (failureResolutionCalls < 3) {
                  throw transientDatabaseUnavailable(
                    "Failure resolution is temporarily unavailable.",
                  );
                }
                return resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner(
                  writer,
                );
              },
          },
        ),
        (error: unknown): boolean => error === storageFailure,
      );
    } finally {
      failureDeadlines.operation.dispose();
      failureDeadlines.request.dispose();
    }
    assert.equal(failureResolutionCalls, 3);

    const unknownInput = session(fixture, "active", future);
    await insertSession(fixture, unknownInput, "active");
    const unknownSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        unknownInput.userId,
        unknownInput.workspaceId,
        unknownInput.sessionId,
      );
    const unknownDeadlines = createApplicationDeadlines(1_500, 3_500);
    let unknownHandoffCalls = 0;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          unknownInput.userId,
          unknownSession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(unknownInput),
          unknownDeadlines.operation,
          unknownDeadlines.writerLeaseTargetAtMs,
          unknownDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async (storageInput) => {
              await new Promise<void>((_resolve, reject) => {
                const rejectWithAbortReason = (): void =>
                  reject(storageInput.signal.reason);
                storageInput.signal.addEventListener(
                  "abort",
                  rejectWithAbortReason,
                  { once: true },
                );
              });
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
            handoffCompletionAttemptAfterAccessRevocationFn:
              async (writer) => {
                unknownHandoffCalls += 1;
                const status =
                  await handoffMediaAssetUploadSessionCompletionAttemptAfterAccessRevocation(
                    writer,
                  );
                if (unknownHandoffCalls === 1) {
                  throw new DatabaseCommitOutcomeUnknownError(
                    new Error("Handoff commit response was lost."),
                  );
                }
                return status;
              },
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(
            error.code,
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
          );
          return true;
        },
      );
    } finally {
      unknownDeadlines.operation.dispose();
      unknownDeadlines.request.dispose();
    }
    assert.equal(unknownHandoffCalls, 2);

    const persistentInput = session(fixture, "active", future);
    await insertSession(fixture, persistentInput, "active");
    const persistentSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        persistentInput.userId,
        persistentInput.workspaceId,
        persistentInput.sessionId,
      );
    const persistentDeadlines = createApplicationDeadlines(1_200, 2_400);
    const persistentStorageFailure =
      new Error("Persistent foreground storage failure.");
    let persistentResolutionCalls = 0;
    let persistentStorageMutationLive = false;
    try {
      await assert.rejects(
        completeMultipartUploadSessionAtApplicationBoundary(
          persistentInput.userId,
          persistentSession,
          completionParts(),
          randomUUID(),
          applicationObservationScope(persistentInput),
          persistentDeadlines.operation,
          persistentDeadlines.writerLeaseTargetAtMs,
          persistentDeadlines.request,
          {
            ...applicationAttemptResolutionDependencies,
            abortMultipartMediaAssetUploadFn: async () => {},
            completeMultipartMediaAssetUploadFn: async () => {
              persistentStorageMutationLive = true;
              persistentStorageMutationLive = false;
              throw persistentStorageFailure;
            },
            completeMediaAssetUploadSessionForWorkspaceFn:
              completeMediaAssetUploadSessionForWorkspace,
            resolveCompletionAttemptFailureWithOwnerFn: async () => {
              persistentResolutionCalls += 1;
              throw transientDatabaseUnavailable(
                "Exact failure resolution remains unavailable.",
              );
            },
          },
        ),
        (error: unknown): boolean => {
          assert.ok(error instanceof HttpError);
          assert.equal(error.code, "SERVICE_UNAVAILABLE");
          assert.ok(error.cause instanceof AggregateError);
          assert.deepEqual(
            error.cause.errors[0],
            persistentStorageFailure,
          );
          assert.ok(
            error.cause.errors[1] instanceof TransientDatabaseHttpError,
          );
          return true;
        },
      );
    } finally {
      persistentDeadlines.operation.dispose();
      persistentDeadlines.request.dispose();
    }
    assert.equal(persistentStorageMutationLive, false);
    assert.ok(persistentResolutionCalls >= 1);
    const persistentAttempt =
      (await fixture.ownerPool.query<Readonly<{
        live_attempts: number;
        reconciliation_state: string | null;
      }>>(
        `SELECT
           count(*) FILTER (
             WHERE attempts.state='leased'
               AND attempts.lease_expires_at > clock_timestamp()
           )::int AS live_attempts,
           min(attempts.reconciliation_state)::text AS reconciliation_state
         FROM content.media_blob_writer_attempts AS attempts
         WHERE attempts.media_upload_session_id=$1`,
        [persistentInput.sessionId],
      )).rows[0];
    assert.deepEqual(persistentAttempt, {
      live_attempts: 0,
      reconciliation_state: null,
    });
    const persistentAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        persistentInput.userId,
        persistentInput.workspaceId,
        persistentInput.sessionId,
      );
    assert.equal(persistentAbort.status, "abort_required");
    assert.equal(
      await close(persistentInput, persistentInput.sizeBytes),
      "aborted",
    );
  });
});

test("multipart attempt wrappers reuse exact tokens and reject stale workers after takeover", async () => {
  await withPostgresIntegrationFixture(async (fixture) => {
    const appliedInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, appliedInput, "active");
    const appliedParts = [{
      partNumber: 1,
      eTag: "\"applied-etag\"",
      sha256: digest(),
    }];
    const appliedAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...appliedInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint:
        createMediaAssetUploadSessionCompletedPartsFingerprint(appliedParts),
    };
    const appliedAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        appliedAttemptInput,
        60_000,
      );
    assert.equal(appliedAttempt.status, "acquired");
    assert.ok("reservationToken" in appliedAttempt);
    assert.equal(
      (await fixture.ownerPool.query<Readonly<{ count: number }>>(
        `SELECT count(*)::int AS count
         FROM content.media_assets
         WHERE media_asset_id=$1`,
        [appliedInput.mediaAssetId],
      )).rows[0].count,
      0,
    );
    const appliedWriter: MultipartMediaBlobWriterAttemptExactInput = {
      ...appliedAttemptInput,
      reservationToken: appliedAttempt.reservationToken,
      normalizationVersion: appliedAttempt.normalizationVersion,
    };
    const applied = await completeMediaAssetUploadSessionForWorkspace(
      appliedInput.userId,
      appliedInput.workspaceId,
      appliedInput.sessionId,
      appliedWriter,
    );
    const appliedState = (await fixture.ownerPool.query<Readonly<{
      asset_count: number;
      attempt_state: string;
      attempt_outcome: string;
    }>>(
      `SELECT
         (SELECT count(*)::int FROM content.media_assets
          WHERE media_asset_id=$1) AS asset_count,
         state AS attempt_state,
         outcome AS attempt_outcome
       FROM content.media_blob_writer_attempts
       WHERE attempt_token=$2`,
      [appliedInput.mediaAssetId, appliedAttemptInput.attemptToken],
    )).rows[0];
    assert.deepEqual(
      {
        applied: applied.applied,
        ...appliedState,
      },
      {
        applied: true,
        asset_count: 1,
        attempt_state: "applied",
        attempt_outcome: "live_applied",
      },
    );
    const exactReplay = await completeMediaAssetUploadSessionForWorkspace(
      appliedInput.userId,
      appliedInput.workspaceId,
      appliedInput.sessionId,
      appliedWriter,
    );
    assert.equal(exactReplay.applied, false);
    const terminalReplay =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        appliedAttemptInput,
        60_000,
      );
    assert.equal(terminalReplay.status, "live_applied");
    const freshTerminalReplay =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        { ...appliedAttemptInput, attemptToken: randomUUID() },
        60_000,
      );
    assert.equal(freshTerminalReplay.status, "live_applied");
    const mismatchedPartsReplay =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        {
          ...appliedAttemptInput,
          attemptToken: randomUUID(),
          completedPartsFingerprint: digest(),
        },
        60_000,
      );
    assert.equal(mismatchedPartsReplay.status, "stale_attempt");

    const laterOperationId = randomUUID();
    const laterClientUpdatedAt = new Date(
      Date.parse(appliedInput.clientUpdatedAt) + 60_000,
    ).toISOString();
    await fixture.ownerPool.query(
      `UPDATE content.media_assets
       SET source_url=$1,client_updated_at=$2,last_operation_id=$3
       WHERE media_asset_id=$4`,
      [
        "https://example.com/later-metadata",
        laterClientUpdatedAt,
        laterOperationId,
        appliedInput.mediaAssetId,
      ],
    );
    const replayAfterMetadataMutation =
      await completeMediaAssetUploadSessionForWorkspace(
        appliedInput.userId,
        appliedInput.workspaceId,
        appliedInput.sessionId,
        appliedWriter,
      );
    assert.deepEqual(
      {
        applied: replayAfterMetadataMutation.applied,
        sourceUrl: replayAfterMetadataMutation.mediaAsset.sourceUrl,
        clientUpdatedAt:
          replayAfterMetadataMutation.mediaAsset.clientUpdatedAt,
        lastOperationId:
          replayAfterMetadataMutation.mediaAsset.lastOperationId,
      },
      {
        applied: false,
        sourceUrl: "https://example.com/later-metadata",
        clientUpdatedAt: laterClientUpdatedAt,
        lastOperationId: laterOperationId,
      },
    );
    const laterDeletedAt = new Date(
      Date.parse(laterClientUpdatedAt) + 60_000,
    ).toISOString();
    await fixture.ownerPool.query(
      `UPDATE content.media_assets
       SET deleted_at=$1,client_updated_at=$1,last_operation_id=$2
       WHERE media_asset_id=$3`,
      [laterDeletedAt, randomUUID(), appliedInput.mediaAssetId],
    );
    const freshReplayAfterDeletion =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        { ...appliedAttemptInput, attemptToken: randomUUID() },
        60_000,
      );
    assert.equal(freshReplayAfterDeletion.status, "live_applied");
    const completedSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        appliedInput.userId,
        appliedInput.workspaceId,
        appliedInput.sessionId,
      );
    const tombstonedReplay =
      await loadMediaAssetForCompletedUploadSessionReplayForWorkspace(
        appliedInput.userId,
        completedSession,
      );
    assert.equal(tombstonedReplay.deletedAt, laterDeletedAt);

    const input = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, input, "active");
    const parts = [{
      partNumber: 1,
      eTag: "\"etag-1\"",
      sha256: digest(),
    }];
    const attemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...input,
      attemptToken: randomUUID(),
      completedPartsFingerprint:
        createMediaAssetUploadSessionCompletedPartsFingerprint(parts),
    };
    const acquired =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        attemptInput,
        60_000,
      );
    assert.equal(acquired.status, "acquired");
    assert.ok("reservationToken" in acquired);
    const replayed =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        attemptInput,
        60_000,
      );
    assert.equal(replayed.status, "replayed");
    assert.ok("reservationToken" in replayed);
    assert.equal(replayed.reservationToken, acquired.reservationToken);

    const busy = await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
      { ...attemptInput, attemptToken: randomUUID() },
      60_000,
    );
    assert.equal(busy.status, "busy");
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET lease_expires_at=clock_timestamp()-interval '1 second'
       WHERE attempt_token=$1`,
      [attemptInput.attemptToken],
    );
    const takeoverInput = { ...attemptInput, attemptToken: randomUUID() };
    const takeover =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        takeoverInput,
        60_000,
      );
    assert.equal(takeover.status, "expired_takeover");
    assert.ok("reservationToken" in takeover);
    const staleWriter: MultipartMediaBlobWriterAttemptExactInput = {
      ...attemptInput,
      reservationToken: acquired.reservationToken,
      normalizationVersion: acquired.normalizationVersion,
    };
    assert.equal(
      await resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner(
        staleWriter,
      ),
      "stale_attempt",
    );
    assert.equal(
      await resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner({
        ...takeoverInput,
        reservationToken: takeover.reservationToken,
        normalizationVersion: takeover.normalizationVersion,
      }),
      "unreferenced_restored",
    );

    const renewedInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, renewedInput, "active");
    const renewedAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...renewedInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const shortLease =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        renewedAttemptInput,
        400,
      );
    assert.equal(shortLease.status, "acquired");
    assert.ok("reservationToken" in shortLease);
    let heartbeatRenewals = 0;
    const heartbeatLeaseTargetAtMs = Date.now() + 5_000;
    const heartbeatOperationDeadlineAtMs =
      heartbeatLeaseTargetAtMs - 1_000;
    const heartbeat = createMultipartWriterHeartbeat(
      {
        storageCapability: shortLease.storageCapability,
        leaseExpiresAt: shortLease.leaseExpiresAt,
      },
      new AbortController().signal,
      heartbeatOperationDeadlineAtMs,
      heartbeatLeaseTargetAtMs,
      50,
      75,
      async () => {
        heartbeatRenewals += 1;
        const renewedLease =
          await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
            renewedAttemptInput,
            400,
          );
        assert.equal(renewedLease.status, "replayed");
        assert.ok("reservationToken" in renewedLease);
        assert.equal(
          renewedLease.reservationToken,
          shortLease.reservationToken,
        );
        return {
          storageCapability: renewedLease.storageCapability,
          leaseExpiresAt: renewedLease.leaseExpiresAt,
        };
      },
    );
    await heartbeat.renewNow();
    await wait(800);
    await heartbeat.stopAndRenewForFinalization();
    heartbeat.throwIfFailed();
    assert.ok(heartbeatRenewals >= 3);
    const renewedApply = await completeMediaAssetUploadSessionForWorkspace(
      renewedInput.userId,
      renewedInput.workspaceId,
      renewedInput.sessionId,
      {
        ...renewedAttemptInput,
        reservationToken: shortLease.reservationToken,
        normalizationVersion: shortLease.normalizationVersion,
      },
    );
    assert.equal(renewedApply.applied, true);

    const peerCompletionInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, peerCompletionInput, "active");
    const peerAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...peerCompletionInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const peerAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        peerAttemptInput,
        1_000,
      );
    assert.equal(peerAttempt.status, "acquired");
    assert.ok("reservationToken" in peerAttempt);
    const peerWriter: MultipartMediaBlobWriterAttemptExactInput = {
      ...peerAttemptInput,
      reservationToken: peerAttempt.reservationToken,
      normalizationVersion: peerAttempt.normalizationVersion,
    };
    const peerApply = wait(50).then(
      () => completeMediaAssetUploadSessionForWorkspace(
        peerCompletionInput.userId,
        peerCompletionInput.workspaceId,
        peerCompletionInput.sessionId,
        peerWriter,
      ),
    );
    const peerWaitStartedAtMs = Date.now();
    const waitedReplay =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwnerUntilSettled(
        { ...peerAttemptInput, attemptToken: randomUUID() },
        1_000,
        Date.now() + 3_000,
        new AbortController().signal,
      );
    assert.equal((await peerApply).applied, true);
    assert.equal(waitedReplay.status, "live_applied");
    assert.ok(Date.now() - peerWaitStartedAtMs < 800);

    const expiredTakeoverInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, expiredTakeoverInput, "active");
    const expiredOwnerInput: MultipartMediaBlobWriterAttemptInput = {
      ...expiredTakeoverInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const expiredOwner =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        expiredOwnerInput,
        150,
      );
    assert.equal(expiredOwner.status, "acquired");
    const takeoverAfterWaitInput = {
      ...expiredOwnerInput,
      attemptToken: randomUUID(),
    };
    const takeoverAfterWait =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwnerUntilSettled(
        takeoverAfterWaitInput,
        1_000,
        Date.now() + 3_000,
        new AbortController().signal,
      );
    assert.equal(takeoverAfterWait.status, "expired_takeover");
    assert.ok("reservationToken" in takeoverAfterWait);
    assert.equal(
      await resolveMediaAssetUploadSessionCompletionAttemptFailureWithOwner({
        ...takeoverAfterWaitInput,
        reservationToken: takeoverAfterWait.reservationToken,
        normalizationVersion: takeoverAfterWait.normalizationVersion,
      }),
      "unreferenced_restored",
    );

    const deadlineInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, deadlineInput, "active");
    const deadlineOwnerInput: MultipartMediaBlobWriterAttemptInput = {
      ...deadlineInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const deadlineOwner =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        deadlineOwnerInput,
        5_000,
      );
    assert.equal(deadlineOwner.status, "acquired");
    await assert.rejects(
      beginMediaAssetUploadSessionCompletionAttemptWithOwnerUntilSettled(
        { ...deadlineOwnerInput, attemptToken: randomUUID() },
        1_000,
        Date.now() + 500,
        new AbortController().signal,
      ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 503);
        assert.equal(
          error.code,
          "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
        );
        assert.match(error.message, /Retry the same completion request/);
        return true;
      },
    );

    const interruptedExpiredAbort = session(
      fixture,
      "active",
      new Date(Date.now() - 3_600_000).toISOString(),
    );
    await insertSession(fixture, interruptedExpiredAbort, "active");
    assert.equal(
      (await beginMediaAssetUploadSessionAbortForWorkspace(
        interruptedExpiredAbort.userId,
        interruptedExpiredAbort.workspaceId,
        interruptedExpiredAbort.sessionId,
      )).status,
      "abort_required",
    );
    const interruptedSession =
      await loadMediaAssetUploadSessionForCompletionForWorkspace(
        interruptedExpiredAbort.userId,
        interruptedExpiredAbort.workspaceId,
        interruptedExpiredAbort.sessionId,
      );
    assert.equal(interruptedSession.state, "aborting");
    assert.equal(
      isExpiredMultipartCompletionCleanupRequired(interruptedSession),
      true,
    );
    const resumedAbort =
      await beginMediaAssetUploadSessionAbortForWorkspace(
        interruptedExpiredAbort.userId,
        interruptedExpiredAbort.workspaceId,
        interruptedExpiredAbort.sessionId,
      );
    assert.equal(resumedAbort.status, "abort_required");
    assert.equal(
      await close(
        interruptedExpiredAbort,
        interruptedExpiredAbort.sizeBytes,
      ),
      "no_writer_closed",
    );
    assert.equal(
      (await loadMediaAssetUploadSessionForCompletionForWorkspace(
        interruptedExpiredAbort.userId,
        interruptedExpiredAbort.workspaceId,
        interruptedExpiredAbort.sessionId,
      )).state,
      "aborted",
    );

    const abortInput = session(
      fixture,
      "active",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    await insertSession(fixture, abortInput, "active");
    const abortAttemptInput: MultipartMediaBlobWriterAttemptInput = {
      ...abortInput,
      attemptToken: randomUUID(),
      completedPartsFingerprint: digest(),
    };
    const abortAttempt =
      await beginMediaAssetUploadSessionCompletionAttemptWithOwner(
        abortAttemptInput,
        60_000,
      );
    assert.equal(abortAttempt.status, "acquired");
    await fixture.ownerPool.query(
      `UPDATE content.media_blob_writer_attempts
       SET lease_expires_at=clock_timestamp()-interval '1 second'
       WHERE attempt_token=$1`,
      [abortAttemptInput.attemptToken],
    );
    assert.equal(
      (await beginMediaAssetUploadSessionAbortForWorkspace(
        abortInput.userId,
        abortInput.workspaceId,
        abortInput.sessionId,
      )).status,
      "abort_required",
    );
    assert.equal(await close(abortInput, abortInput.sizeBytes), "aborted");
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
        [abortInput.sessionId],
      )).rows[0],
      {
        session_state: "aborted",
        attempt_state: "expired",
        reservation_state: "unreferenced",
      },
    );
  });
});
