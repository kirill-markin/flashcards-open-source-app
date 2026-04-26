import assert from "node:assert/strict";
import test from "node:test";
import { __internal } from "./server/cognitoAuth.js";

const REQUIRED_CLASS_SELECTION_SIZES: readonly number[] = [26, 26, 10, 32];

const countMatches = (value: string, pattern: RegExp): number => {
  const matches = value.match(pattern);
  return matches === null ? 0 : matches.length;
};

test("Cognito sign-up password explicitly sources every required user-pool class", () => {
  const randomIndexMaxExclusiveValues: number[] = [];
  const selectFirstIndex = (maxExclusive: number): number => {
    assert.ok(maxExclusive > 0);
    randomIndexMaxExclusiveValues.push(maxExclusive);
    return 0;
  };

  const password = __internal.createCognitoSignUpPasswordWithRandomIndex(selectFirstIndex);

  assert.deepEqual(
    randomIndexMaxExclusiveValues.slice(0, REQUIRED_CLASS_SELECTION_SIZES.length),
    REQUIRED_CLASS_SELECTION_SIZES,
  );
  assert.equal(password.length, 64);
  assert.equal(countMatches(password, /[A-Z]/g), 1);
  assert.equal(countMatches(password, /[a-z]/g), 61);
  assert.equal(countMatches(password, /[0-9]/g), 1);
  assert.equal(
    countMatches(password, /[\^$*.[\]{}()?"!@#%&/\\,><':;|_~`=+\-]/g),
    1,
  );
});
