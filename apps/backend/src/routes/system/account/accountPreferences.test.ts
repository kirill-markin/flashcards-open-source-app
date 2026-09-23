import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { AccountPreferences } from "../../../auth/ensureUser";
import type { GuestSessionAnalyticsPreferencesUpdate } from "../../../guestAuth/store/session";
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
      productAnalyticsEnabled: null,
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
        productAnalyticsEnabled: update.productAnalyticsEnabled
          ?? persistedPreferences.productAnalyticsEnabled,
      };
      return persistedPreferences;
    },
  });

  const initialResponse = await app.request("http://localhost/me");
  assert.equal(initialResponse.status, 200);
  assert.deepEqual((await initialResponse.json() as Readonly<{ preferences: AccountPreferences }>).preferences, {
    reviewReactionAnimationsEnabled: true,
    analyticsConsent: null,
    productAnalyticsEnabled: null,
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
      productAnalyticsEnabled: null,
    },
  });

  const updatedResponse = await app.request("http://localhost/me");
  assert.equal(updatedResponse.status, 200);
  assert.deepEqual((await updatedResponse.json() as Readonly<{ preferences: AccountPreferences }>).preferences, {
    reviewReactionAnimationsEnabled: false,
    analyticsConsent: null,
    productAnalyticsEnabled: null,
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

type RecordedGuestPreferencesWrite = Readonly<{
  guestUserId: string;
  guestSessionId: string;
  update: GuestSessionAnalyticsPreferencesUpdate;
}>;

test("PATCH /me/preferences from a guest stores the consent on the guest session, not on the account", async () => {
  const guestPreferencesWrites: Array<RecordedGuestPreferencesWrite> = [];
  const accountUpdates: Array<AccountPreferencesUpdate> = [];
  const app = createSystemTestApp({
    transport: "guest",
    updateAccountPreferencesFn: async (userId, update) => {
      assert.equal(userId, "user-1");
      accountUpdates.push(update);
      return {
        reviewReactionAnimationsEnabled: update.reviewReactionAnimationsEnabled ?? true,
        analyticsConsent: null,
        productAnalyticsEnabled: null,
      };
    },
    updateGuestSessionAnalyticsPreferencesFn: async (guestUserId, guestSessionId, update) => {
      guestPreferencesWrites.push({ guestUserId, guestSessionId, update });
      return update;
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
      productAnalyticsEnabled: null,
    },
  });
  // One call, carrying both columns, because the two guest writes share a transaction.
  assert.deepEqual(guestPreferencesWrites, [{
    guestUserId: "user-1",
    guestSessionId: "guest-session-1",
    update: {
      analyticsConsent: "declined",
      productAnalyticsEnabled: null,
    },
  }]);
  // The account write must never carry the consent value: a guest owns no account column for it.
  // The origins ride along and decide nothing while the value beside each of them is null.
  assert.deepEqual(accountUpdates, [{
    reviewReactionAnimationsEnabled: false,
    analyticsConsent: null,
    analyticsConsentOrigin: "user_action",
    productAnalyticsEnabled: null,
    productAnalyticsEnabledOrigin: "user_action",
  }]);
});

test("PATCH /me/preferences from a guest with only a consent leaves org.user_settings untouched", async () => {
  const guestPreferencesWrites: Array<RecordedGuestPreferencesWrite> = [];
  let accountUpdateCalled = false;
  const app = createSystemTestApp({
    transport: "guest",
    updateAccountPreferencesFn: async () => {
      accountUpdateCalled = true;
      return createDefaultAccountPreferences();
    },
    updateGuestSessionAnalyticsPreferencesFn: async (guestUserId, guestSessionId, update) => {
      guestPreferencesWrites.push({ guestUserId, guestSessionId, update });
      return update;
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
      productAnalyticsEnabled: null,
    },
  });
  assert.equal(guestPreferencesWrites.length, 1);
  assert.equal(accountUpdateCalled, false);
});
