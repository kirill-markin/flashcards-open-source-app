import assert from "node:assert/strict";
import test from "node:test";
import { deriveGeneratedCardImageOperationMetadata } from "./metadata";
const runId = "11111111-1111-4111-8111-111111111111";
const operationKey = "generated-image:1";
test("generated image metadata matches its stable contract vector", () => {
  const original = deriveGeneratedCardImageOperationMetadata(runId, operationKey);
  const retry = deriveGeneratedCardImageOperationMetadata(
    runId.toUpperCase(), operationKey,
  );
  assert.equal(original.operationId, "b94760f3-5c29-50a8-9d7c-9ac94f7a5926");
  assert.equal(original.mediaAssetId, "e6ea0d07-3f7d-5d94-9e93-92a90215b232");
  assert.deepEqual(retry, original);
});
test("generated image metadata separates run-scoped image ordinals", () => {
  const second = deriveGeneratedCardImageOperationMetadata(
    runId,
    "generated-image:2",
  );
  assert.equal(second.operationId, "a35197b0-e582-5daa-bb8b-954d1c23de7d");
  assert.equal(second.mediaAssetId, "a3fc2152-e51f-5d1b-829a-40580ffd5ecb");
});
