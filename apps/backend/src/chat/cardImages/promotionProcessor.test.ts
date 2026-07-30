import assert from "node:assert/strict";
import test from "node:test";
import {
  DatabaseCommitOutcomeUnknownError,
  TransientDatabaseHttpError,
} from "../../database/transient";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../mediaAssets/storageKeys";
import {
  testMediaAssetId, testObservationScope, testSha256, testWorkspaceId,
} from "../../mediaAssets/storage/testHelpers";
import { imageJpegCardMediaBlobNormalizationVersion } from "../../mediaAssets/types";
import {
  GeneratedMediaPromotionJobAccessRevokedError,
  type ClaimedGeneratedMediaPromotionJob,
  type GeneratedMediaBlobStorageCapability,
  type GeneratedMediaBlobWriterReservation,
} from "./promotionJobs";
import { processClaimedGeneratedMediaPromotionJobWithDependencies } from "./promotionProcessor";
const jobId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-07-25T00:00:00.000Z";
const nowMs = Date.parse(timestamp);
const writerReservationToken = "88888888-8888-4888-8888-888888888888";
const storageCapability = Object.freeze({}) as GeneratedMediaBlobStorageCapability;
const job: ClaimedGeneratedMediaPromotionJob = {
  jobId, operationId, userId: "user-1", workspaceId: testWorkspaceId,
  cardId: "55555555-5555-4555-8555-555555555555",
  targetSide: "back", altText: "Generated image", mediaAssetId: testMediaAssetId,
  replicaId: "66666666-6666-4666-8666-666666666666",
  stagingStorageKey: buildMediaUploadStagingStorageKey(testWorkspaceId, testMediaAssetId, operationId),
  blobStorageKey: buildMediaBlobStorageKey(testSha256),
  sha256: testSha256, mimeType: "image/jpeg", sizeBytes: 42,
  state: "leased", retryCount: 0, nextAttemptAt: timestamp,
  leaseToken: "77777777-7777-4777-8777-777777777777",
  leaseOwner: "test-worker", leaseExpiresAt: "2026-07-25T00:03:00.000Z",
  lastError: null, createdAt: timestamp, updatedAt: timestamp,
};
function writerReservation(): GeneratedMediaBlobWriterReservation {
  return Object.freeze({
    reservationToken: writerReservationToken,
    state: "active",
    normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
    writer: Object.freeze({
      ...job,
      reservationToken: writerReservationToken,
      normalizationVersion: imageJpegCardMediaBlobNormalizationVersion,
      reservationState: "active",
    }),
    storageCapability,
  });
}
test("processor reschedules transient database boundary errors", async () => {
  const result = await processClaimedGeneratedMediaPromotionJobWithDependencies(
    job,
    {
      leaseOwner: "test-worker", leaseDurationMs: 180_000,
      maximumJobs: 1, deadlineAtMs: nowMs + 60_000,
      observationScope: testObservationScope, signal: new AbortController().signal,
    },
    {
      claimJobsFn: async () => [],
      reserveWriterFn: async () => writerReservation(),
      promoteObjectFn: async (promotionInput) => {
        assert.equal(promotionInput.writer.reservationToken, writerReservationToken);
        assert.equal(promotionInput.storageCapability, storageCapability);
      },
      applyJobFn: async () => {
        throw new TransientDatabaseHttpError(
          Object.assign(new Error("deadlock detected"), { code: "40P01" }),
        );
      },
      rescheduleJobFn: async (_job, _deadlineAtMs, nextAttemptAt, error) => {
        assert.equal(nextAttemptAt.getTime(), nowMs + 30_000);
        assert.equal(error.code, "DATABASE_TRANSIENT");
      },
      failJobFn: async () => { assert.fail("Transient database errors must not fail the job."); },
      failAfterAccessRevocationFn: async () => "failed",
      markWriterAmbiguousFn: async () => {},
      nowFn: () => nowMs,
    },
  );
  assert.equal(result.outcome, "rescheduled");
  assert.equal(result.errorCode, "DATABASE_TRANSIENT");
});

test("processor replays the complete job after an unknown commit", async () => {
  let applyCalls = 0;
  let ambiguityCalls = 0;
  const result = await processClaimedGeneratedMediaPromotionJobWithDependencies(
    job,
    {
      leaseOwner: "test-worker", leaseDurationMs: 180_000,
      maximumJobs: 1, deadlineAtMs: nowMs + 60_000,
      observationScope: testObservationScope, signal: new AbortController().signal,
    },
    {
      claimJobsFn: async () => [],
      reserveWriterFn: async () => writerReservation(),
      promoteObjectFn: async () => {},
      applyJobFn: async (reservation) => {
        assert.equal(reservation.reservationToken, writerReservationToken);
        assert.equal(
          reservation.normalizationVersion,
          imageJpegCardMediaBlobNormalizationVersion,
        );
        applyCalls += 1;
        if (applyCalls === 1) {
          throw new DatabaseCommitOutcomeUnknownError(new Error("connection lost during commit"));
        }
      },
      rescheduleJobFn: async () => {
        assert.fail("A referenced unknown commit must replay instead of rescheduling.");
      },
      failJobFn: async () => {
        assert.fail("A referenced unknown commit must not fail the job.");
      },
      failAfterAccessRevocationFn: async () => "failed",
      markWriterAmbiguousFn: async (reservation) => {
        assert.equal(reservation.writer.jobId, job.jobId);
        assert.equal(reservation.reservationToken, writerReservationToken);
        ambiguityCalls += 1;
      },
      nowFn: () => nowMs,
    },
  );

  assert.equal(result.outcome, "applied");
  assert.equal(applyCalls, 2);
  assert.equal(ambiguityCalls, 1);
});

test("processor resolves access revocation through the fenced boundary during unknown-commit replay", async () => {
  let applyCalls = 0;
  let ambiguityCalls = 0;
  let accessRevocationCalls = 0;
  const reservation = writerReservation();
  const result = await processClaimedGeneratedMediaPromotionJobWithDependencies(
    job,
    {
      leaseOwner: "test-worker", leaseDurationMs: 180_000,
      maximumJobs: 1, deadlineAtMs: nowMs + 60_000,
      observationScope: testObservationScope, signal: new AbortController().signal,
    },
    {
      claimJobsFn: async () => [],
      reserveWriterFn: async () => reservation,
      promoteObjectFn: async () => {},
      applyJobFn: async () => {
        applyCalls += 1;
        if (applyCalls === 1) {
          throw new DatabaseCommitOutcomeUnknownError(new Error("connection lost during commit"));
        }
        throw new GeneratedMediaPromotionJobAccessRevokedError(job.jobId);
      },
      rescheduleJobFn: async () => {
        assert.fail("Access revocation replay must not reschedule the job.");
      },
      failJobFn: async () => {
        assert.fail("Access revocation replay must use the dedicated resolution boundary.");
      },
      failAfterAccessRevocationFn: async (claimedJob) => {
        assert.equal(claimedJob, reservation.writer);
        accessRevocationCalls += 1;
        return "access_active";
      },
      markWriterAmbiguousFn: async () => {
        ambiguityCalls += 1;
      },
      nowFn: () => nowMs,
    },
  );

  assert.equal(result.outcome, "interrupted");
  assert.equal(result.errorCode, "WORKSPACE_ACCESS_RECHECK_REQUIRED");
  assert.equal(applyCalls, 2);
  assert.equal(ambiguityCalls, 1);
  assert.equal(accessRevocationCalls, 1);
});
