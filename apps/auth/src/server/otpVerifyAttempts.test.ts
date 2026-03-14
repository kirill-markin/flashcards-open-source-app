import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveOtpVerifyAttemptState,
  deriveOtpVerifyFailureResult,
  MAX_OTP_VERIFY_ATTEMPTS,
  hashOtpChallengeKey,
} from "./otpVerifyAttempts.js";

test("hashOtpChallengeKey is stable for the same challenge identity", () => {
  assert.equal(
    hashOtpChallengeKey("user@example.com", "session-1"),
    hashOtpChallengeKey("user@example.com", "session-1"),
  );
});

test("hashOtpChallengeKey changes when the Cognito session changes", () => {
  assert.notEqual(
    hashOtpChallengeKey("user@example.com", "session-1"),
    hashOtpChallengeKey("user@example.com", "session-2"),
  );
});

test("max OTP verify attempts stays locked at five", () => {
  assert.equal(MAX_OTP_VERIFY_ATTEMPTS, 5);
});

test("first invalid attempt creates attempt count one without lockout", () => {
  assert.deepEqual(deriveOtpVerifyFailureResult(0, false, MAX_OTP_VERIFY_ATTEMPTS), {
    failedAttemptCount: 1,
    locked: false,
  });
});

test("attempts two through four remain active", () => {
  assert.deepEqual(deriveOtpVerifyFailureResult(1, false, MAX_OTP_VERIFY_ATTEMPTS), {
    failedAttemptCount: 2,
    locked: false,
  });
  assert.deepEqual(deriveOtpVerifyFailureResult(3, false, MAX_OTP_VERIFY_ATTEMPTS), {
    failedAttemptCount: 4,
    locked: false,
  });
});

test("fifth invalid attempt locks the challenge", () => {
  assert.deepEqual(deriveOtpVerifyFailureResult(4, false, MAX_OTP_VERIFY_ATTEMPTS), {
    failedAttemptCount: 5,
    locked: true,
  });
});

test("locked challenges stay locked until expiry", () => {
  const state = deriveOtpVerifyAttemptState({
    failedAttemptCount: 5,
    lockedAt: "2026-03-14T07:00:00.000Z",
    expiresAt: "2026-03-14T07:03:00.000Z",
  }, Date.parse("2026-03-14T07:01:00.000Z"));

  assert.deepEqual(state, {
    status: "locked",
    failedAttemptCount: 5,
    lockedAt: "2026-03-14T07:00:00.000Z",
    expiresAt: "2026-03-14T07:03:00.000Z",
  });
});

test("expired challenge state is treated as expired_or_missing", () => {
  const state = deriveOtpVerifyAttemptState({
    failedAttemptCount: 2,
    lockedAt: null,
    expiresAt: "2026-03-14T07:03:00.000Z",
  }, Date.parse("2026-03-14T07:03:00.000Z"));

  assert.deepEqual(state, { status: "expired_or_missing" });
});
