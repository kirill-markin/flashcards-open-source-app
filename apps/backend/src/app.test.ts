import assert from "node:assert/strict";
import test from "node:test";
import {
  createApp,
  createAgentInstructions,
  getHttpErrorResponseHeaders,
} from "./app";
import { resetAuthConfigForTests } from "./authConfig";
import { HttpError } from "./errors";
import { resetGuestAiQuotaConfigForTests } from "./guestAiQuotaConfig";

const originalAuthMode = process.env.AUTH_MODE;
const originalAllowInsecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH;

function restoreBackendAppTestEnvironment(): void {
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
}

test.afterEach(() => {
  restoreBackendAppTestEnvironment();
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();
});

test("getHttpErrorResponseHeaders adds Retry-After for service unavailable", () => {
  assert.deepEqual(
    getHttpErrorResponseHeaders(
      new HttpError(
        503,
        "Service is temporarily unavailable. Retry shortly.",
        "SERVICE_UNAVAILABLE",
      ),
    ),
    [["Retry-After", "1"]],
  );
});

test("createAgentInstructions tells API-key agents to honor Retry-After on service unavailable", () => {
  assert.equal(
    createAgentInstructions("SERVICE_UNAVAILABLE", 503),
    "Retry the same request after the Retry-After delay. If it fails again, treat it as a server-side error and stop changing the request. Use requestId when debugging.",
  );
});

test("createAgentInstructions tells API-key agents to verify unknown commit outcomes before retrying", () => {
  assert.equal(
    createAgentInstructions("DATABASE_COMMIT_OUTCOME_UNKNOWN", 500),
    "Do not blindly replay the same request. Reload and check the current state first, then retry only if the requested change is confirmed absent. Use requestId when debugging.",
  );
});

test("app error handler returns Retry-After for service unavailable responses", async () => {
  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  const app = createApp("/v1");
  app.get("/transient-database-error", () => {
    throw new HttpError(
      503,
      "Service is temporarily unavailable. Retry shortly.",
      "SERVICE_UNAVAILABLE",
    );
  });

  const response = await app.request("http://localhost/v1/transient-database-error");
  const payload = await response.json() as Readonly<{
    error: string;
    code: string | null;
    requestId: string;
  }>;

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(payload.error, "Service is temporarily unavailable. Retry shortly.");
  assert.equal(payload.code, "SERVICE_UNAVAILABLE");
  assert.notEqual(payload.requestId, "");
});
