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
  onCreateGuestSession?: (platform: GuestSessionPlatform | null) => Promise<GuestSessionSnapshot>;
  onDeleteGuestSession?: (guestToken: string) => Promise<void>;
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
    createGuestSessionFn: async (platform) => {
      if (options.onCreateGuestSession !== undefined) {
        return options.onCreateGuestSession(platform);
      }

      return createGuestSessionSnapshot(platform);
    },
    completeGuestUpgradeFn: options.onCompleteGuestUpgrade,
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

test("POST /guest-auth/session rejects web guest sessions", async () => {
  let createCalls = 0;
  const app = createGuestAuthTestApp({
    authResult: createAuthResult("none"),
    onCreateGuestSession: async (platform) => {
      createCalls += 1;
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

  assert.equal(response.status, 403);
  assert.equal(createCalls, 0);
  assert.deepEqual(await response.json(), {
    error: "Guest web sessions are not supported. Sign in before using cloud sync on the web app.",
    requestId: "request-1",
    code: "GUEST_WEB_SESSION_UNSUPPORTED",
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
