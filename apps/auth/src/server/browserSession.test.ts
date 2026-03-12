import assert from "node:assert/strict";
import test from "node:test";
import { extractVerifiedSessionIdentity } from "./browserSession.js";

test("extractVerifiedSessionIdentity returns userId and email", () => {
  assert.deepEqual(
    extractVerifiedSessionIdentity({
      sub: "user-123",
      email: "user@example.com",
    }),
    {
      userId: "user-123",
      email: "user@example.com",
    },
  );
});

test("extractVerifiedSessionIdentity rejects missing email claim", () => {
  assert.throws(
    () => extractVerifiedSessionIdentity({
      sub: "user-123",
    }),
    (error: unknown) => error instanceof Error
      && error.message === "Cognito ID token is missing email claim",
  );
});
