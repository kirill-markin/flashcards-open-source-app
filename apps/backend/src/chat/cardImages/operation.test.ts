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
const timestamp = "2026-07-24T10:00:00.000Z";
function createInput(signal: AbortSignal): GeneratedCardImageInput {
  return {
    runId, userId: "operation-test-user", workspaceId, cardId, targetSide: "back",
    imagePrompt: "Draw a labeled plant cell.",
    altText: "Plant cell diagram",
    replicaId,
    observationContext: {
      scope: createBackendObservationScope(
        "chat-worker", "operation-test-request", null, null, "operation-test-user",
        workspaceId, "operation-test-chat-request", runId,
        "55555555-5555-4555-8555-555555555555", null, null,
      ), rootObservation: null,
    },
    signal,
  };
}
test("generated image orchestration prepares before persistence", async () => {
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
    findMediaAssetFn: async () => { calls.push("find-media"); return null; },
    prepareGeneratedImageFn: async (input) => {
      calls.push("prepare");
      assert.equal(input.signal, lockSignal);
      return {
        mediaAssetId: metadata.mediaAssetId, sourceUrl: null,
        createdAt: timestamp, clientUpdatedAt: timestamp,
        lastModifiedByReplicaId: replicaId, lastOperationId: metadata.mediaLastOperationId,
        sizeBytes: 10, sha256: "a".repeat(64),
      };
    },
    persistGeneratedImageFn: async (input, _metadata, preparedImage) => {
      calls.push("persist");
      assert.equal(input.signal, lockSignal);
      assert.notEqual(preparedImage, null);
      return { mediaRegistrationApplied: true, cardAppendApplied: true, reused: false };
    },
  };
  const result = await generateCardImageWithDependencies(
    createInput(new AbortController().signal), dependencies,
  );
  assert.deepEqual(calls, ["preconditions", "lock", "find-media", "prepare", "persist"]);
  assert.deepEqual(result, {
    cardId, mediaAssetId: metadata.mediaAssetId, targetSide: "back",
    mediaRegistrationApplied: true, cardAppendApplied: true, reused: false, sourceUrl: null,
  });
});
