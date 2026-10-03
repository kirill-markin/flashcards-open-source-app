import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { unsafeTransaction } from "../../database/unsafe";
import { HttpError } from "../../shared/errors";
import { parseJsonBodyWithByteLimit } from "../../server/requestParsing";
import { GoogleBillingError, googlePackageName } from "./contracts";
import { GoogleProvider } from "./provider";
import {
  acknowledgeGoogleTransition, persistGoogleNotification, revokeKnownGoogleNotification,
  settleUnavailableGoogleToken,
} from "./service";
import { publishGoogleTransition } from "./facts";
import { finishGoogleNotification, readGoogleNotification, recordGoogleNotification } from "./store";

export const googleNotificationPath = "/billing/google/notifications";
const notificationAudience = "https://api.nibomo.com/v1/billing/google/notifications";
const pushServiceAccount = "nibomo-play-notifications@flashcards-open-source-app.iam.gserviceaccount.com";
const subscriptionResource = "projects/flashcards-open-source-app/subscriptions/nibomo-play-subscriptions-sub";
const pushVerifier = new OAuth2Client({
  transporterOptions: { timeout: 5_000, retry: true, retryConfig: { retry: 2, totalTimeout: 15_000 } },
});
const tokenSchema = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
const envelopeSchema = z.object({
  subscription: z.literal(subscriptionResource),
  message: z.object({
    messageId: z.string().regex(/^\d{1,128}$/),
    data: z.string().min(4).max(24_576).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }),
});
const notificationSchema = z.object({
  version: z.literal("1.0"),
  packageName: z.literal(googlePackageName),
  eventTimeMillis: z.string().regex(/^\d{1,16}$/).refine((value) =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 8_640_000_000_000_000),
  testNotification: z.object({ version: z.literal("1.0") }).optional(),
  subscriptionNotification: z.object({
    version: z.literal("1.0"),
    notificationType: z.number().int().min(1).max(1000),
    purchaseToken: tokenSchema,
  }).optional(),
  voidedPurchaseNotification: z.object({
    purchaseToken: tokenSchema,
    orderId: z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/),
    productType: z.number().int(),
    refundType: z.number().int(),
  }).optional(),
  oneTimeProductNotification: z.object({}).optional(),
  pendingRefundReviewNotification: z.object({}).optional(),
}).refine((value) => [value.testNotification, value.subscriptionNotification, value.voidedPurchaseNotification,
  value.oneTimeProductNotification, value.pendingRefundReviewNotification].filter((item) => item !== undefined).length === 1);
const knownSubscriptionTypes = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 19, 20, 22]);

export type GoogleNotification = Readonly<{
  eventId: string;
  eventType: string;
  occurredAt: Date;
  purchaseToken: string | null;
  revokedOrderId: string | null;
  kind: "test" | "subscription" | "revoked" | "voided" | "unsupported";
}>;

