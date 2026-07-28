import assert from "node:assert/strict";
import test from "node:test";
import {
  FetchError,
  JwksValidationError,
  JwtExpiredError,
  JwtInvalidSignatureError,
  KidNotFoundInJwksError,
  WaitPeriodNotYetEndedJwkError,
} from "aws-jwt-verify/error";
import { Hono } from "hono";
import { type ContentfulStatusCode } from "hono/utils/http-status";
import {
  authVerificationTemporarilyUnavailableCode,
  authenticateRequestWithAbortSignalAndDependencies,
  createJwtAuthBoundaryError,
  isTerminalJwtAuthFailure,
  AuthError,
  type AuthenticatedUserIdentity,
} from "./index";
import { resetAuthConfigForTests } from "./config";
import { HttpError } from "../shared/errors";
import type { AppEnv } from "../server/app";
import { createSystemRoutes } from "../routes/system";

test("isTerminalJwtAuthFailure returns true for invalid client tokens", () => {
  assert.equal(isTerminalJwtAuthFailure(new JwtExpiredError("expired", "exp", "now")), true);
  assert.equal(isTerminalJwtAuthFailure(new JwtInvalidSignatureError("invalid signature")), true);
  assert.equal(isTerminalJwtAuthFailure(new KidNotFoundInJwksError("kid missing")), true);
});

test("isTerminalJwtAuthFailure returns false for JWKS fetch and validation failures", () => {
  assert.equal(isTerminalJwtAuthFailure(new FetchError("https://example.com/jwks", "network down")), false);
  assert.equal(isTerminalJwtAuthFailure(new JwksValidationError("jwks invalid")), false);
  assert.equal(isTerminalJwtAuthFailure(new WaitPeriodNotYetEndedJwkError("jwks wait period active")), false);
});

test("isTerminalJwtAuthFailure returns false for unknown errors", () => {
  assert.equal(isTerminalJwtAuthFailure(new Error("unexpected verifier failure")), false);
});

test("createJwtAuthBoundaryError returns retryable 503 for JWKS backoff", () => {
  const error = createJwtAuthBoundaryError(
    new WaitPeriodNotYetEndedJwkError("jwks wait period active"),
  );

  assert.ok(error instanceof HttpError);
  assert.equal(error.statusCode, 503);
  assert.equal(error.code, authVerificationTemporarilyUnavailableCode);
});

test("GET /me returns 500 when session verification fails with a non-terminal verifier error", async () => {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof AuthError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({
        error: error.message,
        requestId: context.get("requestId"),
        code: "AUTH_UNAUTHORIZED",
      });
    }

    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({
        error: error.message,
        requestId: context.get("requestId"),
        code: error.code,
      });
    }

    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId: context.get("requestId"),
      code: "INTERNAL_ERROR",
    });
  });
  app.route("/", createSystemRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => {
      throw new FetchError("https://example.com/jwks", "network down");
    },
  }));

  const response = await app.request("http://localhost/me");
  const payload = await response.json() as Readonly<{ code: string }>;

  assert.equal(response.status, 500);
  assert.equal(payload.code, "INTERNAL_ERROR");
});

test("signal-aware authentication aborts in-flight verification before identity mapping", async () => {
  const originalAuthMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = "cognito";
  resetAuthConfigForTests();
  const controller = new AbortController();
  const deadlineError = new HttpError(
    503,
    "Media image ingestion cannot safely finish within its request deadline.",
    "MEDIA_ASSET_INGESTION_DEADLINE_EXCEEDED",
    { retryAfterSeconds: 1 },
  );
  let rejectVerification:
  ((reason?: unknown) => void) | undefined;
  const verification = new Promise<AuthenticatedUserIdentity>(
    (_resolve, reject) => {
      rejectVerification = reject;
    },
  );
  let identityMappingCalls = 0;

  try {
    const authentication =
      authenticateRequestWithAbortSignalAndDependencies(
        {
          authorizationHeader: "Bearer pending-token",
          sessionToken: undefined,
        },
        controller.signal,
        {
          authenticateAgentApiKeyFn: async () => {
            throw new Error("Unexpected API-key authentication.");
          },
          authenticateGuestSessionFn: async () => {
            throw new Error("Unexpected guest authentication.");
          },
          loadCognitoIdentityMappingFn: async () => {
            identityMappingCalls += 1;
            return null;
          },
          verifyIdTokenFn: () => verification,
        },
      );

    controller.abort(deadlineError);
    await assert.rejects(authentication, (error: unknown) => {
      assert.equal(error, deadlineError);
      return true;
    });

    rejectVerification?.(new Error("Late verifier rejection."));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(identityMappingCalls, 0);
  } finally {
    if (originalAuthMode === undefined) {
      delete process.env.AUTH_MODE;
    } else {
      process.env.AUTH_MODE = originalAuthMode;
    }
    resetAuthConfigForTests();
  }
});
