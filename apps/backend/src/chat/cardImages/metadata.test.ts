import assert from "node:assert/strict";
import test from "node:test";
import { deriveGeneratedCardImageOperationMetadata } from "./metadata";
const runId = "11111111-1111-4111-8111-111111111111";
const cardId = "22222222-2222-4222-8222-222222222222";
test("generated image metadata matches its stable contract vector", () => {
  const front = deriveGeneratedCardImageOperationMetadata(runId, cardId, "front");
  const retry = deriveGeneratedCardImageOperationMetadata(
    runId.toUpperCase(), cardId.toUpperCase(), "front",
  );
  assert.equal(front.operationId, "0e6e709f-ca5b-5992-9f23-46917d55e9f9");
  assert.equal(front.mediaAssetId, "1a7ca68f-9a72-564e-98b2-17f97f6ac54e");
  assert.deepEqual(retry, front);
});
test("generated image metadata separates card sides", () => {
  const back = deriveGeneratedCardImageOperationMetadata(runId, cardId, "back");
  assert.equal(back.operationId, "39f32f10-3901-55ee-b9b4-e9966cff86e1");
  assert.equal(back.mediaAssetId, "2c574654-675a-5ade-a6f2-1c32f0f57353");
});
