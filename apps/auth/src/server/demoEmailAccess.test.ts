import assert from "node:assert/strict";
import test from "node:test";
import {
  getDemoEmailAccessConfig,
  getDemoEmailPassword,
  resetDemoEmailAccessConfigForTests,
  setPlaintextSecretLoaderForTests,
} from "./demoEmailAccess.js";

const originalDemoEmailDostip = process.env.DEMO_EMAIL_DOSTIP;
const originalDemoPasswordDostip = process.env.DEMO_PASSWORD_DOSTIP;
const originalDemoPasswordSecretArn = process.env.DEMO_PASSWORD_SECRET_ARN;

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

  if (originalDemoPasswordSecretArn === undefined) {
    delete process.env.DEMO_PASSWORD_SECRET_ARN;
  } else {
    process.env.DEMO_PASSWORD_SECRET_ARN = originalDemoPasswordSecretArn;
  }

  resetDemoEmailAccessConfigForTests();
}

test.afterEach(() => {
  restoreDemoEmailAccessEnv();
});

test("demo email access normalizes the allowlist and returns the shared password", async () => {
  process.env.DEMO_EMAIL_DOSTIP = " Apple-For-Review@example.com ,google-for-review@example.com ";
  process.env.DEMO_PASSWORD_DOSTIP = "shared-demo-password";

  const config = getDemoEmailAccessConfig();

  assert.equal(config.emailAllowlist.has("apple-for-review@example.com"), true);
  assert.equal(config.emailAllowlist.has("google-for-review@example.com"), true);
  assert.equal(await getDemoEmailPassword(" Apple-For-Review@example.com "), "shared-demo-password");
  assert.equal(await getDemoEmailPassword("missing@example.com"), null);
});

test("demo email access rejects non-example.com demo emails at startup", () => {
  process.env.DEMO_EMAIL_DOSTIP = "apple-for-review@real-domain.com";
  process.env.DEMO_PASSWORD_DOSTIP = "shared-demo-password";

  assert.throws(
    () => getDemoEmailAccessConfig(),
    /DEMO_EMAIL_DOSTIP only supports insecure review\/demo emails in @example\.com/,
  );
});

test("demo email access does not match non-allowlisted example.com emails", async () => {
  process.env.DEMO_EMAIL_DOSTIP = "apple-for-review@example.com";
  process.env.DEMO_PASSWORD_DOSTIP = "shared-demo-password";

  assert.equal(await getDemoEmailPassword("google-for-review@example.com"), null);
});

test("demo email access loads the shared password from Secrets Manager when configured", async () => {
  process.env.DEMO_EMAIL_DOSTIP = "apple-for-review@example.com";
  process.env.DEMO_PASSWORD_SECRET_ARN = "arn:aws:secretsmanager:eu-central-1:123456789012:secret:demo";
  setPlaintextSecretLoaderForTests(async (secretArn: string) => {
    assert.equal(secretArn, "arn:aws:secretsmanager:eu-central-1:123456789012:secret:demo");
    return "shared-demo-password";
  });

  assert.equal(await getDemoEmailPassword("apple-for-review@example.com"), "shared-demo-password");
});

test("demo email access requires a shared password source when the allowlist is configured", () => {
  process.env.DEMO_EMAIL_DOSTIP = "apple-for-review@example.com";
  delete process.env.DEMO_PASSWORD_DOSTIP;
  delete process.env.DEMO_PASSWORD_SECRET_ARN;

  assert.throws(
    () => getDemoEmailAccessConfig(),
    /DEMO_PASSWORD_DOSTIP or DEMO_PASSWORD_SECRET_ARN is required when DEMO_EMAIL_DOSTIP is configured/,
  );
});

test("demo email access rejects configuring both a plaintext password and a password secret ARN", () => {
  process.env.DEMO_EMAIL_DOSTIP = "apple-for-review@example.com";
  process.env.DEMO_PASSWORD_DOSTIP = "shared-demo-password";
  process.env.DEMO_PASSWORD_SECRET_ARN = "arn:aws:secretsmanager:eu-central-1:123456789012:secret:demo";

  assert.throws(
    () => getDemoEmailAccessConfig(),
    /Configure only one of DEMO_PASSWORD_DOSTIP or DEMO_PASSWORD_SECRET_ARN/,
  );
});
