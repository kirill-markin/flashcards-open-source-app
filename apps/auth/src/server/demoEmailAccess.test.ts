import assert from "node:assert/strict";
import test from "node:test";
import {
  getDemoEmailAccessConfig,
  getDemoEmailPassword,
  resetDemoEmailAccessConfigForTests,
} from "./demoEmailAccess.js";

const originalDemoEmailDostip = process.env.DEMO_EMAIL_DOSTIP;
const originalDemoPasswordDostip = process.env.DEMO_PASSWORD_DOSTIP;

function restoreDemoEmailAccessEnv(): void {
  if (originalDemoEmailDostip === undefined) {
    delete process.env.DEMO_EMAIL_DOSTIP;
  } else {
    process.env.DEMO_EMAIL_DOSTIP = originalDemoEmailDostip;
  }

  if (originalDemoPasswordDostip === undefined) {
    delete process.env.DEMO_PASSWORD_DOSTIP;
  } else {
    process.env.DEMO_PASSWORD_DOSTIP = originalDemoPasswordDostip;
  }

  resetDemoEmailAccessConfigForTests();
}

test.afterEach(() => {
  restoreDemoEmailAccessEnv();
});

test("demo email access normalizes the allowlist and returns the shared password", () => {
  process.env.DEMO_EMAIL_DOSTIP = " Apple-Review@example.com ,google-review@example.com ";
  process.env.DEMO_PASSWORD_DOSTIP = "shared-demo-password";

  const config = getDemoEmailAccessConfig();

  assert.equal(config.emailAllowlist.has("apple-review@example.com"), true);
  assert.equal(config.emailAllowlist.has("google-review@example.com"), true);
  assert.equal(getDemoEmailPassword(" Apple-Review@example.com "), "shared-demo-password");
  assert.equal(getDemoEmailPassword("missing@example.com"), null);
});

test("demo email access rejects non-example.com demo emails at startup", () => {
  process.env.DEMO_EMAIL_DOSTIP = "apple-review@real-domain.com";
  process.env.DEMO_PASSWORD_DOSTIP = "shared-demo-password";

  assert.throws(
    () => getDemoEmailAccessConfig(),
    /DEMO_EMAIL_DOSTIP only supports insecure review\/demo emails in @example\.com/,
  );
});

test("demo email access does not match non-allowlisted example.com emails", () => {
  process.env.DEMO_EMAIL_DOSTIP = "apple-review@example.com";
  process.env.DEMO_PASSWORD_DOSTIP = "shared-demo-password";

  assert.equal(getDemoEmailPassword("google-review@example.com"), null);
});

test("demo email access requires a shared password when the allowlist is configured", () => {
  process.env.DEMO_EMAIL_DOSTIP = "apple-review@example.com";
  delete process.env.DEMO_PASSWORD_DOSTIP;

  assert.throws(
    () => getDemoEmailAccessConfig(),
    /DEMO_PASSWORD_DOSTIP is required when DEMO_EMAIL_DOSTIP is configured/,
  );
});
