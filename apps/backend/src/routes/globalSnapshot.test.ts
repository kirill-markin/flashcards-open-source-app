import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createApp, type AppEnv } from "../app";
import { resetAuthConfigForTests } from "../authConfig";
import { HttpError } from "../errors";
import { resetGuestAiQuotaConfigForTests } from "../guestAiQuotaConfig";
import {
  buildGlobalMetricsSnapshot,
  createGlobalMetricsSnapshotWindow,
  type GlobalMetricsSnapshot,
} from "../globalMetrics/snapshot";
import { createGlobalSnapshotRoutes, globalSnapshotPath } from "./globalSnapshot";

function createSnapshotFixture(): GlobalMetricsSnapshot {
  return buildGlobalMetricsSnapshot({
    window: createGlobalMetricsSnapshotWindow({
      now: new Date("2026-04-23T09:30:00.000Z"),
      historicalStartDate: "2026-03-07",
    }),
    totalsRow: {
      unique_reviewing_users: 3,
      total_review_events: 5,
      web_review_events: 2,
      android_review_events: 2,
      ios_review_events: 1,
    },
    dayRows: [
      {
        review_date: "2026-03-07",
        unique_reviewing_users: 2,
        new_reviewing_users: 2,
        returning_reviewing_users: 0,
        total_review_events: 3,
        web_review_events: 1,
        android_review_events: 1,
        ios_review_events: 1,
      },
      {
        review_date: "2026-04-22",
        unique_reviewing_users: 2,
        new_reviewing_users: 1,
        returning_reviewing_users: 1,
        total_review_events: 2,
        web_review_events: 1,
        android_review_events: 1,
        ios_review_events: 0,
      },
    ],
  });
}

function createGlobalSnapshotTestApp(options: Readonly<{
  isGlobalMetricsVisible: boolean;
  loadGlobalMetricsSnapshotFn: () => Promise<GlobalMetricsSnapshot>;
}>): Hono<AppEnv> {
  return createMountedGlobalSnapshotTestApp(options);
}

