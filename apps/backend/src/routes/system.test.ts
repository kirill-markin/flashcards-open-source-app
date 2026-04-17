import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../app";
import { HttpError } from "../errors";
import type { ProgressSeries, ProgressSeriesRequest } from "../progress";
import { createSystemRoutes } from "./system";
import type { RequestContext } from "../server/requestContext";

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
  };
}

function createSystemTestApp(
  transport: RequestContext["transport"],
  loadUserProgressSeriesFn: (args: ProgressSeriesRequest) => Promise<ProgressSeries>,
): Hono<AppEnv> {
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
      requestContext: createRequestContext(transport),
    }),
    loadUserProgressSeriesFn,
  }));

  return app;
}

test("GET /me/progress returns 200 for Session, Bearer, and Guest authentication", async () => {
  const transports: ReadonlyArray<RequestContext["transport"]> = [
    "session",
    "bearer",
    "guest",
  ];

  for (const transport of transports) {
    const app = createSystemTestApp(transport, async ({ userId, timeZone, from, to }) => {
      assert.equal(userId, "user-1");
      assert.equal(timeZone, "Europe/Madrid");
      assert.equal(from, "2026-04-11");
      assert.equal(to, "2026-04-17");
      return createProgressSeries();
    });
    const response = await app.request(
      "http://localhost/me/progress?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-17",
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), createProgressSeries());
  }
});

test("GET /me/progress rejects ApiKey authentication", async () => {
  let called = false;
  const app = createSystemTestApp("api_key", async () => {
    called = true;
    return createProgressSeries();
  });
  const response = await app.request(
    "http://localhost/me/progress?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-17",
  );

  assert.equal(called, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "This endpoint requires Guest, Bearer, or Session authentication",
    requestId: "request-1",
    code: "PROGRESS_HUMAN_AUTH_REQUIRED",
  });
});

test("GET /me/progress validates required and malformed query parameters", async () => {
  const app = createSystemTestApp("session", async () => createProgressSeries());
  const invalidCases = [
    {
      url: "http://localhost/me/progress?from=2026-04-11&to=2026-04-17",
      status: 400,
      code: "PROGRESS_TIMEZONE_REQUIRED",
    },
    {
      url: "http://localhost/me/progress?timeZone=Mars/Olympus&from=2026-04-11&to=2026-04-17",
      status: 400,
      code: "PROGRESS_TIMEZONE_INVALID",
    },
    {
      url: "http://localhost/me/progress?timeZone=Europe/Madrid&to=2026-04-17",
      status: 400,
      code: "PROGRESS_FROM_REQUIRED",
    },
    {
      url: "http://localhost/me/progress?timeZone=Europe/Madrid&from=2026-04-11",
      status: 400,
      code: "PROGRESS_TO_REQUIRED",
    },
    {
      url: "http://localhost/me/progress?timeZone=Europe/Madrid&from=2026-04-31&to=2026-04-17",
      status: 400,
      code: "PROGRESS_FROM_INVALID",
    },
    {
      url: "http://localhost/me/progress?timeZone=Europe/Madrid&from=2026-04-11&to=2026-04-99",
      status: 400,
      code: "PROGRESS_TO_INVALID",
    },
    {
      url: "http://localhost/me/progress?timeZone=Europe/Madrid&from=2026-04-18&to=2026-04-17",
      status: 400,
      code: "PROGRESS_RANGE_INVALID",
    },
    {
      url: "http://localhost/me/progress?timeZone=Europe/Madrid&from=2025-04-16&to=2026-04-17",
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
