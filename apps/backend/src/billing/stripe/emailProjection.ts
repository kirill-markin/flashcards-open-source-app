import { z } from "zod";
import { StripeBillingError } from "./contracts";

const minorAmount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[a-z]{3}$/);
export const stripePresentmentSchema = z.object({
  presentment_amount: minorAmount, presentment_currency: currency,
});
export const stripeEmailNoticeSchema = z.object({
  kind: z.enum(["trial", "payment", "refund"]),
  entityId: z.string().regex(/^[A-Za-z0-9_:]+$/).max(180),
  subscriptionId: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  amount: minorAmount, currency,
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === ""
      && ["invoice.stripe.com", "pay.stripe.com", "payments.stripe.com", "app.nibomo.com"].includes(url.hostname);
  }),
  trialEnd: z.number().int().positive().max(8_640_000_000_000).nullable(),
});
export type StripeEmailNotice = Readonly<z.infer<typeof stripeEmailNoticeSchema>>;

export function requireStripeEmailData(matches: boolean): asserts matches {
  if (!matches) throw new StripeBillingError("STRIPE_EMAIL_DATA_INVALID", false,
    "Stripe billing email data could not be verified. Reconcile the billing recipient, amount and hosted receipt before retrying.");
}

export function stripeTransactionAmount(
  amount: number, transactionCurrency: string,
  presentment: Readonly<{ presentment_amount: number; presentment_currency: string }> | undefined,
): Readonly<{ amount: number; currency: string }> {
  const parsed = stripePresentmentSchema.safeParse(presentment ?? {
    presentment_amount: amount, presentment_currency: transactionCurrency,
  });
  requireStripeEmailData(parsed.success);
  return { amount: parsed.data.presentment_amount, currency: parsed.data.presentment_currency };
}
