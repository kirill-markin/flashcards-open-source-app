import { Buffer } from "node:buffer";
import { Hono } from "hono";
import { z } from "zod";
import { createStripeCheckout, reconcileStripeCheckoutReturn, type StripeHumanActor } from "../billing/stripe/checkout";
import { StripeBillingError, type StripeEnvironment } from "../billing/stripe/contracts";
import { createStripePortal, getStripeBillingDetails, type StripeBillingDetails } from "../billing/stripe/portal";
import { handleStripeWebhook } from "../billing/stripe/service";
import type { AppEnv } from "../server/appEnv";
import { loadRequestContextFromRequest } from "../server/requestContext";
import { parseJsonBodyWithByteLimit } from "../server/requestParsing";
import { HttpError } from "../shared/errors";

export const stripeWebhookPaths = [
  "/billing/stripe/webhooks/sandbox", "/billing/stripe/webhooks/live",
] as const;

export function isStripeWebhookRequest(method: string, path: string): boolean {
  return method === "POST" && stripeWebhookPaths.some((candidate) => path === candidate || path === `/v1${candidate}`);
}

const environmentSchema = z.enum(["production", "sandbox"]);
const sessionIdSchema = z.string().regex(/^cs_[A-Za-z0-9_]+$/).max(255);
const dateSchema = z.iso.datetime();
const hostedUrlSchema = z.url().refine((value) => new URL(value).protocol === "https:");
const checkoutResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("checkout"), attemptId: z.uuid(), sessionId: sessionIdSchema,
    url: hostedUrlSchema, expiresAt: dateSchema, trialDays: z.union([z.literal(0), z.literal(7)]) }),
  z.object({ outcome: z.literal("existing_subscription"), identityId: z.uuid() }),
  z.object({ outcome: z.literal("complete"), attemptId: z.uuid(), sessionId: sessionIdSchema }),
]);
const checkoutReturnInputSchema = z.object({ attemptId: z.uuid(), sessionId: sessionIdSchema }).strict();
const checkoutReturnResultSchema = checkoutReturnInputSchema.extend({ status: z.enum(["open", "complete", "expired"]) });
const portalInputSchema = z.object({ identityId: z.uuid() }).strict();
const portalResultSchema = z.object({ url: hostedUrlSchema });
const billingDetailsSchema = z.object({
  environment: environmentSchema,
  checkoutAvailable: z.boolean(),
  premiumAiMonthlyMessages: z.number().int().nonnegative().nullable(),
  checkoutUnavailableReason: z.enum(["purchases_disabled", "existing_subscription", "checkout_pending"]).nullable(),
  basePrice: z.object({ currency: z.string().regex(/^[a-z]{3}$/), unitAmount: z.number().int().nonnegative(),
    interval: z.literal("month"), taxBehavior: z.literal("inclusive") }).nullable(),
  trialEligible: z.boolean().nullable(),
  customers: z.array(z.object({ identityId: z.uuid(), environment: environmentSchema,
    managementAvailable: z.boolean(), subscriptions: z.array(z.object({
      subscriptionId: z.string().min(1), status: z.enum(["active", "in_grace", "expired", "revoked"]),
      providerStatus: z.string().min(1), isTrial: z.boolean(), willRenew: z.boolean(), until: dateSchema,
      trialEnd: dateSchema.nullable(), cancelAt: dateSchema.nullable(), invalidated: z.boolean(),
    })) })),
  pendingCheckouts: z.array(z.object({ attemptId: z.uuid(), identityId: z.uuid(), sessionId: sessionIdSchema.nullable(),
    status: z.enum(["pending", "open"]), expiresAt: dateSchema })),
});

export type StripeBillingOffer = Pick<StripeBillingDetails,
  "environment" | "premiumAiMonthlyMessages" | "checkoutAvailable" | "checkoutUnavailableReason" | "basePrice" | "trialEligible">;

async function loadStripeHumanActor(request: Request, allowedOrigins: ReadonlyArray<string>): Promise<StripeHumanActor> {
  const { requestContext } = await loadRequestContextFromRequest(request, allowedOrigins, { allowWebGuestPlatform: true });
  if (requestContext.transport !== "bearer" && requestContext.transport !== "session") {
    throw new HttpError(403, "Link an email and sign in as a person to use Stripe billing.", "STRIPE_HUMAN_AUTH_REQUIRED");
  }
  if (requestContext.email === null || requestContext.email.trim() === "") {
    throw new HttpError(403, "Link an email before using Stripe billing.", "STRIPE_EMAIL_REQUIRED");
  }
  return { subject: requestContext.subjectUserId, userId: requestContext.userId };
}

function stripeHttpError(error: unknown): HttpError {
  if (error instanceof StripeBillingError) {
    const status = error.retryable || error.code === "STRIPE_BILLING_UNAVAILABLE"
      || error.code === "STRIPE_CONFIGURATION_INVALID" ? 503
      : error.code === "STRIPE_ACCOUNT_RETIRED" ? 410
        : error.code === "STRIPE_EMAIL_REQUIRED" || error.code === "STRIPE_IDENTITY_MISMATCH" ? 403
          : error.code === "STRIPE_RECOVERY_REQUIRED" || error.code === "STRIPE_STORAGE_CONFLICT" ? 409
            : error.code === "STRIPE_SIGNATURE_INVALID" ? 400 : 502;
    console.warn(JSON.stringify({ event: "stripe_billing_request_failed", errorCode: error.code, retryable: error.retryable }));
    return new HttpError(status, error.message, error.code);
  }
  // SDK, schema and database errors can contain private request or provider values.
  return new HttpError(503, "Stripe billing could not complete. Retry the same operation and use requestId if it persists.",
    "STRIPE_BILLING_UNAVAILABLE");
}

