import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { AccountPreferences, AnalyticsConsentChoice } from "../../../auth/ensureUser";
import {
  createDefaultAccountPreferences,
  createSystemTestApp,
} from "../systemTestSupport";
import type { AccountPreferencesUpdate } from "../types";

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
      analyticsConsent: null,
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
    updateAccountPreferencesFn: async (userId, update) => {
      assert.equal(userId, "user-1");
      persistedPreferences = {
        reviewReactionAnimationsEnabled: update.reviewReactionAnimationsEnabled
          ?? persistedPreferences.reviewReactionAnimationsEnabled,
        analyticsConsent: update.analyticsConsent ?? persistedPreferences.analyticsConsent,
      };
      return persistedPreferences;
    },
  });

  const initialResponse = await app.request("http://localhost/me");
  assert.equal(initialResponse.status, 200);
  assert.deepEqual((await initialResponse.json() as Readonly<{ preferences: AccountPreferences }>).preferences, {
    reviewReactionAnimationsEnabled: true,
    analyticsConsent: null,
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
      analyticsConsent: null,
    },
  });

  const updatedResponse = await app.request("http://localhost/me");
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual((await updatedResponse.json() as Readonly<{ preferences: AccountPreferences }>).preferences, {
    reviewReactionAnimationsEnabled: false,
    analyticsConsent: null,
  });
});

test("PATCH /me/preferences rejects session requests without valid CSRF", async () => {
  let updateCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    enforceSessionCsrf: true,
    updateAccountPreferencesFn: async () => {
      updateCalled = true;
      return createDefaultAccountPreferences();
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
    updateAccountPreferencesFn: async () => {
      updateCalled = true;
      return createDefaultAccountPreferences();
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

type RecordedGuestConsentWrite = Readonly<{
  guestUserId: string;
  guestSessionId: string;
  analyticsConsent: AnalyticsConsentChoice;
}>;

test("PATCH /me/preferences from a guest stores the consent on the guest session, not on the account", async () => {
  const guestConsentWrites: Array<RecordedGuestConsentWrite> = [];
  const accountUpdates: Array<AccountPreferencesUpdate> = [];
  const app = createSystemTestApp({
    transport: "guest",
    updateAccountPreferencesFn: async (userId, update) => {
      assert.equal(userId, "user-1");
      accountUpdates.push(update);
      return {
        reviewReactionAnimationsEnabled: update.reviewReactionAnimationsEnabled ?? true,
        analyticsConsent: null,
      };
    },
    updateGuestSessionAnalyticsConsentFn: async (guestUserId, guestSessionId, analyticsConsent) => {
      guestConsentWrites.push({ guestUserId, guestSessionId, analyticsConsent });
      return analyticsConsent;
    },
  });

  const response = await app.request("http://localhost/me/preferences", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reviewReactionAnimationsEnabled: false,
      analyticsConsent: "declined",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    preferences: {
      reviewReactionAnimationsEnabled: false,
      analyticsConsent: "declined",
    },
  });
  assert.deepEqual(guestConsentWrites, [{
    guestUserId: "user-1",
    guestSessionId: "guest-session-1",
    analyticsConsent: "declined",
  }]);
  // The account write must never carry the consent value: a guest owns no account column for it.
  assert.deepEqual(accountUpdates, [{
    reviewReactionAnimationsEnabled: false,
    analyticsConsent: null,
  }]);
});

test("PATCH /me/preferences from a guest with only a consent leaves org.user_settings untouched", async () => {
  const guestConsentWrites: Array<RecordedGuestConsentWrite> = [];
  let accountUpdateCalled = false;
  const app = createSystemTestApp({
    transport: "guest",
    updateAccountPreferencesFn: async () => {
      accountUpdateCalled = true;
      return createDefaultAccountPreferences();
    },
    updateGuestSessionAnalyticsConsentFn: async (guestUserId, guestSessionId, analyticsConsent) => {
      guestConsentWrites.push({ guestUserId, guestSessionId, analyticsConsent });
      return analyticsConsent;
    },
  });

  const response = await app.request("http://localhost/me/preferences", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      analyticsConsent: "declined",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    preferences: {
      reviewReactionAnimationsEnabled: true,
      analyticsConsent: "declined",
    },
  });
  assert.equal(guestConsentWrites.length, 1);
  assert.equal(accountUpdateCalled, false);
});
