import { z } from "zod";
import type Stripe from "stripe";
import type { DatabaseExecutor } from "../../database";
import { unsafeTransaction } from "../../database/unsafe";
import { StripeBillingError, type StripeEnvironment } from "./contracts";
import { resolveStripeCopyLocale, stripeEmailCopy } from "./copy/catalog";
import { requireStripeEmailData, stripeEmailNoticeSchema, type StripeEmailNotice } from "./emailProjection";
import type { StripeProvider } from "./provider";
import type { StripeEventReference } from "./state";
import { lockStripeIdentityForLifecycleInExecutor, lockStripePurchasesInExecutor, readStripePurchaseInExecutor } from "./store";

const requestSchema = z.object({
  from: z.string().min(1), to: z.array(z.email()).length(1),
  subject: z.string().min(1).max(998), text: z.string().min(1),
});
type EmailRequest = Readonly<z.infer<typeof requestSchema>>;
type Delivery = Readonly<{
  identity_id: string;
  request_body: EmailRequest | null;
  notice: StripeEmailNotice | null;
  first_attempt_at: Date;
  sent_at: Date | null;
  stopped_at: Date | null;
  last_error: string | null;
}>;
const deliveryColumns = "identity_id, request_body, notice, first_attempt_at, sent_at, stopped_at, last_error";
const safeRetryWindowMs = 23 * 60 * 60 * 1000;
// Stripe charge units differ from Intl currency display precision for ISK/UGX and HUF/TWD.
const zeroDecimalCurrencies = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"]);
const threeDecimalCurrencies = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

function formatAmount(notice: StripeEmailNotice, locale: string): string {
  const decimals = zeroDecimalCurrencies.has(notice.currency) ? 0 : threeDecimalCurrencies.has(notice.currency) ? 3 : 2;
  requireStripeEmailData(!["isk", "ugx"].includes(notice.currency) || notice.amount % 100 === 0);
  return new Intl.NumberFormat(locale, { style: "currency", currency: notice.currency,
    currencyDisplay: "code", minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    .format(notice.amount / 10 ** decimals);
}

function buildRequest(notice: StripeEmailNotice, email: string, locale: string): EmailRequest {
  const sender = z.email().safeParse(process.env.RESEND_FROM_EMAIL?.trim());
  if (!sender.success) throw new StripeBillingError("STRIPE_BILLING_UNAVAILABLE", true,
    "Billing email requires a valid RESEND_FROM_EMAIL in the HTTP backend runtime.");
  const copy = stripeEmailCopy(locale);
  const template = notice.kind === "trial" ? "trialReminder" : notice.kind === "payment" ? "paymentReceipt" : "refundReceipt";
  const date = notice.trialEnd === null ? "" : new Intl.DateTimeFormat(locale, {
    dateStyle: "full", timeStyle: "long", timeZone: "UTC",
  }).format(new Date(notice.trialEnd * 1000));
  const text = copy[`email.${template}Body`].replaceAll("{price}", formatAmount(notice, locale))
    .replaceAll("{date}", date).replaceAll("{url}", notice.url);
  const request = requestSchema.safeParse({ from: `Nibomo <${sender.data}>`, to: [email],
    subject: copy[`email.${template}Subject`], text });
  requireStripeEmailData(request.success);
  return request.data;
}

async function suppressPendingTrialDeliveries(
  executor: DatabaseExecutor, environment: StripeEnvironment, identityId: string, subscriptionId: string,
): Promise<void> {
  // A committed reservation may have reached Resend even without a recorded result.
  await executor.query(`UPDATE billing.stripe_email_deliveries SET stopped_at = now(),
    request_body = NULL, notice = NULL, last_error = COALESCE(last_error, 'STRIPE_EMAIL_RECOVERY_REQUIRED')
    WHERE environment = $1 AND identity_id = $2 AND subscription_id = $3 AND kind = 'trial'
      AND sent_at IS NULL AND stopped_at IS NULL`, [environment, identityId, subscriptionId]);
}

async function loadNotices(
  executor: DatabaseExecutor, provider: StripeProvider, customerId: string, identityId: string,
  eventType: Stripe.Event.Type, reference: StripeEventReference,
): Promise<ReadonlyArray<StripeEmailNotice>> {
  if ((eventType === "invoice.paid" || eventType === "invoice.payment_succeeded") && reference.kind === "invoice") {
    const notice = await provider.retrievePaymentNotice(reference.objectId, customerId);
    return notice === null ? [] : [notice];
  }
  if (eventType === "customer.subscription.trial_will_end" && reference.kind === "subscription") {
    const notice = await provider.retrieveTrialNotice(reference.objectId, customerId);
    if (notice === null) {
      await suppressPendingTrialDeliveries(executor, provider.environment, identityId, reference.objectId);
    }
    return notice === null ? [] : [notice];
  }
  if (["charge.refunded", "charge.refund.updated", "refund.created", "refund.updated"].includes(eventType)
    && reference.kind === "charge") return provider.retrieveRefundNotices(reference.objectId, customerId);
  return [];
}

async function lockRecipient(
  executor: DatabaseExecutor, provider: StripeProvider, customerId: string, subscriptionIds: ReadonlyArray<string>,
): Promise<Readonly<{ identityId: string; locale: string }> | null> {
  const locked = await lockStripeIdentityForLifecycleInExecutor(executor, provider.environment, customerId);
  if (locked === null || locked.accountKind !== "account") return null;
  await lockStripePurchasesInExecutor(executor, provider.environment, subscriptionIds);
  for (const subscriptionId of subscriptionIds) {
    const purchase = await readStripePurchaseInExecutor(executor, provider.environment, subscriptionId);
    if (purchase === null || purchase.user_id !== locked.identity.userId
      || purchase.account_deleted_at !== null || purchase.invalidated_at !== null) return null;
  }
  const profile = await executor.query<{ locale: string }>(
    "SELECT locale FROM org.user_settings WHERE user_id = $1", [locked.identity.userId]);
  requireStripeEmailData(profile.rows[0] !== undefined);
  return { identityId: locked.identity.identityId, locale: resolveStripeCopyLocale(profile.rows[0].locale) };
}

async function sendRequest(request: EmailRequest, idempotencyKey: string): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new StripeBillingError("STRIPE_BILLING_UNAVAILABLE", true,
    "Billing email requires RESEND_API_KEY in the HTTP backend runtime.");
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(request), signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new StripeBillingError("STRIPE_EMAIL_FAILED", true,
      "The billing email send result is unknown. Retry the same delivery inside its idempotency window.");
  }
  let body: unknown;
  try { body = await response.json(); } catch {
    throw new StripeBillingError("STRIPE_EMAIL_FAILED", true,
      "The billing email provider returned an unreadable result. Retry the same delivery inside its idempotency window.");
  }
  if (response.ok) {
    const result = z.object({ id: z.uuid() }).safeParse(body);
    if (!result.success) throw new StripeBillingError("STRIPE_EMAIL_FAILED", true,
      "The billing email provider returned no valid message identifier. Reconcile the send result before its retry window expires.");
    return result.data.id;
  }
  const failure = z.object({ name: z.string() }).safeParse(body);
  if (response.status === 409 && failure.success && failure.data.name === "invalid_idempotent_request") {
    throw new StripeBillingError("STRIPE_EMAIL_RECOVERY_REQUIRED", false,
      "The billing email idempotency key has a different provider payload. Reconcile this delivery without changing its key.");
  }
  const retryable = response.status === 429 || response.status >= 500
    || (response.status === 409 && failure.success && failure.data.name === "concurrent_idempotent_requests");
  throw new StripeBillingError("STRIPE_EMAIL_FAILED", retryable,
    `Billing email provider rejected the request (HTTP ${response.status}). Check sender configuration or retry the same delivery.`);
}

