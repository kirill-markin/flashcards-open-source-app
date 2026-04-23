import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../app";
import type { AuthResult } from "../auth";
import { AuthError } from "../auth";
import { HttpError } from "../errors";
import { createGuestAuthRoutes } from "./guestAuth";

type GuestAuthTestAppOptions = Readonly<{
  authResult: AuthResult;
  onDeleteGuestSession?: (guestToken: string) => Promise<void>;
}>;

function createGuestAuthTestApp(options: GuestAuthTestAppOptions): Hono<AppEnv> {
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
  app.route("/", createGuestAuthRoutes({
    authenticateRequestFn: async () => options.authResult,
    deleteGuestSessionFn: async (guestToken) => {
      await options.onDeleteGuestSession?.(guestToken);
    },
  }));
  return app;
}

function createAuthResult(transport: AuthResult["transport"]): AuthResult {
  return {
    userId: "guest-user",
    email: null,
    cognitoUsername: null,
    subjectUserId: "guest-user",
    transport,
    connectionId: null,
    selectedWorkspaceId: "guest-workspace",
  };
}

test("POST /guest-auth/session/delete deletes a guest session with Guest authentication", async () => {
  let deletedGuestToken: string | null = null;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("guest"),
    onDeleteGuestSession: async (guestToken) => {
      deletedGuestToken = guestToken;
    },
  });

  const response = await app.request("http://localhost/guest-auth/session/delete", {
    method: "POST",
    headers: {
      authorization: "Guest guest-token-delete-route",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(deletedGuestToken, "guest-token-delete-route");
  assert.deepEqual(await response.json(), { ok: true });
});

test("POST /guest-auth/session/delete rejects non-guest authentication", async () => {
  let deleted = false;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("bearer"),
    onDeleteGuestSession: async () => {
      deleted = true;
    },
  });

  const response = await app.request("http://localhost/guest-auth/session/delete", {
    method: "POST",
    headers: {
      authorization: "Bearer jwt-token",
    },
  });

  assert.equal(response.status, 403);
  assert.equal(deleted, false);
  assert.deepEqual(await response.json(), {
    error: "Delete guest session requires Guest authentication.",
    requestId: "request-1",
    code: "GUEST_SESSION_DELETE_GUEST_AUTH_REQUIRED",
  });
});

test("POST /guest-auth/session/delete returns 409 for a guest session already linked to an account", async () => {
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("guest"),
    onDeleteGuestSession: async () => {
      throw new HttpError(
        409,
        "Guest session is already linked to a signed-in account. Use /me/delete from that account instead.",
        "GUEST_SESSION_DELETE_LINKED_ACCOUNT",
      );
    },
  });

  const response = await app.request("http://localhost/guest-auth/session/delete", {
    method: "POST",
    headers: {
      authorization: "Guest guest-token-delete-route",
    },
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Guest session is already linked to a signed-in account. Use /me/delete from that account instead.",
    requestId: "request-1",
    code: "GUEST_SESSION_DELETE_LINKED_ACCOUNT",
  });
});
