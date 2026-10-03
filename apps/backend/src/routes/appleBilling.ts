import { Hono } from "hono";
import { z } from "zod";
import { loadAppleSigningSecret } from "../billing/apple/config";
import { AppleBillingError } from "../billing/apple/contracts";
import { createAppleBillingService } from "../billing/apple/service";
import { getDatabaseErrorFields } from "../database/transient";
import type { AppEnv } from "../server/appEnv";
import { loadRequestContextFromRequest } from "../server/requestContext";
import { expectNonEmptyString, expectRecord, parseJsonBodyWithByteLimit } from "../server/requestParsing";
import { HttpError } from "../shared/errors";

export const appleNotificationPath = "/billing/apple/notifications";
const appleJsonBodyMaxBytes = 262_144;
const billing = createAppleBillingService(loadAppleSigningSecret);

async function loadAppleBillingUserId(request: Request, allowedOrigins: ReadonlyArray<string>): Promise<string> {
  const { requestContext } = await loadRequestContextFromRequest(request, allowedOrigins);
  if (requestContext.transport !== "guest" && requestContext.transport !== "bearer" && requestContext.transport !== "session") {
    throw new HttpError(403, "Apple billing requires Guest, Bearer, or Session authentication.", "APPLE_HUMAN_AUTH_REQUIRED");
  }
  return requestContext.userId;
}

async function parseAppleBody(request: Request): Promise<Record<string, unknown>> {
  return expectRecord(await parseJsonBodyWithByteLimit(
    request, appleJsonBodyMaxBytes, "Apple billing request body is too large.", "APPLE_BODY_TOO_LARGE",
  ));
}

function appleHttpError(error: unknown): HttpError {
  if (error instanceof AppleBillingError) {
    const status = error.retryable || error.code === "APPLE_CONFIGURATION_INVALID" ? 503
      : error.code === "APPLE_ACCOUNT_RETIRED" ? 410
        : error.code === "APPLE_PROVIDER_FAILED" ? 502 : 400;
    return new HttpError(status, error.message, error.code);
  }
  // A persistence/SDK error can contain signed payloads. Keep only a bounded diagnostic code,
  // never its message, details or cause, before passing it to shared logging and Sentry.
  const diagnostic = z.string().regex(/^[A-Z0-9_]{1,64}$/).safeParse(getDatabaseErrorFields(error).errorCode);
  return new HttpError(503,
    `Apple billing could not complete (${diagnostic.success ? diagnostic.data : "provider or persistence failure"}). Retry the same request.`,
    "APPLE_BILLING_UNAVAILABLE");
}

export function createAppleBillingRoutes(options: Readonly<{ allowedOrigins: ReadonlyArray<string> }>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/billing/apple/account", async (context) => {
    context.header("Cache-Control", "no-store");
    const userId = await loadAppleBillingUserId(context.req.raw, options.allowedOrigins);
    try {
      await loadAppleSigningSecret();
      return context.json(await billing.getOrCreateAccountToken(userId));
    } catch (error) {
      throw appleHttpError(error);
    }
  });

  app.post("/billing/apple/transactions", async (context) => {
    context.header("Cache-Control", "no-store");
    const userId = await loadAppleBillingUserId(context.req.raw, options.allowedOrigins);
    const body = await parseAppleBody(context.req.raw);
    const signedTransaction = expectNonEmptyString(body.signedTransaction, "signedTransaction");
    try {
      return context.json(await billing.attachTransaction(userId, signedTransaction));
    } catch (error) {
      throw appleHttpError(error);
    }
  });

  app.post(appleNotificationPath, async (context) => {
    const body = await parseAppleBody(context.req.raw);
    const signedPayload = expectNonEmptyString(body.signedPayload, "signedPayload");
    // Apple's verified JWS is this route's only credential; never read session cookies here.
    try {
      await billing.processNotification(signedPayload);
      return context.json({ received: true });
    } catch (error) {
      throw appleHttpError(error);
    }
  });

  return app;
}