async function sendWithRetries(request: EmailRequest, idempotencyKey: string, firstAttemptAt: Date): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    if (Date.now() - firstAttemptAt.getTime() >= safeRetryWindowMs) {
      throw new StripeBillingError("STRIPE_EMAIL_RECOVERY_REQUIRED", false,
        "The billing email send result is unresolved beyond its safe retry window. Reconcile with Resend; do not issue a new key.");
    }
    try { return await sendRequest(request, idempotencyKey); } catch (error) {
      if (!(error instanceof StripeBillingError) || !error.retryable || attempt === 3) throw error;
      console.warn(JSON.stringify({ event: "stripe_email_retry", attempt, errorCode: error.code }));
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
}

async function deliverNotice(
  provider: StripeProvider, customerId: string, notice: StripeEmailNotice,
): Promise<void> {
  const environment: StripeEnvironment = provider.environment;
  const key = [environment, notice.kind, notice.entityId];
  // Reserve stable bytes and the retry clock durably BEFORE the first possible provider side effect.
  await unsafeTransaction(async (executor) => {
    const recipient = await lockRecipient(executor, provider, customerId, [notice.subscriptionId]);
    if (recipient === null) return;
    const existing = await executor.query<Delivery>(`SELECT ${deliveryColumns} FROM billing.stripe_email_deliveries
      WHERE environment = $1 AND kind = $2 AND entity_id = $3`, key);
    if (existing.rows.length > 0) return;
    const email = await provider.retrieveBillingEmail(customerId);
    const request = buildRequest(notice, email, recipient.locale);
    await executor.query(`INSERT INTO billing.stripe_email_deliveries
      (environment, kind, entity_id, identity_id, subscription_id, request_body, notice)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) ON CONFLICT DO NOTHING`,
    [...key, recipient.identityId, notice.subscriptionId, JSON.stringify(request), JSON.stringify(notice)]);
  });
  const failure = await unsafeTransaction(async (executor): Promise<StripeBillingError | null> => {
    const recipient = await lockRecipient(executor, provider, customerId, [notice.subscriptionId]);
    if (recipient === null) return null;
    const result = await executor.query<Delivery>(`SELECT ${deliveryColumns} FROM billing.stripe_email_deliveries
      WHERE environment = $1 AND kind = $2 AND entity_id = $3 FOR UPDATE`, key);
    const delivery = result.rows[0];
    if (delivery === undefined || delivery.sent_at !== null) return null;
    if (delivery.stopped_at !== null) {
      if (delivery.last_error === null) return null;
      return new StripeBillingError("STRIPE_EMAIL_RECOVERY_REQUIRED", false,
        "Billing email delivery is stopped. Reconcile its stored error and provider result before any manual action.");
    }
    try {
      requireStripeEmailData(delivery.identity_id === recipient.identityId);
      const request = requestSchema.safeParse(delivery.request_body);
      const original = stripeEmailNoticeSchema.safeParse(delivery.notice);
      requireStripeEmailData(request.success && original.success);
      const billingEmail = await provider.retrieveBillingEmail(customerId);
      requireStripeEmailData(billingEmail === request.data.to[0]);
      if (notice.kind === "trial") {
        const current = await provider.retrieveTrialNotice(notice.subscriptionId, customerId);
        if (current === null) {
          await suppressPendingTrialDeliveries(executor, environment, recipient.identityId, notice.subscriptionId);
          return null;
        }
        requireStripeEmailData(current.entityId === original.data.entityId && current.trialEnd === original.data.trialEnd
          && current.amount === original.data.amount && current.currency === original.data.currency);
      }
      // Provider reads may consume the connection's idle budget; the bounded send starts a fresh one.
      await executor.query("SELECT 1", []);
      const id = await sendWithRetries(request.data, `nibomo:${environment}:${notice.kind}:${notice.entityId}`, delivery.first_attempt_at);
      await executor.query(`UPDATE billing.stripe_email_deliveries SET sent_at = now(), provider_message_id = $4,
        request_body = NULL, notice = NULL, last_error = NULL WHERE environment = $1 AND kind = $2 AND entity_id = $3`, [...key, id]);
      return null;
    } catch (error) {
      if (!(error instanceof StripeBillingError)) throw error;
      // Commit the failure separately from the already committed entitlement update.
      await executor.query(`UPDATE billing.stripe_email_deliveries SET last_error = $4,
        stopped_at = CASE WHEN $5 THEN NULL ELSE now() END,
        request_body = CASE WHEN $5 THEN request_body ELSE NULL END,
        notice = CASE WHEN $5 THEN notice ELSE NULL END
        WHERE environment = $1 AND kind = $2 AND entity_id = $3`, [...key, error.code, error.retryable]);
      return error;
    }
  });
  if (failure !== null) throw failure;
}

