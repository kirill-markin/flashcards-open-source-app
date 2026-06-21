import assert from "node:assert/strict";
import test from "node:test";
import type {
  LeaderboardProfile,
  ProgressLeaderboard,
  ProgressSummaryResponse,
  StreakLeaderboard,
} from "../../progress";
import type { RequestContext } from "../../server/requestContext";
import {
  createLeaderboardProfile,
  createProgressLeaderboard,
  createProgressReviewSchedule,
  createProgressSeries,
  createProgressSummaryResponse,
  createStreakLeaderboard,
  createSystemTestApp,
} from "./systemTestSupport";

test("GET /me/progress/summary returns 200 for Session, Bearer, and Guest authentication", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = [
    "session",
    "bearer",
    "guest",
  ];

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      loadUserProgressSummaryFn: async ({ userId, timeZone }) => {
        assert.equal(userId, "user-1");
        assert.equal(timeZone, "Europe/Madrid");
        return createProgressSummaryResponse();
      },
    });
    const response = await app.request(
      "http://localhost/me/progress/summary?timeZone=Europe/Madrid",
    );

    assert.equal(response.status, 200);
    const payload = await response.json() as ProgressSummaryResponse;
    assert.deepEqual(payload, createProgressSummaryResponse());
    assert.equal(payload.summary.streakFreeze.earnedUnitsPerStreakDay, 1);
  }
});

test("GET /me/progress/review-schedule returns 200 for Session, Bearer, and Guest authentication", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = [
    "session",
    "bearer",
    "guest",
  ];

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      loadUserProgressReviewScheduleFn: async ({ userId, timeZone }) => {
        assert.equal(userId, "user-1");
        assert.equal(timeZone, "Europe/Madrid");
        return createProgressReviewSchedule();
      },
    });
    const response = await app.request(
      "http://localhost/me/progress/review-schedule?timeZone=Europe/Madrid",
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), createProgressReviewSchedule());
  }
});

test("GET /me/progress/series returns 200 for Session, Bearer, and Guest authentication", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = [
    "session",
    "bearer",
    "guest",
  ];

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      loadUserProgressSeriesFn: async ({ userId, timeZone, from, to }) => {
        assert.equal(userId, "user-1");
        assert.equal(timeZone, "Europe/Madrid");
        assert.equal(from, "2026-04-11");
        assert.equal(to, "2026-04-17");
        return createProgressSeries();
      },
    });
    const response = await app.request(
      "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-17",
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), createProgressSeries());
  }
});

test("progress endpoints reject ApiKey authentication", async () => {
  const cases = [
    "http://localhost/me/progress/summary?timeZone=Europe/Madrid",
    "http://localhost/me/progress/review-schedule?timeZone=Europe/Madrid",
    "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-17",
  ] as const;

  for (const url of cases) {
    let called = false;
    const app = createSystemTestApp({
      transport: "api_key",
      loadUserProgressSeriesFn: async () => {
        called = true;
        return createProgressSeries();
      },
      loadUserProgressReviewScheduleFn: async () => {
        called = true;
        return createProgressReviewSchedule();
      },
      loadUserProgressSummaryFn: async () => {
        called = true;
        return createProgressSummaryResponse();
      },
    });
    const response = await app.request(url);

    assert.equal(called, false);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "This endpoint requires Guest, Bearer, or Session authentication",
      requestId: "request-1",
      code: "PROGRESS_HUMAN_AUTH_REQUIRED",
    });
  }
});

test("GET /me/progress/leaderboard returns the leaderboard for Session and Bearer", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = ["session", "bearer"];

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      locale: "es-MX",
      loadProgressLeaderboardFn: async ({ userId, transport: requestTransport, localeHint }) => {
        assert.equal(userId, "user-1");
        assert.equal(requestTransport, transport);
        assert.equal(localeHint, "es-MX");
        return createProgressLeaderboard();
      },
    });
    const response = await app.request("http://localhost/me/progress/leaderboard");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), createProgressLeaderboard());
  }
});

