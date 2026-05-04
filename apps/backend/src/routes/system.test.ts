import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../app";
import { HttpError } from "../errors";
import type {
  ProgressReviewSchedule,
  ProgressReviewScheduleRequest,
  ProgressSeries,
  ProgressSeriesRequest,
  ProgressSummaryResponse,
} from "../progress";
import { createSystemRoutes } from "./system";
import type { RequestContext } from "../server/requestContext";

type SystemTestAppOptions = Readonly<{
  transport: RequestContext["transport"];
  loadUserProgressReviewScheduleFn?: (args: ProgressReviewScheduleRequest) => Promise<ProgressReviewSchedule>;
  loadUserProgressSeriesFn?: (args: ProgressSeriesRequest) => Promise<ProgressSeries>;
  loadUserProgressSummaryFn?: (args: Readonly<{ userId: string; timeZone: string }>) => Promise<ProgressSummaryResponse>;
}>;

function createRequestContext(
  transport: RequestContext["transport"],
): RequestContext {
  return {
    userId: "user-1",
    subjectUserId: "subject-1",
    selectedWorkspaceId: "workspace-1",
    email: "user@example.com",
    locale: "en",
    userSettingsCreatedAt: "2026-04-01T00:00:00.000Z",
    transport,
    connectionId: transport === "api_key" ? "connection-1" : null,
  };
}

function createProgressSummaryResponse(): ProgressSummaryResponse {
  return {
    timeZone: "Europe/Madrid",
    summary: {
      currentStreakDays: 3,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-17",
      activeReviewDays: 12,
    },
    generatedAt: "2026-04-17T10:11:12.000Z",
  };
}

function createProgressSeries(): ProgressSeries {
  return {
    timeZone: "Europe/Madrid",
    from: "2026-04-11",
    to: "2026-04-17",
    dailyReviews: [
      { date: "2026-04-11", reviewCount: 0 },
      { date: "2026-04-12", reviewCount: 3 },
      { date: "2026-04-13", reviewCount: 0 },
      { date: "2026-04-14", reviewCount: 1 },
      { date: "2026-04-15", reviewCount: 0 },
      { date: "2026-04-16", reviewCount: 0 },
      { date: "2026-04-17", reviewCount: 4 },
    ],
    generatedAt: "2026-04-17T10:11:12.000Z",
  };
}

function createProgressReviewSchedule(): ProgressReviewSchedule {
  return {
    timeZone: "Europe/Madrid",
    generatedAt: "2026-04-17T10:11:12.000Z",
    totalCards: 72,
    buckets: [
      { key: "new", count: 2 },
      { key: "today", count: 4 },
      { key: "days1To7", count: 6 },
      { key: "days8To30", count: 8 },
      { key: "days31To90", count: 10 },
      { key: "days91To360", count: 12 },
      { key: "years1To2", count: 14 },
      { key: "later", count: 16 },
    ],
  };
}

function createSystemTestApp(options: SystemTestAppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    await next();
  });
  app.onError((error, context) => {
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
  app.route("/", createSystemRoutes({
    allowedOrigins: [],
    loadRequestContextFromRequestFn: async () => ({
      requestAuthInputs: {} as never,
      requestContext: createRequestContext(options.transport),
    }),
    loadUserProgressReviewScheduleFn: options.loadUserProgressReviewScheduleFn,
    loadUserProgressSeriesFn: options.loadUserProgressSeriesFn,
    loadUserProgressSummaryFn: options.loadUserProgressSummaryFn,
  }));

  return app;
}

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
    assert.deepEqual(await response.json(), createProgressSummaryResponse());
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
