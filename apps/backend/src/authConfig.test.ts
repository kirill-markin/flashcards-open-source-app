import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getAuthConfig, resetAuthConfigForTests } from "./authConfig";

const originalAuthMode = process.env.AUTH_MODE;
const originalAllowInsecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH;

function restoreAuthEnv(): void {
  if (originalAuthMode === undefined) {
    delete process.env.AUTH_MODE;
  } else {
    process.env.AUTH_MODE = originalAuthMode;
  }

  if (originalAllowInsecureLocalAuth === undefined) {
    delete process.env.ALLOW_INSECURE_LOCAL_AUTH;
  } else {
    process.env.ALLOW_INSECURE_LOCAL_AUTH = originalAllowInsecureLocalAuth;
  }

  resetAuthConfigForTests();
}

afterEach(restoreAuthEnv);

test("getAuthConfig rejects missing AUTH_MODE", () => {
  delete process.env.AUTH_MODE;
  delete process.env.ALLOW_INSECURE_LOCAL_AUTH;

  assert.throws(
    () => getAuthConfig(),
    (error: unknown) => error instanceof Error
      && error.message === 'AUTH_MODE is required and must be set to "cognito" or "none"',
  );
});

test("getAuthConfig rejects unknown AUTH_MODE", () => {
  process.env.AUTH_MODE = "invalid";
  delete process.env.ALLOW_INSECURE_LOCAL_AUTH;

  assert.throws(
    () => getAuthConfig(),
    (error: unknown) => error instanceof Error
      && error.message === 'AUTH_MODE must be set to "cognito" or "none", got "invalid"',
  );
});

test("getAuthConfig rejects insecure local auth without explicit opt-in", () => {
  process.env.AUTH_MODE = "none";
  delete process.env.ALLOW_INSECURE_LOCAL_AUTH;

  assert.throws(
    () => getAuthConfig(),
    (error: unknown) => error instanceof Error
      && error.message === 'AUTH_MODE="none" requires ALLOW_INSECURE_LOCAL_AUTH=true and must be used only for local development',
  );
});

test("getAuthConfig accepts explicitly gated insecure local auth", () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";

  assert.deepEqual(getAuthConfig(), { mode: "none" });
});

test("getAuthConfig accepts cognito mode without requiring the local auth opt-in", () => {
  process.env.AUTH_MODE = "cognito";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "false";

  assert.deepEqual(getAuthConfig(), { mode: "cognito" });
});