test("GET /me/progress/leaderboard returns linked_account_required for Guest", async () => {
  const app = createSystemTestApp({ transport: "guest" });
  const response = await app.request("http://localhost/me/progress/leaderboard");
  const payload = await response.json() as ProgressLeaderboard;

  assert.equal(response.status, 200);
  assert.equal(payload.status, "linked_account_required");
  assert.deepEqual(payload.windows, []);
  assert.equal(payload.defaultWindowKey, "last_24_hours");
  assert.equal(payload.metric.metricVersion, "qualified_reviews_v1");
});

test("GET /me/progress/leaderboard rejects ApiKey authentication", async () => {
  let called = false;
  const app = createSystemTestApp({
    transport: "api_key",
    loadProgressLeaderboardFn: async () => {
      called = true;
      return createProgressLeaderboard();
    },
  });
  const response = await app.request("http://localhost/me/progress/leaderboard");

  assert.equal(called, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "This endpoint requires Guest, Bearer, or Session authentication",
    requestId: "request-1",
    code: "PROGRESS_HUMAN_AUTH_REQUIRED",
  });
});

test("GET /me/progress/leaderboards/profiles/{publicProfileId} returns the profile for Session and Bearer", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = ["session", "bearer"];
  const publicProfileId = "a1d2c3b4-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      locale: "es-MX",
      loadLeaderboardProfileFn: async ({ userId, transport: requestTransport, localeHint, publicProfileId: targetId }) => {
        assert.equal(userId, "user-1");
        assert.equal(requestTransport, transport);
        assert.equal(localeHint, "es-MX");
        assert.equal(targetId, publicProfileId);
        return createLeaderboardProfile();
      },
    });
    const response = await app.request(`http://localhost/me/progress/leaderboards/profiles/${publicProfileId}`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), createLeaderboardProfile());
  }
});

test("GET /me/progress/leaderboards/profiles/{publicProfileId} returns linked_account_required for Guest", async () => {
  const publicProfileId = "a1d2c3b4-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
  const app = createSystemTestApp({ transport: "guest" });
  const response = await app.request(`http://localhost/me/progress/leaderboards/profiles/${publicProfileId}`);
  const payload = await response.json() as LeaderboardProfile;

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { status: "linked_account_required" });
});

test("GET /me/progress/leaderboards/profiles/{publicProfileId} rejects ApiKey authentication", async () => {
  const publicProfileId = "a1d2c3b4-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
  let called = false;
  const app = createSystemTestApp({
    transport: "api_key",
    loadLeaderboardProfileFn: async () => {
      called = true;
      return createLeaderboardProfile();
    },
  });
  const response = await app.request(`http://localhost/me/progress/leaderboards/profiles/${publicProfileId}`);

  assert.equal(called, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "This endpoint requires Guest, Bearer, or Session authentication",
    requestId: "request-1",
    code: "PROGRESS_HUMAN_AUTH_REQUIRED",
  });
});

test("GET /me/progress/leaderboards/streak returns the streak leaderboard for Session and Bearer", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = ["session", "bearer"];

  for (const transport of transports) {
    const app = createSystemTestApp({
      transport,
      locale: "es-MX",
      loadStreakLeaderboardFn: async ({ userId, transport: requestTransport, localeHint }) => {
        assert.equal(userId, "user-1");
        assert.equal(requestTransport, transport);
        assert.equal(localeHint, "es-MX");
        return createStreakLeaderboard();
      },
    });
    const response = await app.request("http://localhost/me/progress/leaderboards/streak");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), createStreakLeaderboard());
  }
});

test("GET /me/progress/leaderboards/streak returns linked_account_required for Guest", async () => {
  const app = createSystemTestApp({ transport: "guest" });
  const response = await app.request("http://localhost/me/progress/leaderboards/streak");
  const payload = await response.json() as StreakLeaderboard;

  assert.equal(response.status, 200);
  assert.equal(payload.status, "linked_account_required");
  assert.equal("rows" in payload, false);
  assert.equal(payload.metric.metricVersion, "streak_days_v1");
});

