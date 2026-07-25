import assert from "node:assert/strict";
import test from "node:test";
import { TransientDatabaseHttpError } from "../../database/transient";
import { buildMediaBlobStorageKey, buildMediaUploadStagingStorageKey } from "../../mediaAssets/storageKeys";
import {
  testMediaAssetId, testObservationScope, testSha256, testWorkspaceId,
} from "../../mediaAssets/storage/testHelpers";
import type { ClaimedGeneratedMediaPromotionJob } from "./promotionJobs";
import { processClaimedGeneratedMediaPromotionJobWithDependencies } from "./promotionProcessor";
const jobId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-07-25T00:00:00.000Z";
const nowMs = Date.parse(timestamp);
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
      promoteObjectFn: async () => {},
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
      nowFn: () => nowMs,
    },
  );
  assert.equal(result.outcome, "rescheduled");
  assert.equal(result.errorCode, "DATABASE_TRANSIENT");
});
