import { Hono } from "hono";
import { requireAdminRequest, type AdminRequestContext } from "../admin/authz";
import { executeAdminQuery, type AdminQueryResponse } from "../admin/query";
import { HttpError } from "../errors";
import { getSessionCsrfToken } from "../requestSecurity";
import type { AppEnv } from "../app";

type AdminRoutesOptions = Readonly<{
  maxAdminQueryBodyBytes?: number;
  allowedOrigins: ReadonlyArray<string>;
  requireAdminRequestFn?: (
    request: Request,
    allowedOrigins: ReadonlyArray<string>,
  ) => Promise<AdminRequestContext>;
  executeAdminQueryFn?: (params: Readonly<{
    sql: string;
    adminEmail: string;
    requestId: string;
    executedAt: Date;
  }>) => Promise<AdminQueryResponse>;
  now?: () => Date;
}>;

const defaultMaxAdminQueryBodyBytes = 100_000;

async function parseAdminQueryRequestBody(
  request: Request,
  maxAdminQueryBodyBytes: number,
): Promise<Readonly<{ sql: string }>> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null && contentLengthHeader !== "") {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxAdminQueryBodyBytes) {
      throw new HttpError(400, "Admin query body is too large.", "ADMIN_QUERY_INVALID_REQUEST");
    }
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maxAdminQueryBodyBytes) {
    throw new HttpError(400, "Admin query body is too large.", "ADMIN_QUERY_INVALID_REQUEST");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody) as unknown;
  } catch {
    throw new HttpError(400, "Admin query body must be valid JSON.", "ADMIN_QUERY_INVALID_REQUEST");
  }

  if (typeof parsedBody !== "object" || parsedBody === null || !("sql" in parsedBody)) {
    throw new HttpError(400, "Admin query body must include sql.", "ADMIN_QUERY_INVALID_REQUEST");
  }

  const sql = (parsedBody as Readonly<{ sql?: unknown }>).sql;
  if (typeof sql !== "string") {
    throw new HttpError(400, "Admin query sql must be a string.", "ADMIN_QUERY_INVALID_REQUEST");
  }

  return { sql };
}

export function createAdminRoutes(options: AdminRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const requireAdminRequestFn = options.requireAdminRequestFn ?? requireAdminRequest;
  const executeAdminQueryFn = options.executeAdminQueryFn ?? executeAdminQuery;
  const maxAdminQueryBodyBytes = options.maxAdminQueryBodyBytes ?? defaultMaxAdminQueryBodyBytes;
  const now = options.now ?? (() => new Date());

  app.get("/admin/session", async (context) => {
    const adminContext = await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    return context.json({
      email: adminContext.email,
      isAdmin: true,
      authTransport: adminContext.transport,
      csrfToken: adminContext.transport === "session" && adminContext.requestAuthInputs.sessionToken !== undefined
        ? await getSessionCsrfToken(adminContext.requestAuthInputs.sessionToken)
        : null,
    });
  });

  app.post("/admin/reports/query", async (context) => {
    const adminContext = await requireAdminRequestFn(context.req.raw, options.allowedOrigins);
    const { sql } = await parseAdminQueryRequestBody(context.req.raw, maxAdminQueryBodyBytes);
    const report = await executeAdminQueryFn({
      sql,
      adminEmail: adminContext.email,
      requestId: context.get("requestId") ?? "unknown",
      executedAt: now(),
    });

    return context.json(report);
  });

  return app;
}