test("GET /me/progress/leaderboards/streak rejects ApiKey authentication", async () => {
  let called = false;
  const app = createSystemTestApp({
    transport: "api_key",
    loadStreakLeaderboardFn: async () => {
      called = true;
      return createStreakLeaderboard();
    },
  });
  const response = await app.request("http://localhost/me/progress/leaderboards/streak");

  assert.equal(called, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "This endpoint requires Guest, Bearer, or Session authentication",
    requestId: "request-1",
    code: "PROGRESS_HUMAN_AUTH_REQUIRED",
  });
});

test("GET /me/progress returns 404 after legacy endpoint removal", async () => {
  const app = createSystemTestApp({
    transport: "session",
    loadUserProgressSeriesFn: async () => createProgressSeries(),
    loadUserProgressSummaryFn: async () => createProgressSummaryResponse(),
  });
  const response = await app.request(
    "http://localhost/me/progress?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-17",
  );

  assert.equal(response.status, 404);
});

test("GET /me/progress/summary validates required and malformed query parameters", async () => {
  const app = createSystemTestApp({
    transport: "session",
    loadUserProgressSummaryFn: async () => createProgressSummaryResponse(),
  });
  const invalidCases = [
    {
      url: "http://localhost/me/progress/summary",
      status: 400,
      code: "PROGRESS_TIMEZONE_REQUIRED",
    },
    {
      url: "http://localhost/me/progress/summary?timeZone=Mars/Olympus",
      status: 400,
      code: "PROGRESS_TIMEZONE_INVALID",
    },
  ] as const;

  for (const invalidCase of invalidCases) {
    const response = await app.request(invalidCase.url);
    const payload = await response.json() as Readonly<{ code: string | null }>;
    assert.equal(response.status, invalidCase.status);
    assert.equal(payload.code, invalidCase.code);
  }
});

test("GET /me/progress/review-schedule validates required and malformed query parameters", async () => {
  const app = createSystemTestApp({
    transport: "session",
    loadUserProgressReviewScheduleFn: async () => createProgressReviewSchedule(),
  });
  const invalidCases = [
    {
      url: "http://localhost/me/progress/review-schedule",
      status: 400,
      code: "PROGRESS_TIMEZONE_REQUIRED",
    },
    {
      url: "http://localhost/me/progress/review-schedule?timeZone=Mars/Olympus",
      status: 400,
      code: "PROGRESS_TIMEZONE_INVALID",
    },
  ] as const;

  for (const invalidCase of invalidCases) {
    const response = await app.request(invalidCase.url);
    const payload = await response.json() as Readonly<{ code: string | null }>;
    assert.equal(response.status, invalidCase.status);
    assert.equal(payload.code, invalidCase.code);
  }
});

test("GET /me/progress/series validates required and malformed query parameters", async () => {
  const app = createSystemTestApp({
    transport: "session",
    loadUserProgressSeriesFn: async () => createProgressSeries(),
  });
  const invalidCases = [
    {
      url: "http://localhost/me/progress/series?from=2026-04-11&to=2026-04-17",
      status: 400,
      code: "PROGRESS_TIMEZONE_REQUIRED",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Mars/Olympus&from=2026-04-11&to=2026-04-17",
      status: 400,
      code: "PROGRESS_TIMEZONE_INVALID",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&to=2026-04-17",
      status: 400,
      code: "PROGRESS_FROM_REQUIRED",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-11",
      status: 400,
      code: "PROGRESS_TO_REQUIRED",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-31&to=2026-04-17",
      status: 400,
      code: "PROGRESS_FROM_INVALID",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-99",
      status: 400,
      code: "PROGRESS_TO_INVALID",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2026-04-18&to=2026-04-17",
      status: 400,
      code: "PROGRESS_RANGE_INVALID",
    },
    {
      url: "http://localhost/me/progress/series?timeZone=Europe/Madrid&from=2025-04-16&to=2026-04-17",
      status: 400,
      code: "PROGRESS_RANGE_TOO_LARGE",
    },
  ] as const;

  for (const invalidCase of invalidCases) {
    const response = await app.request(invalidCase.url);
    const payload = await response.json() as Readonly<{ code: string | null }>;
    assert.equal(response.status, invalidCase.status);
    assert.equal(payload.code, invalidCase.code);
  }
});
