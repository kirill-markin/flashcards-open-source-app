import assert from "node:assert/strict";
import test from "node:test";
import { isConfiguredDemoEmail, resetDemoEmailAccessConfigForTests } from "./demoEmailAccess";

const originalDemoEmailDostip = process.env.DEMO_EMAIL_DOSTIP;

test.afterEach(() => {
  if (originalDemoEmailDostip === undefined) {
    delete process.env.DEMO_EMAIL_DOSTIP;
  } else {
    process.env.DEMO_EMAIL_DOSTIP = originalDemoEmailDostip;
  }

  resetDemoEmailAccessConfigForTests();
});

test("isConfiguredDemoEmail matches only configured allowlisted example.com demo emails", () => {
  process.env.DEMO_EMAIL_DOSTIP = " apple-review@example.com , google-review@example.com ";

  assert.equal(isConfiguredDemoEmail("apple-review@example.com"), true);
  assert.equal(isConfiguredDemoEmail("APPLE-REVIEW@example.com"), true);
  assert.equal(isConfiguredDemoEmail("other@example.com"), false);
  assert.equal(isConfiguredDemoEmail("apple-review@real-domain.com"), false);
  assert.equal(isConfiguredDemoEmail(null), false);
});

test("isConfiguredDemoEmail rejects non-example.com demo allowlist entries", () => {
  process.env.DEMO_EMAIL_DOSTIP = "apple-review@real-domain.com";

  assert.throws(
    () => isConfiguredDemoEmail("apple-review@real-domain.com"),
    /DEMO_EMAIL_DOSTIP only supports insecure review\/demo emails in @example\.com/,
  );
});