function parsePublicResult<Value>(schema: z.ZodType<Value>, value: Value): Value {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", true,
    "Stripe billing returned an invalid response. Retry the same operation.");
  return parsed.data;
}

async function parseStripeInput<Value>(request: Request, schema: z.ZodType<Value>): Promise<Value> {
  const body = await parseJsonBodyWithByteLimit(request, 4096,
    "Stripe billing request body exceeds 4096 bytes.", "STRIPE_BODY_TOO_LARGE");
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Invalid Stripe billing request fields.", "STRIPE_INPUT_INVALID");
  return parsed.data;
}

async function readStripeWebhookBytes(request: Request): Promise<Buffer> {
  const maximumBytes = 1_048_576;
  const tooLarge = (): HttpError => new HttpError(413, "Stripe webhook exceeds 1048576 bytes.", "STRIPE_BODY_TOO_LARGE");
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) throw tooLarge();
  if (request.body === null) throw new HttpError(400, "Stripe webhook body is required.", "STRIPE_PAYLOAD_INVALID");
  const reader = request.body.getReader();
  const chunks: Array<Buffer> = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

const webhookEnvelopeSchema = z.object({
  id: z.string().min(1), type: z.string().min(1), livemode: z.boolean(),
  api_version: z.string(), created: z.number().int().nonnegative(),
  data: z.object({ object: z.object({ id: z.string().min(1) }) }),
});

async function receiveStripeWebhook(request: Request, environment: StripeEnvironment): Promise<void> {
  const signature = request.headers.get("stripe-signature");
  if (signature === null || signature.length === 0 || signature.length > 4096) {
    throw new HttpError(400, "A valid Stripe-Signature header is required.", "STRIPE_SIGNATURE_INVALID");
  }
  let rawBody: Buffer;
  try {
    rawBody = await readStripeWebhookBytes(request);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Stripe webhook body could not be read.", "STRIPE_PAYLOAD_INVALID");
  }
  try {
    if (!webhookEnvelopeSchema.safeParse(JSON.parse(rawBody.toString("utf8"))).success) {
      throw new Error("Invalid envelope");
    }
  } catch {
    throw new HttpError(400, "Stripe webhook payload is invalid.", "STRIPE_PAYLOAD_INVALID");
  }
  try {
    // The service verifies the signature, environment and API pin before retaining any payload.
    await handleStripeWebhook(environment, rawBody, signature);
  } catch (error) {
    if (error instanceof StripeBillingError && !error.retryable
      && (error.code === "STRIPE_SIGNATURE_INVALID" || error.code === "STRIPE_IDENTITY_MISMATCH"
        || error.code === "STRIPE_RESPONSE_INVALID")) {
      throw new HttpError(400, "Stripe webhook signature, payload, account, environment or API version is invalid.", error.code);
    }
    throw stripeHttpError(error);
  }
}

export function createStripeBillingRoutes(options: Readonly<{ allowedOrigins: ReadonlyArray<string> }>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("/billing/stripe/*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  for (const [path, environment] of [[stripeWebhookPaths[0], "sandbox"], [stripeWebhookPaths[1], "production"]] as const) {
    app.post(path, async (context) => {
      await receiveStripeWebhook(context.req.raw, environment);
      return context.body(null, 204);
    });
  }
  app.get("/billing/stripe/offer", async (context) => {
    const actor = await loadStripeHumanActor(context.req.raw, options.allowedOrigins);
    try {
      const details = parsePublicResult<StripeBillingDetails>(billingDetailsSchema, await getStripeBillingDetails(actor));
      const offer: StripeBillingOffer = {
        premiumAiMonthlyMessages: details.premiumAiMonthlyMessages,
        environment: details.environment, checkoutAvailable: details.checkoutAvailable,
        checkoutUnavailableReason: details.checkoutUnavailableReason, basePrice: details.basePrice,
        trialEligible: details.trialEligible,
      };
      return context.json(offer);
    } catch (error) { throw stripeHttpError(error); }
  });
  app.get("/billing/stripe/subscriptions", async (context) => {
    const actor = await loadStripeHumanActor(context.req.raw, options.allowedOrigins);
    try {
      return context.json(parsePublicResult<StripeBillingDetails>(billingDetailsSchema, await getStripeBillingDetails(actor)));
    } catch (error) { throw stripeHttpError(error); }
  });
  app.post("/billing/stripe/checkout", async (context) => {
    const actor = await loadStripeHumanActor(context.req.raw, options.allowedOrigins);
    await parseStripeInput(context.req.raw, z.object({}).strict());
    try {
      return context.json(parsePublicResult(checkoutResultSchema, await createStripeCheckout(actor)));
    } catch (error) { throw stripeHttpError(error); }
  });
  app.post("/billing/stripe/checkout/return", async (context) => {
    const actor = await loadStripeHumanActor(context.req.raw, options.allowedOrigins);
    const input = await parseStripeInput(context.req.raw, checkoutReturnInputSchema);
    try {
      return context.json(parsePublicResult(checkoutReturnResultSchema, await reconcileStripeCheckoutReturn(actor, input)));
    } catch (error) { throw stripeHttpError(error); }
  });
  app.post("/billing/stripe/portal", async (context) => {
    const actor = await loadStripeHumanActor(context.req.raw, options.allowedOrigins);
    const input = await parseStripeInput(context.req.raw, portalInputSchema);
    try {
      return context.json(parsePublicResult(portalResultSchema, await createStripePortal(actor, input.identityId)));
    } catch (error) { throw stripeHttpError(error); }
  });
  return app;
}
