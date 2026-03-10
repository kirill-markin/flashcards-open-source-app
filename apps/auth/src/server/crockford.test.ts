import assert from "node:assert/strict";
import test from "node:test";
import { createCrockfordToken, normalizeCrockfordToken } from "./crockford.js";

test("createCrockfordToken returns the requested length with the expected alphabet", () => {
  const token = createCrockfordToken(20);

  assert.equal(token.length, 20);
  assert.match(token, /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/);
});

test("normalizeCrockfordToken strips separators and uppercases the value", () => {
  assert.equal(normalizeCrockfordToken("ab cd-ef", "otpSessionToken"), "ABCDEF");
});

test("normalizeCrockfordToken rejects characters outside Crockford Base32", () => {
  assert.throws(
    () => normalizeCrockfordToken("hello!", "otpSessionToken"),
    /Crockford Base32/,
  );
});
