import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { AccountPreferences } from "../../auth/ensureUser";
import {
  createDefaultAccountPreferences,
  createSystemTestApp,
} from "./systemTestSupport";

test("GET /me includes account preferences", async () => {
  const app = createSystemTestApp({
    transport: "session",
    getAccountPreferencesFn: createDefaultAccountPreferences,
  });
  const response = await app.request("http://localhost/me");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    userId: "user-1",
    selectedWorkspaceId: "workspace-1",
    authTransport: "session",
    csrfToken: null,
    profile: {
      email: "user@example.com",
      locale: "en",
      createdAt: "2026-04-01T00:00:00.000Z",
    },
    preferences: {
      reviewReactionAnimationsEnabled: true,
    },
  });
});

test("review reaction animation preference migration defaults existing rows to true", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0056_review_reaction_animation_preference.sql",
  );
  const migrationSql = readFileSync(migrationPath, "utf8");

  assert.match(migrationSql, /ALTER TABLE org\.user_settings/);
  assert.match(
    migrationSql,
    /ADD COLUMN review_reaction_animations_enabled BOOLEAN NOT NULL DEFAULT TRUE/,
  );
});

test("PATCH /me/preferences persists false and GET /me returns the updated preference", async () => {
  let persistedPreferences: AccountPreferences = createDefaultAccountPreferences();
  const app = createSystemTestApp({
    transport: "bearer",
    getAccountPreferencesFn: () => persistedPreferences,
    updateAccountPreferencesFn: async (userId, preferences) => {
      assert.equal(userId, "user-1");
      persistedPreferences = preferences;
      return persistedPreferences;
    },
  });

  const initialResponse = await app.request("http://localhost/me");
  assert.equal(initialResponse.status, 200);
  assert.deepEqual((await initialResponse.json() as Readonly<{ preferences: AccountPreferences }>).preferences, {
    reviewReactionAnimationsEnabled: true,
  });

  const patchResponse = await app.request("http://localhost/me/preferences", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reviewReactionAnimationsEnabled: false,
    }),
  });
  assert.equal(patchResponse.status, 200);
  assert.deepEqual(await patchResponse.json(), {
    preferences: {
      reviewReactionAnimationsEnabled: false,
    },
  });

  const updatedResponse = await app.request("http://localhost/me");
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual((await updatedResponse.json() as Readonly<{ preferences: AccountPreferences }>).preferences, {
    reviewReactionAnimationsEnabled: false,
  });
});

test("PATCH /me/preferences rejects session requests without valid CSRF", async () => {
  let updateCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    enforceSessionCsrf: true,
    updateAccountPreferencesFn: async (_userId, preferences) => {
      updateCalled = true;
      return preferences;
    },
  });
  const response = await app.request("http://localhost/me/preferences", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reviewReactionAnimationsEnabled: false,
    }),
  });

  assert.equal(updateCalled, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Invalid X-CSRF-Token header",
    requestId: "request-1",
    code: "SESSION_CSRF_TOKEN_INVALID",
  });
});

test("PATCH /me/preferences rejects ApiKey authentication", async () => {
  let updateCalled = false;
  const app = createSystemTestApp({
    transport: "api_key",
    updateAccountPreferencesFn: async (_userId, preferences) => {
      updateCalled = true;
      return preferences;
    },
  });
  const response = await app.request("http://localhost/me/preferences", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reviewReactionAnimationsEnabled: false,
    }),
  });

  assert.equal(updateCalled, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "This endpoint requires Guest, Bearer, or Session authentication",
    requestId: "request-1",
    code: "ACCOUNT_PREFERENCES_HUMAN_AUTH_REQUIRED",
  });
});
