import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicProfile,
  createSystemTestApp,
} from "./systemTestSupport";

test("GET /me/community/profile ensures a public profile without returning internal ids", async () => {
  let ensureCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    locale: "zh-CN",
    ensurePublicProfileForUserFn: async (userId, localeHint) => {
      ensureCalled = true;
      assert.equal(userId, "user-1");
      assert.equal(localeHint, "zh-CN");
      return createPublicProfile(true);
    },
  });
  const response = await app.request("http://localhost/me/community/profile");
  const payload = await response.json() as Readonly<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(ensureCalled, true);
  assert.deepEqual(payload, {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: true,
    linkedAccountRequiredForLeaderboard: false,
  });
  assert.equal(Object.hasOwn(payload, "userId"), false);
  assert.equal(Object.hasOwn(payload, "workspaceId"), false);
  assert.equal(Object.hasOwn(payload, "replicaId"), false);
  assert.equal(Object.hasOwn(payload, "subjectUserId"), false);
  assert.equal(Object.hasOwn(payload, "email"), false);
});

test("PATCH /me/community/profile updates only leaderboard participation", async () => {
  let persistedProfile = createPublicProfile(true);
  const app = createSystemTestApp({
    transport: "bearer",
    locale: "es-MX",
    ensurePublicProfileForUserFn: async () => persistedProfile,
    updateLeaderboardParticipationFn: async (userId, leaderboardParticipationEnabled, localeHint) => {
      assert.equal(userId, "user-1");
      assert.equal(localeHint, "es-MX");
      persistedProfile = {
        ...persistedProfile,
        leaderboardParticipationEnabled,
      };
      return persistedProfile;
    },
  });

  const response = await app.request("http://localhost/me/community/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      leaderboardParticipationEnabled: false,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: false,
    linkedAccountRequiredForLeaderboard: false,
  });

  const readResponse = await app.request("http://localhost/me/community/profile");
  assert.equal(readResponse.status, 200);
  assert.deepEqual(await readResponse.json(), {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: false,
    linkedAccountRequiredForLeaderboard: false,
  });
});

test("PATCH /me/community/profile lets guest accounts manage leaderboard participation", async () => {
  let persistedProfile = createPublicProfile(true);
  const app = createSystemTestApp({
    transport: "guest",
    locale: "ru",
    updateLeaderboardParticipationFn: async (userId, leaderboardParticipationEnabled, localeHint) => {
      assert.equal(userId, "user-1");
      assert.equal(localeHint, "ru");
      persistedProfile = {
        ...persistedProfile,
        leaderboardParticipationEnabled,
      };
      return persistedProfile;
    },
  });

  const response = await app.request("http://localhost/me/community/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      leaderboardParticipationEnabled: false,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: false,
    linkedAccountRequiredForLeaderboard: true,
  });
});

test("PATCH /me/community/profile rejects attempts to update public identity fields", async () => {
  let updateCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    updateLeaderboardParticipationFn: async (_userId, leaderboardParticipationEnabled) => {
      updateCalled = true;
      return createPublicProfile(leaderboardParticipationEnabled);
    },
  });

  const response = await app.request("http://localhost/me/community/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      leaderboardParticipationEnabled: false,
      anonymousDisplayName: "Changed Name",
    }),
  });

  assert.equal(updateCalled, false);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Unexpected community profile field: anonymousDisplayName",
    requestId: "request-1",
    code: "COMMUNITY_PROFILE_FIELD_UNKNOWN",
  });
});

test("community profile endpoints reject ApiKey authentication", async () => {
  const cases = [
    {
      url: "http://localhost/me/community/profile",
      init: undefined,
    },
    {
      url: "http://localhost/me/community/profile",
      init: {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leaderboardParticipationEnabled: false,
        }),
      },
    },
  ] as const;

  for (const testCase of cases) {
    let serviceCalled = false;
    const app = createSystemTestApp({
      transport: "api_key",
      ensurePublicProfileForUserFn: async () => {
        serviceCalled = true;
        return createPublicProfile(true);
      },
      updateLeaderboardParticipationFn: async (_userId, leaderboardParticipationEnabled) => {
        serviceCalled = true;
        return createPublicProfile(leaderboardParticipationEnabled);
      },
    });
    const response = await app.request(testCase.url, testCase.init);

    assert.equal(serviceCalled, false);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "This endpoint requires Guest, Bearer, or Session authentication",
      requestId: "request-1",
      code: "COMMUNITY_PROFILE_HUMAN_AUTH_REQUIRED",
    });
  }
});

test("GET /me/community/profile marks guest accounts as requiring linked account for leaderboard", async () => {
  const app = createSystemTestApp({
    transport: "guest",
    ensurePublicProfileForUserFn: async (userId) => {
      assert.equal(userId, "user-1");
      return createPublicProfile(true);
    },
  });

  const response = await app.request("http://localhost/me/community/profile");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    publicProfileId: "00000000-0000-4000-8000-000000000001",
    anonymousDisplayName: "Silver Bright Harbor",
    leaderboardParticipationEnabled: true,
    linkedAccountRequiredForLeaderboard: true,
  });
});