export async function authenticateGooglePush(request: Request): Promise<void> {
  const authorization = request.headers.get("authorization");
  if (authorization === null || authorization.length > 16_384
    || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) {
    throw new HttpError(401, "Google push requires a signed Bearer ID token.", "GOOGLE_PUSH_UNAUTHORIZED");
  }
  try {
    const ticket = await pushVerifier.verifyIdToken({
      idToken: authorization.slice(7), audience: notificationAudience,
    });
    const claims = ticket.getPayload();
    if (claims?.email !== pushServiceAccount || claims.email_verified !== true
      || claims.sub !== "117934371221231125176") {
      throw new HttpError(403, "Google push service account does not match.", "GOOGLE_PUSH_IDENTITY_INVALID");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // SDK verification errors can include the JWT; only the boundary's code may escape.
    console.warn(JSON.stringify({ event: "google_push_verification_failed" }));
    throw new HttpError(401, "Google push ID token could not be verified.", "GOOGLE_PUSH_UNAUTHORIZED");
  }
}

export async function decodeGooglePush(request: Request): Promise<GoogleNotification> {
  const envelope = envelopeSchema.safeParse(await parseJsonBodyWithByteLimit(request, 32_768,
    "Google push body exceeds 32768 bytes.", "GOOGLE_PUSH_BODY_TOO_LARGE"));
  if (!envelope.success) {
    throw new HttpError(400, "Google push envelope or subscription is invalid.", "GOOGLE_PUSH_ENVELOPE_INVALID");
  }
  let decoded: unknown;
  try {
    const bytes = Buffer.from(envelope.data.message.data, "base64");
    if (bytes.toString("base64") !== envelope.data.message.data) throw new Error("Noncanonical base64");
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new HttpError(400, "Google push data must be base64-encoded UTF-8 JSON.", "GOOGLE_PUSH_DATA_INVALID");
  }
  const notification = notificationSchema.safeParse(decoded);
  if (!notification.success) {
    throw new HttpError(400, "Google notification package or event shape is invalid.", "GOOGLE_NOTIFICATION_INVALID");
  }
  const data = notification.data;
  const common = { eventId: envelope.data.message.messageId, occurredAt: new Date(Number(data.eventTimeMillis)) };
  if (common.occurredAt.getTime() > Date.now() + 300_000) {
    throw new HttpError(400, "Google notification timestamp is in the future.", "GOOGLE_NOTIFICATION_TIME_INVALID");
  }
  if (data.testNotification !== undefined) {
    return { ...common, eventType: "test", kind: "test", purchaseToken: null, revokedOrderId: null };
  }
  if (data.subscriptionNotification !== undefined) {
    const item = data.subscriptionNotification;
    const supported = knownSubscriptionTypes.has(item.notificationType);
    return { ...common, eventType: `subscription:${item.notificationType}`,
      kind: !supported ? "unsupported" : item.notificationType === 12 ? "revoked" : "subscription",
      purchaseToken: supported ? item.purchaseToken : null, revokedOrderId: null };
  }
  if (data.voidedPurchaseNotification !== undefined) {
    const item = data.voidedPurchaseNotification;
    const supported = item.productType === 1 && item.refundType === 1;
    return { ...common, eventType: supported ? "voided:subscription" : "unsupported:voided",
      kind: supported ? "voided" : "unsupported", purchaseToken: supported ? item.purchaseToken : null,
      revokedOrderId: supported ? item.orderId : null };
  }
  return { ...common, eventType: "unsupported:notification", kind: "unsupported",
    purchaseToken: null, revokedOrderId: null };
}

export async function processGoogleNotification(notification: GoogleNotification): Promise<void> {
  if (await unsafeTransaction((executor) => readGoogleNotification(executor, notification))) {
    console.info(JSON.stringify({ event: "google_notification_duplicate", eventId: notification.eventId }));
    return;
  }
  if (notification.purchaseToken === null) {
    await unsafeTransaction(async (executor) => {
      await recordGoogleNotification(executor, notification, null, null);
      await finishGoogleNotification(executor, notification.eventId);
    });
    console.info(JSON.stringify({ event: notification.kind === "test"
      ? "google_test_notification_received" : "google_notification_unsupported",
    eventId: notification.eventId, eventType: notification.eventType }));
    return;
  }
  const provider = new GoogleProvider();
  const lookupStartedAt = new Date();
  // A token-scoped authenticated revocation is terminal even during a Play API outage.
  const knownRevocation = notification.kind === "revoked" ? await revokeKnownGoogleNotification(notification) : null;
  let transition = knownRevocation;
  if (transition === null) {
    try {
      transition = await persistGoogleNotification(provider, notification);
    } catch (error) {
      if (!(error instanceof GoogleBillingError) || error.code !== "GOOGLE_PROVIDER_FAILED"
        || (error.httpStatus !== 404 && error.httpStatus !== 410)) throw error;
      // An old token can be outside Google's lookup window. Only a stored, correlated
      // terminal event can be applied without a fresh response.
      transition = await revokeKnownGoogleNotification(notification);
      if (transition === null) {
        transition = await settleUnavailableGoogleToken(notification.purchaseToken, lookupStartedAt, error.httpStatus, notification);
        if (transition === null) throw error;
        await publishGoogleTransition(transition);
        await unsafeTransaction((executor) => finishGoogleNotification(executor, notification.eventId));
        console.info(JSON.stringify({ event: "google_notification_token_unavailable", eventId: notification.eventId,
          purchaseId: transition.purchase.purchase_id, providerHttpStatus: error.httpStatus }));
        return;
      }
    }
  }
  if (transition !== null) {
    await publishGoogleTransition(transition);
    await acknowledgeGoogleTransition(provider, transition);
  }
  await unsafeTransaction((executor) => finishGoogleNotification(executor, notification.eventId));
  console.info(JSON.stringify({ event: "google_notification_processed", eventId: notification.eventId,
    eventType: notification.eventType, purchaseId: transition?.purchase.purchase_id ?? null }));
}
