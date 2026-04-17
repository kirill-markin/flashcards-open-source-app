import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError } from "../errors";
import type { AppEnv } from "../app";
import { createAdminRoutes } from "./admin";

test("GET /admin/session returns the signed-in admin identity envelope", async () => {
  const app = new Hono<AppEnv>();
  app.route("/", createAdminRoutes({
    allowedOrigins: [],
    requireAdminRequestFn: async () => ({
      email: "admin@example.com",
      transport: "session",
      userId: "user-1",
      subjectUserId: "subject-1",
      requestAuthInputs: {
        authorizationHeader: undefined,
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
    }),
  }));

  const response = await app.request("http://localhost/admin/session");
  const payload = await response.json() as Readonly<{
    email: string;
    isAdmin: boolean;
    authTransport: "session" | "bearer" | "none";
    csrfToken: string | null;
  }>;

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    email: "admin@example.com",
    isAdmin: true,
    authTransport: "session",
    csrfToken: null,
  });
});

test("POST /admin/reports/query validates body and returns the query payload", async () => {
  const app = new Hono<AppEnv>();
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({ error: error.message, code: error.code });
    }

    context.status(500);
    return context.json({ error: "internal" });
  });
  app.route("/", createAdminRoutes({
    allowedOrigins: [],
    requireAdminRequestFn: async () => ({
      email: "admin@example.com",
      transport: "session",
      userId: "user-1",
      subjectUserId: "subject-1",
      requestAuthInputs: {
        authorizationHeader: undefined,
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
    }),
    executeAdminQueryFn: async ({ sql, adminEmail, requestId, executedAt }) => ({
      executedAtUtc: executedAt.toISOString().replace(".000Z", "Z"),
      resultSets: [
        {
          statementIndex: 0,
          columns: ["sql", "adminEmail", "requestId"],
          rowCount: 1,
          rows: [
            {
              sql,
              adminEmail,
              requestId,
            },
          ],
        },
      ],
    }),
    now: () => new Date("2026-04-17T11:57:06Z"),
  }));

  const invalidResponse = await app.request("http://localhost/admin/reports/query", {
    method: "POST",
    body: JSON.stringify({ sql: 1 }),
  });
  const invalidPayload = await invalidResponse.json() as Readonly<{ error: string; code: string | null }>;
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidPayload.code, "ADMIN_QUERY_INVALID_REQUEST");

  const response = await app.request("http://localhost/admin/reports/query", {
    method: "POST",
    body: JSON.stringify({ sql: "SELECT 1" }),
  });
  const payload = await response.json() as Readonly<{
    executedAtUtc: string;
    resultSets: ReadonlyArray<Readonly<{ rows: ReadonlyArray<Readonly<Record<string, string>>> }>>;
  }>;

  assert.equal(response.status, 200);
  assert.equal(payload.executedAtUtc, "2026-04-17T11:57:06Z");
  assert.equal(payload.resultSets.length, 1);
  assert.deepEqual(payload.resultSets[0]?.rows[0], {
    sql: "SELECT 1",
    adminEmail: "admin@example.com",
    requestId: "unknown",
  });
});

test("POST /admin/reports/query rejects oversized bodies", async () => {
  const app = new Hono<AppEnv>();
  app.onError((error, context) => {
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({ error: error.message, code: error.code });
    }

    context.status(500);
    return context.json({ error: "internal" });
  });
  app.route("/", createAdminRoutes({
    allowedOrigins: [],
    maxAdminQueryBodyBytes: 10,
    requireAdminRequestFn: async () => ({
      email: "admin@example.com",
      transport: "session",
      userId: "user-1",
      subjectUserId: "subject-1",
      requestAuthInputs: {
        authorizationHeader: undefined,
        sessionToken: undefined,
        csrfTokenHeader: undefined,
        originHeader: undefined,
        refererHeader: undefined,
        secFetchSiteHeader: undefined,
      },
    }),
    executeAdminQueryFn: async () => ({
      executedAtUtc: "2026-04-17T11:57:06Z",
      resultSets: [],
    }),
  }));

  const response = await app.request("http://localhost/admin/reports/query", {
    method: "POST",
    body: JSON.stringify({ sql: "SELECT 1" }),
  });
  const payload = await response.json() as Readonly<{ error: string; code: string | null }>;

  assert.equal(response.status, 400);
  assert.equal(payload.code, "ADMIN_QUERY_INVALID_REQUEST");
});
