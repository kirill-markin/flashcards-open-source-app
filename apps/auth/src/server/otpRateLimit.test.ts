import assert from "node:assert/strict";
import test from "node:test";
import { decideOtpRateLimitFromCounts } from "./otpRateLimit.js";

type CountOverrides = Readonly<{
  emailCooldownCount?: number;
  emailShortCount?: number;
  emailDayCount?: number;
  ipShortCount?: number;
  ipHourCount?: number;
  ipDayCount?: number;
  ipDistinctHourCount?: number;
  ipDistinctDayCount?: number;
}>;

type OtpRateLimitCounts = Readonly<{
  emailCooldownCount: number;
  emailShortCount: number;
  emailDayCount: number;
  ipShortCount: number;
  ipHourCount: number;
  ipDayCount: number;
  ipDistinctHourCount: number;
  ipDistinctDayCount: number;
}>;

function createCounts(
  overrides: CountOverrides,
): OtpRateLimitCounts {
  return {
    emailCooldownCount: overrides.emailCooldownCount ?? 0,
    emailShortCount: overrides.emailShortCount ?? 0,
    emailDayCount: overrides.emailDayCount ?? 0,
    ipShortCount: overrides.ipShortCount ?? 0,
    ipHourCount: overrides.ipHourCount ?? 0,
    ipDayCount: overrides.ipDayCount ?? 0,
    ipDistinctHourCount: overrides.ipDistinctHourCount ?? 0,
    ipDistinctDayCount: overrides.ipDistinctDayCount ?? 0,
  };
}

test("email limiter still allows the third OTP send within one minute", () => {
  const decision = decideOtpRateLimitFromCounts(createCounts({
    emailCooldownCount: 2,
    emailShortCount: 2,
  }));

  assert.deepEqual(decision, { kind: "send" });
});

test("email limiter suppresses the fourth OTP send within one minute", () => {
  const decision = decideOtpRateLimitFromCounts(createCounts({
    emailCooldownCount: 3,
  }));

  assert.deepEqual(decision, { kind: "suppress_email_limit" });
});

test("email limiter still allows the fifth OTP send within fifteen minutes", () => {
  const decision = decideOtpRateLimitFromCounts(createCounts({
    emailShortCount: 4,
  }));

  assert.deepEqual(decision, { kind: "send" });
});

test("email limiter suppresses the sixth OTP send within fifteen minutes", () => {
  const decision = decideOtpRateLimitFromCounts(createCounts({
    emailShortCount: 5,
  }));

  assert.deepEqual(decision, { kind: "suppress_email_limit" });
});

test("email suppression stays active when IP sent quota is still below threshold", () => {
  const decision = decideOtpRateLimitFromCounts(createCounts({
    emailShortCount: 5,
    ipShortCount: 9,
  }));

  assert.deepEqual(decision, { kind: "suppress_email_limit" });
});

test("ip limiter blocks only when sent quota reaches threshold", () => {
  const decision = decideOtpRateLimitFromCounts(createCounts({
    emailShortCount: 5,
    ipShortCount: 10,
  }));

  assert.deepEqual(decision, { kind: "block_ip_limit" });
});