export async function dispatchStripeLifecycleEmails(
  provider: StripeProvider, customerId: string, eventType: Stripe.Event.Type,
  reference: StripeEventReference, subscriptionIds: ReadonlyArray<string>,
): Promise<void> {
  if (subscriptionIds.length === 0 || !["invoice.paid", "invoice.payment_succeeded",
    "customer.subscription.trial_will_end", "charge.refunded", "charge.refund.updated", "refund.created", "refund.updated"].includes(eventType)) return;
  const notices = await unsafeTransaction(async (executor) => {
    const recipient = await lockRecipient(executor, provider, customerId, subscriptionIds);
    if (recipient === null) return [];
    return loadNotices(executor, provider, customerId, recipient.identityId, eventType, reference);
  });
  const failures: Array<StripeBillingError> = [];
  for (const notice of notices) {
    try {
      await deliverNotice(provider, customerId, notice);
    } catch (error) {
      failures.push(error instanceof StripeBillingError ? error : new StripeBillingError("STRIPE_EMAIL_FAILED", true,
        "Billing email delivery could not be completed. Retry the same delivery."));
    }
  }
  if (failures.length > 0) {
    const retryable = failures.some((failure) => failure.retryable);
    const errorCodes = [...new Set(failures.map((failure) => failure.code))].join(", ");
    throw new StripeBillingError(retryable ? "STRIPE_EMAIL_FAILED" : "STRIPE_EMAIL_RECOVERY_REQUIRED", retryable,
      `${failures.length} billing email deliveries failed (${errorCodes}). All loaded notices were attempted. `
      + "Retry pending deliveries with their original keys; reconcile stopped deliveries before any manual action.");
  }
}