function createMountedGlobalSnapshotTestApp(options: Readonly<{
  isGlobalMetricsVisible: boolean;
  loadGlobalMetricsSnapshotFn: () => Promise<GlobalMetricsSnapshot>;
}>): Hono<AppEnv> {
  const app = new Hono<AppEnv>({ strict: false }).basePath("/v1");

  app.use("*", async (context, next) => {
    context.set("requestId", "request-1");
    await next();
  });
  app.use(globalSnapshotPath, cors({
    origin: "*",
    allowMethods: ["GET", "OPTIONS"],
  }));
  app.use("*", cors({
    origin: ["https://app.flashcards-open-source-app.com"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
    allowHeaders: ["content-type", "authorization", "x-csrf-token"],
    exposeHeaders: [
      "cache-control",
      "content-encoding",
      "content-length",
      "content-type",
      "x-request-id",
      "x-amz-apigw-id",
      "x-amzn-requestid",
      "x-chat-request-id",
    ],
    credentials: true,
  }));

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

  app.route("/", createGlobalSnapshotRoutes({
    loadGlobalMetricsSnapshotFn: options.loadGlobalMetricsSnapshotFn,
    isGlobalMetricsVisibleFn: () => options.isGlobalMetricsVisible,
  }));

  return app;
}

function createCrossOriginRequestInit(): RequestInit {
  return {
    headers: {
      origin: "https://example.com",
    },
  };
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function createMountedAppTestCleanup(): () => void {
  const originalAuthMode = process.env.AUTH_MODE;
  const originalAllowInsecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH;
  const originalBackendAllowedOrigins = process.env.BACKEND_ALLOWED_ORIGINS;

  process.env.AUTH_MODE = "none";
  process.env.ALLOW_INSECURE_LOCAL_AUTH = "true";
  process.env.BACKEND_ALLOWED_ORIGINS = "https://app.flashcards-open-source-app.com";
  resetAuthConfigForTests();
  resetGuestAiQuotaConfigForTests();

  return () => {
    restoreEnvironmentVariable("AUTH_MODE", originalAuthMode);
    restoreEnvironmentVariable("ALLOW_INSECURE_LOCAL_AUTH", originalAllowInsecureLocalAuth);
    restoreEnvironmentVariable("BACKEND_ALLOWED_ORIGINS", originalBackendAllowedOrigins);
    resetAuthConfigForTests();
    resetGuestAiQuotaConfigForTests();
  };
}

test("GET /v1/global/snapshot returns the snapshot when visible", async () => {
  const snapshot = createSnapshotFixture();
  const app = createGlobalSnapshotTestApp({
    isGlobalMetricsVisible: true,
    loadGlobalMetricsSnapshotFn: async () => snapshot,
  });

  const response = await app.request(
    "http://localhost/v1/global/snapshot",
    createCrossOriginRequestInit(),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.deepEqual(await response.json(), snapshot);
});

test("GET /v1/global/snapshot returns 404 when global metrics are not visible", async () => {
  let loaderCalls = 0;
  const app = createGlobalSnapshotTestApp({
    isGlobalMetricsVisible: false,
    loadGlobalMetricsSnapshotFn: async () => {
      loaderCalls += 1;
      return createSnapshotFixture();
    },
  });

  const response = await app.request(
    "http://localhost/v1/global/snapshot",
    createCrossOriginRequestInit(),
  );

  assert.equal(loaderCalls, 0);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.deepEqual(await response.json(), {
    error: "Global metrics snapshot is not visible.",
    requestId: "request-1",
    code: "GLOBAL_METRICS_NOT_VISIBLE",
  });
});

test("GET /v1/global/snapshot returns a public-safe 503 when the snapshot object is unavailable", async () => {
  const app = createGlobalSnapshotTestApp({
    isGlobalMetricsVisible: true,
    loadGlobalMetricsSnapshotFn: async () => {
      throw new HttpError(
        503,
        "Global metrics snapshot is unavailable from s3://metrics-bucket/v1/global-snapshot.json: NoSuchKey status=404: Not Found",
        "GLOBAL_METRICS_SNAPSHOT_UNAVAILABLE",
      );
    },
  });

  const response = await app.request(
    "http://localhost/v1/global/snapshot",
    createCrossOriginRequestInit(),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.deepEqual(await response.json(), {
    error: "Global metrics snapshot is unavailable.",
    requestId: "request-1",
    code: "GLOBAL_METRICS_SNAPSHOT_UNAVAILABLE",
  });
});

test("GET /v1/global/snapshot returns public 500 CORS headers on unexpected mounted-app errors", async () => {
  const app = createMountedGlobalSnapshotTestApp({
    isGlobalMetricsVisible: true,
    loadGlobalMetricsSnapshotFn: async () => {
      throw new Error("boom");
    },
  });

  const response = await app.request(
    "http://localhost/v1/global/snapshot",
    createCrossOriginRequestInit(),
  );

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.deepEqual(await response.json(), {
    error: "Request failed. Try again.",
    requestId: "request-1",
    code: "INTERNAL_ERROR",
  });
});

test("GET /v1/global/snapshot returns public 404 CORS headers on the mounted backend app when hidden", async (context) => {
  const cleanup = createMountedAppTestCleanup();
  const originalGlobalMetricsVisible = process.env.GLOBAL_METRICS_VISIBLE;
  process.env.GLOBAL_METRICS_VISIBLE = "false";
  context.after(() => {
    restoreEnvironmentVariable("GLOBAL_METRICS_VISIBLE", originalGlobalMetricsVisible);
    cleanup();
  });

  const app = createApp("/v1");
  const response = await app.request(
    "http://localhost/v1/global/snapshot",
    createCrossOriginRequestInit(),
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.deepEqual(await response.json(), {
    error: "Global metrics snapshot is not visible.",
    requestId: response.headers.get("x-request-id"),
    code: "GLOBAL_METRICS_NOT_VISIBLE",
  });
});

test("OPTIONS /v1/global/snapshot returns public preflight headers on the mounted backend app", async (context) => {
  const cleanup = createMountedAppTestCleanup();
  context.after(cleanup);

  const app = createApp("/v1");
  const response = await app.request("http://localhost/v1/global/snapshot", {
    method: "OPTIONS",
    headers: {
      origin: "https://example.com",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET,OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "authorization");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.notEqual(response.headers.get("x-request-id"), null);
});
