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
  createJwtAuthBoundaryError,
  isTerminalJwtAuthFailure,
  AuthError,
} from "./index";
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
