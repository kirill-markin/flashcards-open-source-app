import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../server/app";
import type { AuthResult } from "../auth";
import { AuthError } from "../auth";
import { HttpError } from "../shared/errors";
import type {
  GuestSessionPlatform,
  GuestSessionSnapshot,
  GuestUpgradeCompleteCapabilities,
  GuestUpgradeCompletion,
  GuestUpgradeSelection,
} from "../guestAuth";
import { createGuestAuthRoutes } from "./guestAuth";

type GuestAuthTestAppOptions = Readonly<{
  authResult: AuthResult;
  onCompleteGuestUpgrade?: (
    guestToken: string,
    subjectUserId: string,
    selection: GuestUpgradeSelection,
    capabilities: GuestUpgradeCompleteCapabilities,
  ) => Promise<GuestUpgradeCompletion>;
  onCreateGuestSession?: (
    platform: GuestSessionPlatform | null,
    idempotencyKey: string | null,
  ) => Promise<GuestSessionSnapshot>;
  onDeleteGuestSession?: (guestToken: string) => Promise<void>;
  onLinkGuestAnalyticsIdentity?: (
    guestToken: string,
    cognitoSubject: string,
  ) => Promise<void>;
}>;

function createGuestSessionSnapshot(platform: GuestSessionPlatform | null): GuestSessionSnapshot {
  return {
    guestToken: "guest-token-create-route",
    userId: "guest-user-create-route",
    workspaceId: "guest-workspace-create-route",
    platform,
  };
}

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
    createGuestSessionFn: async (platform, idempotencyKey) => {
      if (options.onCreateGuestSession !== undefined) {
        return options.onCreateGuestSession(platform, idempotencyKey);
      }

      return createGuestSessionSnapshot(platform);
    },
    completeGuestUpgradeFn: options.onCompleteGuestUpgrade,
    deleteGuestSessionFn: async (guestToken) => {
      await options.onDeleteGuestSession?.(guestToken);
    },
    linkGuestAnalyticsIdentityFn: async (guestToken, cognitoSubject) => {
      await options.onLinkGuestAnalyticsIdentity?.(guestToken, cognitoSubject);
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
    guestSessionId: transport === "guest" ? "guest-session-1" : null,
    guestPlatform: transport === "guest" ? "ios" : null,
  };
}

test("POST /guest-auth/session keeps empty-body legacy session creation unbound", async () => {
  let receivedPlatform: GuestSessionPlatform | null | undefined;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("none"),
    onCreateGuestSession: async (platform) => {
      receivedPlatform = platform;
      return createGuestSessionSnapshot(platform);
    },
  });

  const response = await app.request("http://localhost/guest-auth/session", {
    method: "POST",
  });

  assert.equal(response.status, 200);
  assert.equal(receivedPlatform, null);
  assert.deepEqual(await response.json(), {
    guestToken: "guest-token-create-route",
    userId: "guest-user-create-route",
    workspaceId: "guest-workspace-create-route",
  });
});

test("POST /guest-auth/session creates a platform-bound native guest session", async () => {
  let receivedPlatform: GuestSessionPlatform | null | undefined;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("none"),
    onCreateGuestSession: async (platform) => {
      receivedPlatform = platform;
      return createGuestSessionSnapshot(platform);
    },
  });

  const response = await app.request("http://localhost/guest-auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform: "ios" }),
  });

  assert.equal(response.status, 200);
  assert.equal(receivedPlatform, "ios");
  assert.deepEqual(await response.json(), {
    guestToken: "guest-token-create-route",
    userId: "guest-user-create-route",
    workspaceId: "guest-workspace-create-route",
  });
});

test("POST /guest-auth/session creates a platform-bound web guest session", async () => {
  let receivedPlatform: GuestSessionPlatform | null | undefined;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("none"),
    onCreateGuestSession: async (platform) => {
      receivedPlatform = platform;
      return createGuestSessionSnapshot(platform);
    },
  });

  const response = await app.request("http://localhost/guest-auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform: "web" }),
  });

  assert.equal(response.status, 200);
  assert.equal(receivedPlatform, "web");
  assert.deepEqual(await response.json(), {
    guestToken: "guest-token-create-route",
    userId: "guest-user-create-route",
    workspaceId: "guest-workspace-create-route",
  });
});

