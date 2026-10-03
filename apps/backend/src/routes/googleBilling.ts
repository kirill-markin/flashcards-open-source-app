import { Hono } from "hono";
import { z } from "zod";
import { GoogleBillingError } from "../billing/google/contracts";
import { createGoogleBillingService } from "../billing/google/service";
import { getDatabaseErrorFields } from "../database/transient";
import type { AppEnv } from "../server/appEnv";
import { loadRequestContextFromRequest } from "../server/requestContext";
import { expectRecord, parseJsonBodyWithByteLimit } from "../server/requestParsing";
import { HttpError } from "../shared/errors";

const billing = createGoogleBillingService();
const purchaseTokenSchema = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);

async function loadGoogleBillingUserId(request: Request, allowedOrigins: ReadonlyArray<string>): Promise<string> {
  const { requestContext } = await loadRequestContextFromRequest(request, allowedOrigins);
  if (requestContext.transport !== "guest" && requestContext.transport !== "bearer" && requestContext.transport !== "session") {
    throw new HttpError(403, "Google billing requires Guest, Bearer, or Session authentication.", "GOOGLE_HUMAN_AUTH_REQUIRED");
  }
  return requestContext.userId;
}

function googleHttpError(error: unknown): HttpError {
  if (error instanceof GoogleBillingError) {
    const status = error.retryable || error.code === "GOOGLE_CONFIGURATION_INVALID" ? 503
      : error.code === "GOOGLE_ACCOUNT_RETIRED" ? 410
        : error.code === "GOOGLE_PROVIDER_FAILED" ? 502 : 400;
    console.warn(JSON.stringify({ event: "google_billing_request_failed", errorCode: error.code,
      retryable: error.retryable, providerHttpStatus: error.httpStatus }));
    return new HttpError(status, error.message, error.code);
  }
  // Neither SDK errors nor PostgreSQL details are safe: either can contain a purchase token.
  const diagnostic = z.string().regex(/^[A-Z0-9_]{1,64}$/).safeParse(getDatabaseErrorFields(error).errorCode);
  return new HttpError(503,
    `Google billing could not complete (${diagnostic.success ? diagnostic.data : "provider or persistence failure"}). Retry the same purchase.`,
    "GOOGLE_BILLING_UNAVAILABLE");
}

export function createGoogleBillingRoutes(options: Readonly<{ allowedOrigins: ReadonlyArray<string> }>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/billing/google/account", async (context) => {
    context.header("Cache-Control", "no-store");
    const userId = await loadGoogleBillingUserId(context.req.raw, options.allowedOrigins);
    try {
      return context.json(await billing.getOrCreateAccountId(userId));
    } catch (error) {
      throw googleHttpError(error);
    }
  });
  app.post("/billing/google/purchases", async (context) => {
    context.header("Cache-Control", "no-store");
    const userId = await loadGoogleBillingUserId(context.req.raw, options.allowedOrigins);
    const body = expectRecord(await parseJsonBodyWithByteLimit(context.req.raw, 32_768,
      "Google billing request body is too large.", "GOOGLE_BODY_TOO_LARGE"));
    const token = purchaseTokenSchema.safeParse(body.purchaseToken);
    if (!token.success) {
      throw new HttpError(400, "purchaseToken must be a nonempty printable token of at most 4096 characters.",
        "GOOGLE_PURCHASE_TOKEN_INVALID");
    }
    if (body.intent !== "explicit" && body.intent !== "passive") {
      throw new HttpError(400, "intent is required and must be explicit or passive.", "GOOGLE_INTENT_INVALID");
    }
    try {
      return context.json(body.intent === "explicit"
        ? await billing.attachPurchase(userId, token.data)
        : await billing.reconcilePurchase(token.data));
    } catch (error) {
      throw googleHttpError(error);
    }
  });
  return app;
}
