import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getGuestAiWeightedMonthlyTokenCap,
  resetGuestAiQuotaConfigForTests,
} from "./guestAiQuotaConfig";

const originalGuestAiWeightedMonthlyTokenCap = process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;

function restoreEnvironment(): void {
  if (originalGuestAiWeightedMonthlyTokenCap === undefined) {
    delete process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;
  } else {
    process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP = originalGuestAiWeightedMonthlyTokenCap;
  }

  resetGuestAiQuotaConfigForTests();
}

afterEach(restoreEnvironment);

test("getGuestAiWeightedMonthlyTokenCap defaults to zero when env is missing", () => {
  delete process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;
  resetGuestAiQuotaConfigForTests();

  assert.equal(getGuestAiWeightedMonthlyTokenCap(), 0);
});

test("getGuestAiWeightedMonthlyTokenCap reads a configured positive integer", () => {
  process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP = "400000";
  resetGuestAiQuotaConfigForTests();

  assert.equal(getGuestAiWeightedMonthlyTokenCap(), 400_000);
});

test("getGuestAiWeightedMonthlyTokenCap accepts zero", () => {
  process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP = "0";
  resetGuestAiQuotaConfigForTests();

  assert.equal(getGuestAiWeightedMonthlyTokenCap(), 0);
});

test("getGuestAiWeightedMonthlyTokenCap rejects negative values", () => {
  process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP = "-1";
  resetGuestAiQuotaConfigForTests();

  assert.throws(
    () => getGuestAiWeightedMonthlyTokenCap(),
    /GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP must be a non-negative integer when set/,
  );
});

test("getGuestAiWeightedMonthlyTokenCap rejects non-integer text", () => {
  process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP = "abc";
  resetGuestAiQuotaConfigForTests();

  assert.throws(
    () => getGuestAiWeightedMonthlyTokenCap(),
    /GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP must be a non-negative integer when set/,
  );
});

test("getGuestAiWeightedMonthlyTokenCap rejects decimal values", () => {
  process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP = "10.5";
  resetGuestAiQuotaConfigForTests();

  assert.throws(
    () => getGuestAiWeightedMonthlyTokenCap(),
    /GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP must be a non-negative integer when set/,
  );
});