const guestSessionIdempotencyKeyForTest = "b3f1c0d2e4a5968778695a4e3c2d1b0af9e8d7c6b5a4938271605f4e3d2c1b0a";

test("POST /guest-auth/session forwards an idempotency key and defaults it to absent", async () => {
  const receivedKeys: Array<string | null> = [];
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("none"),
    onCreateGuestSession: async (platform, idempotencyKey) => {
      receivedKeys.push(idempotencyKey);
      return createGuestSessionSnapshot(platform);
    },
  });

  const keyedResponse = await app.request("http://localhost/guest-auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform: "web", idempotencyKey: guestSessionIdempotencyKeyForTest }),
  });
  const unkeyedResponse = await app.request("http://localhost/guest-auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform: "web" }),
  });
  // Serializers that encode an unset optional field rather than omitting it send an explicit null on
  // every no-key call, so that has to mean absent too instead of failing the shape check.
  const nullKeyResponse = await app.request("http://localhost/guest-auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform: "web", idempotencyKey: null }),
  });

  assert.equal(keyedResponse.status, 200);
  assert.equal(unkeyedResponse.status, 200);
  assert.equal(nullKeyResponse.status, 200);
  assert.deepEqual(receivedKeys, [guestSessionIdempotencyKeyForTest, null, null]);
});

// The key is a bearer credential for the guest identity it names, so the obviously non-random shapes
// a client might reach for are refused at the boundary rather than stored. The check is only that
// floor: a hex-normalised install id would pass it, which is why per-attempt randomness stays a
// client obligation in docs/auth-service.md.
test("POST /guest-auth/session rejects an idempotency key that is not a random token", async () => {
  let created = false;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("none"),
    onCreateGuestSession: async (platform) => {
      created = true;
      return createGuestSessionSnapshot(platform);
    },
  });

  const rejectedKeys = [
    // A label, a canonical install id, too little entropy, and an over-long value.
    "creation-attempt-1",
    "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
    "b3f1c0d2e4a59687",
    "f".repeat(201),
  ];
  const responses = await Promise.all(rejectedKeys.map(async (idempotencyKey) => app.request(
    "http://localhost/guest-auth/session",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ platform: "web", idempotencyKey }),
    },
  )));

  for (const response of responses) {
    assert.equal(response.status, 400);
  }
  assert.equal(created, false);
  assert.deepEqual(await responses[0].json(), {
    error: "idempotencyKey must be 32 to 200 lowercase hexadecimal characters generated randomly for one creation attempt",
    requestId: "request-1",
    code: "GUEST_SESSION_IDEMPOTENCY_KEY_INVALID",
  });
});

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

test("POST /guest-auth/identity/link links the guest identity to the signed-in account", async () => {
  let receivedLink: Readonly<{
    guestToken: string;
    cognitoSubject: string;
  }> | null = null;
  const app = createGuestAuthTestApp({
    authResult: {
      ...createAuthResult("bearer"),
      userId: "account-user",
      subjectUserId: "account-subject",
    },
    onLinkGuestAnalyticsIdentity: async (guestToken, cognitoSubject) => {
      receivedLink = { guestToken, cognitoSubject };
    },
  });

  const response = await app.request("http://localhost/guest-auth/identity/link", {
    method: "POST",
    headers: {
      authorization: "Bearer jwt-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ guestToken: "guest-token-identity-link" }),
  });

  assert.equal(response.status, 200);
  // The route passes the Cognito subject and nothing else: the account user id is resolved inside
  // the writer's transaction, under the identity lifecycle lock.
  assert.deepEqual(receivedLink, {
    guestToken: "guest-token-identity-link",
    cognitoSubject: "account-subject",
  });
  assert.deepEqual(await response.json(), { ok: true });
});

test("POST /guest-auth/identity/link rejects guest authentication", async () => {
  let linked = false;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("guest"),
    onLinkGuestAnalyticsIdentity: async () => {
      linked = true;
    },
  });

  const response = await app.request("http://localhost/guest-auth/identity/link", {
    method: "POST",
    headers: {
      authorization: "Guest guest-token-identity-link",
      "content-type": "application/json",
    },
    body: JSON.stringify({ guestToken: "guest-token-identity-link" }),
  });

  assert.equal(response.status, 403);
  assert.equal(linked, false);
  assert.deepEqual(await response.json(), {
    error: "Sign in before linking this guest identity.",
    requestId: "request-1",
    code: "GUEST_IDENTITY_LINK_HUMAN_AUTH_REQUIRED",
  });
});

