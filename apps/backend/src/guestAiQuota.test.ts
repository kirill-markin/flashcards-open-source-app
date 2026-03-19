import assert from "node:assert/strict";
import test from "node:test";
import { calculateGuestDictationWeightedTokens } from "./guestAiQuota";

test("calculateGuestDictationWeightedTokens rounds uploaded bytes to whole KiB buckets", () => {
  assert.equal(calculateGuestDictationWeightedTokens(0), 0);
  assert.equal(calculateGuestDictationWeightedTokens(1), 4);
  assert.equal(calculateGuestDictationWeightedTokens(1024), 4);
  assert.equal(calculateGuestDictationWeightedTokens(1025), 8);
  assert.equal(calculateGuestDictationWeightedTokens(2048), 8);
});
