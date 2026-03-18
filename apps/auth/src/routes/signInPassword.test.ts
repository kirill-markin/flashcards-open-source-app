import assert from "node:assert/strict";
import test from "node:test";
import { createSignInPasswordApp } from "./signInPassword.js";

function makeJsonRequest(body: Readonly<Record<string, string>>): Request {
  return new Request("http://localhost/api/sign-in-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCognitoError(message: string, cognitoType: string): Error & { cognitoType: string } {
  const error = new Error(message);
  (error as Error & { cognitoType: string }).cognitoType = cognitoType;
  return error as Error & { cognitoType: string };
}

test("password sign-in returns tokens and sets browser session cookies", async () => {
  let setCookieCalls = 0;
  const app = createSignInPasswordApp({
    signInWithPassword: async (email: string, password: string) => {
      assert.equal(email, "user@example.com");
      assert.equal(password, "reviewer-password");
      return {
        idToken: "id-token",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
      };
    },
    setBrowserSessionCookies: () => {
      setCookieCalls += 1;
    },
  });

  const response = await app.request(makeJsonRequest({
    email: "User@Example.com",
    password: "reviewer-password",
  }));
  const body = await response.json() as { ok: boolean; idToken: string; refreshToken: string; expiresIn: number };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.idToken, "id-token");
  assert.equal(body.refreshToken, "refresh-token");
  assert.equal(body.expiresIn, 3600);
  assert.equal(setCookieCalls, 1);
});

test("password sign-in rejects invalid email", async () => {
  const app = createSignInPasswordApp({
    signInWithPassword: async () => {
      throw new Error("signInWithPassword should not be called");
    },
    setBrowserSessionCookies: () => undefined,
  });

  const response = await app.request(makeJsonRequest({
    email: "not-an-email",
    password: "reviewer-password",
  }));
  const body = await response.json() as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_EMAIL");
});

test("password sign-in rejects empty password", async () => {
  const app = createSignInPasswordApp({
    signInWithPassword: async () => {
      throw new Error("signInWithPassword should not be called");
    },
    setBrowserSessionCookies: () => undefined,
  });

  const response = await app.request(makeJsonRequest({
    email: "user@example.com",
    password: "   ",
  }));
  const body = await response.json() as { code: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "PASSWORD_REQUIRED");
});

test("password sign-in returns one generic authentication failure for wrong credentials", async () => {
  const app = createSignInPasswordApp({
    signInWithPassword: async () => {
      throw makeCognitoError("Incorrect username or password.", "NotAuthorizedException");
    },
    setBrowserSessionCookies: () => undefined,
  });

  const response = await app.request(makeJsonRequest({
    email: "user@example.com",
    password: "wrong-password",
  }));
  const body = await response.json() as { code: string; error: string };

  assert.equal(response.status, 401);
  assert.equal(body.code, "PASSWORD_SIGN_IN_FAILED");
  assert.equal(body.error, "Email or password is incorrect.");
});

test("password sign-in does not auto-create unknown users", async () => {
  const app = createSignInPasswordApp({
    signInWithPassword: async () => {
      throw makeCognitoError("User does not exist.", "UserNotFoundException");
    },
    setBrowserSessionCookies: () => undefined,
  });

  const response = await app.request(makeJsonRequest({
    email: "missing@example.com",
    password: "reviewer-password",
  }));
  const body = await response.json() as { code: string; error: string };

  assert.equal(response.status, 401);
  assert.equal(body.code, "PASSWORD_SIGN_IN_FAILED");
  assert.equal(body.error, "Email or password is incorrect.");
});