test("POST /guest-auth/identity/link reports a guest that owns data the upgrade transfers", async () => {
  const app = createGuestAuthTestApp({
    authResult: { ...createAuthResult("bearer"), userId: "account-user" },
    onLinkGuestAnalyticsIdentity: async () => {
      throw new HttpError(
        409,
        "This guest session owns data that the upgrade transfers and cannot be linked for analytics only. Convert it through /guest-auth/upgrade/complete instead.",
        "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED",
      );
    },
  });

  const response = await app.request("http://localhost/guest-auth/identity/link", {
    method: "POST",
    headers: {
      authorization: "Bearer jwt-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ guestToken: "guest-token-identity-link" }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "This guest session owns data that the upgrade transfers and cannot be linked for analytics only. Convert it through /guest-auth/upgrade/complete instead.",
    requestId: "request-1",
    code: "GUEST_IDENTITY_LINK_UPGRADE_REQUIRED",
  });
});

test("POST /guest-auth/upgrade/complete returns droppedEntities when merge drops guest rows", async () => {
  let receivedSelection: GuestUpgradeSelection | null = null;
  let receivedCapabilities: GuestUpgradeCompleteCapabilities | null = null;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("bearer"),
    onCompleteGuestUpgrade: async (_guestToken, subjectUserId, selection, capabilities) => {
      receivedSelection = selection;
      receivedCapabilities = capabilities;
      return {
        workspace: {
          workspaceId: "target-workspace",
          name: "Target workspace",
          createdAt: "2026-04-02T13:00:00.000Z",
          isSelected: true,
        },
        outcome: "fresh_completion",
        guestSessionId: "guest-session-upgrade-complete",
        guestUserId: "guest-user",
        targetSubjectUserId: subjectUserId,
        targetUserId: "linked-user",
        targetWorkspaceId: "target-workspace",
        droppedEntities: {
          cardIds: ["card-drop-1"],
          deckIds: ["deck-drop-1"],
          reviewEventIds: ["review-drop-1", "review-drop-2"],
        },
      };
    },
  });

  const response = await app.request("http://localhost/guest-auth/upgrade/complete", {
    method: "POST",
    headers: {
      authorization: "Bearer jwt-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      guestToken: "guest-token-upgrade-complete",
      selection: {
        type: "existing",
        workspaceId: "target-workspace",
      },
      guestWorkspaceSyncedAndOutboxDrained: true,
      supportsDroppedEntities: true,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(receivedSelection, {
    type: "existing",
    workspaceId: "target-workspace",
  });
  assert.deepEqual(receivedCapabilities, {
    guestWorkspaceSyncedAndOutboxDrained: true,
    requiresGuestWorkspaceSyncedAndOutboxDrained: true,
    supportsDroppedEntities: true,
  });
  assert.deepEqual(await response.json(), {
    workspace: {
      workspaceId: "target-workspace",
      name: "Target workspace",
      createdAt: "2026-04-02T13:00:00.000Z",
      isSelected: true,
    },
    droppedEntities: {
      cardIds: ["card-drop-1"],
      deckIds: ["deck-drop-1"],
      reviewEventIds: ["review-drop-1", "review-drop-2"],
    },
  });
});

test("POST /guest-auth/upgrade/complete allows omitted droppedEntities support after guest drain assertion", async () => {
  let receivedCapabilities: GuestUpgradeCompleteCapabilities | null = null;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("bearer"),
    onCompleteGuestUpgrade: async (_guestToken, subjectUserId, _selection, capabilities) => {
      receivedCapabilities = capabilities;
      return {
        workspace: {
          workspaceId: "target-workspace",
          name: "Target workspace",
          createdAt: "2026-04-02T13:00:00.000Z",
          isSelected: true,
        },
        outcome: "fresh_completion",
        guestSessionId: "guest-session-upgrade-complete",
        guestUserId: "guest-user",
        targetSubjectUserId: subjectUserId,
        targetUserId: "linked-user",
        targetWorkspaceId: "target-workspace",
      };
    },
  });

  const response = await app.request("http://localhost/guest-auth/upgrade/complete", {
    method: "POST",
    headers: {
      authorization: "Bearer jwt-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      guestToken: "guest-token-upgrade-complete",
      selection: {
        type: "existing",
        workspaceId: "target-workspace",
      },
      guestWorkspaceSyncedAndOutboxDrained: true,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(receivedCapabilities, {
    guestWorkspaceSyncedAndOutboxDrained: true,
    requiresGuestWorkspaceSyncedAndOutboxDrained: true,
    supportsDroppedEntities: false,
  });
  assert.deepEqual(await response.json(), {
    workspace: {
      workspaceId: "target-workspace",
      name: "Target workspace",
      createdAt: "2026-04-02T13:00:00.000Z",
      isSelected: true,
    },
  });
});

test("POST /guest-auth/upgrade/complete preserves legacy clients that omit new capability fields", async () => {
  let receivedCapabilities: GuestUpgradeCompleteCapabilities | null = null;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("bearer"),
    onCompleteGuestUpgrade: async (_guestToken, subjectUserId, _selection, capabilities) => {
      receivedCapabilities = capabilities;
      return {
        workspace: {
          workspaceId: "target-workspace",
          name: "Target workspace",
          createdAt: "2026-04-02T13:00:00.000Z",
          isSelected: true,
        },
        outcome: "fresh_completion",
        guestSessionId: "guest-session-upgrade-complete",
        guestUserId: "guest-user",
        targetSubjectUserId: subjectUserId,
        targetUserId: "linked-user",
        targetWorkspaceId: "target-workspace",
      };
    },
  });

  const response = await app.request("http://localhost/guest-auth/upgrade/complete", {
    method: "POST",
    headers: {
      authorization: "Bearer jwt-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      guestToken: "guest-token-upgrade-complete",
      selection: {
        type: "existing",
        workspaceId: "target-workspace",
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(receivedCapabilities, {
    guestWorkspaceSyncedAndOutboxDrained: false,
    requiresGuestWorkspaceSyncedAndOutboxDrained: false,
    supportsDroppedEntities: false,
  });
  assert.deepEqual(await response.json(), {
    workspace: {
      workspaceId: "target-workspace",
      name: "Target workspace",
      createdAt: "2026-04-02T13:00:00.000Z",
      isSelected: true,
    },
  });
});

test("POST /guest-auth/upgrade/complete reports typed drain rejection for stale clients", async () => {
  let receivedCapabilities: GuestUpgradeCompleteCapabilities | null = null;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("bearer"),
    onCompleteGuestUpgrade: async (_guestToken, _subjectUserId, _selection, capabilities) => {
      receivedCapabilities = capabilities;
      throw new HttpError(
        409,
        "Guest upgrade merge requires the current guest workspace to be fully synced and the local guest outbox to be empty. Sync the guest workspace, wait until the guest outbox is empty, then retry /guest-auth/upgrade/complete with guestWorkspaceSyncedAndOutboxDrained: true.",
        "GUEST_UPGRADE_GUEST_SYNC_NOT_DRAINED",
      );
    },
  });

  const response = await app.request("http://localhost/guest-auth/upgrade/complete", {
    method: "POST",
    headers: {
      authorization: "Bearer jwt-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      guestToken: "guest-token-upgrade-complete",
      selection: {
        type: "existing",
        workspaceId: "target-workspace",
      },
      supportsDroppedEntities: true,
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(receivedCapabilities, {
    guestWorkspaceSyncedAndOutboxDrained: false,
    requiresGuestWorkspaceSyncedAndOutboxDrained: true,
    supportsDroppedEntities: true,
  });
  assert.deepEqual(await response.json(), {
    error: "Guest upgrade merge requires the current guest workspace to be fully synced and the local guest outbox to be empty. Sync the guest workspace, wait until the guest outbox is empty, then retry /guest-auth/upgrade/complete with guestWorkspaceSyncedAndOutboxDrained: true.",
    requestId: "request-1",
    code: "GUEST_UPGRADE_GUEST_SYNC_NOT_DRAINED",
  });
});
