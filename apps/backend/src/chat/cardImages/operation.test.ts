import assert from "node:assert/strict";
import test from "node:test";
import { createBackendObservationScope } from "../../observability/sentry";
import { deriveGeneratedCardImageOperationMetadata } from "./metadata";
import {
  generateCardImageWithDependencies, type GeneratedCardImageOperationDependencies,
} from "./operation";
import type { GeneratedCardImageInput } from "./types";
const runId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const cardId = "33333333-3333-4333-8333-333333333333";
const replicaId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";
function createInput(signal: AbortSignal): GeneratedCardImageInput {
  return {
    runId, sessionId, claimToken: "2026-07-24 10:11:12.123456+00",
    userId: "operation-test-user", workspaceId, cardId, targetSide: "back",
    imagePrompt: "Draw a labeled plant cell.", altText: "Plant cell diagram", replicaId,
    observationContext: {
      scope: createBackendObservationScope(
        "chat-worker", "operation-test-request", null, null, "operation-test-user",
        workspaceId, "operation-test-chat-request", runId, sessionId, null, null,
      ), rootObservation: null,
    },
    signal, operationDeadlineMs: Date.now() + 120_000,
  };
}
test("generated image orchestration stages before durable enqueue", async () => {
  const calls: Array<string> = [];
  const metadata = deriveGeneratedCardImageOperationMetadata(runId, cardId, "back");
  const lockSignal = new AbortController().signal;
  const dependencies: GeneratedCardImageOperationDependencies = {
    assertPreconditionsFn: async () => { calls.push("preconditions"); },
    withOperationLockFn: async (lockInput, callback) => {
      calls.push("lock");
      assert.notEqual(lockInput.signal, lockSignal);
      return callback(lockSignal);
    },
    prepareStagedImageFn: async (input) => {
      calls.push("stage");
      assert.equal(input.signal, lockSignal);
      return {
        stagingStorageKey: "media/uploads/test", mimeType: "image/jpeg",
        sizeBytes: 10, sha256: "a".repeat(64), reused: false,
      };
    },
    enqueuePromotionJobFn: async (input, operationMetadata, preparedImage) => {
      calls.push("enqueue");
      assert.equal(input.signal.aborted, false);
      assert.deepEqual(operationMetadata, metadata);
      assert.equal(preparedImage.stagingStorageKey, "media/uploads/test");
      return { outcome: "created", jobId: metadata.operationId };
    },
  };
  const result = await generateCardImageWithDependencies(
    createInput(new AbortController().signal), dependencies,
  );
  assert.deepEqual(calls, ["preconditions", "lock", "stage", "enqueue"]);
  assert.deepEqual(result, {
    status: "queued", cardId, mediaAssetId: metadata.mediaAssetId, targetSide: "back",
    mediaRegistrationApplied: false, cardAppendApplied: false, reused: false, sourceUrl: null,
  });
});
