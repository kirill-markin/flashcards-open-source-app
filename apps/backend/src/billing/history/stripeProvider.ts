import type Stripe from "stripe";
import { z } from "zod";
import { matchesStripeCatalogPrice, type StripeCatalog } from "../stripe/catalog";
import { StripeBillingError, type StripeEnvironment } from "../stripe/contracts";
import { BillingHistoryError } from "./store";
import {
  stripeInvoiceHistorySchema, stripePaymentHistorySchema, stripeRefundHistorySchema,
  stripeSubscriptionHistorySchema, type StripeInvoiceHistory, type StripePaymentHistory,
  type StripeRefundChargeContext, type StripeRefundHistory, type StripeSubscriptionHistory,
} from "./stripe";

type StripeRequest = <Result>(operation: string, callback: () => Promise<Result>) => Promise<Result>;
export type StripeHistoryPage<Item> = Readonly<{
  data: ReadonlyArray<Item>;
  nextCursor: string | null;
}>;
export type StripeHistoryPayment = Readonly<{ invoice: StripeInvoiceHistory; payment: StripePaymentHistory }>;
export type StripeHistoryRefund = Readonly<{ charge: StripeRefundChargeContext; refund: StripeRefundHistory }>;
type NativeDecimalField = Readonly<{ unit_amount_decimal?: string | null }>;
type NativeSubscriptionItem = Omit<Stripe.SubscriptionItem, "price"> & Readonly<{
  price: Omit<Stripe.Price, "unit_amount_decimal"> & NativeDecimalField;
}>;
type NativeSubscription = Omit<Stripe.Subscription, "items"> & Readonly<{
  items: Omit<Stripe.Subscription["items"], "data"> & Readonly<{ data: Array<NativeSubscriptionItem> }>;
}>;
type NativeInvoiceLine = Omit<Stripe.InvoiceLineItem, "pricing"> & Readonly<{
  pricing?: (Omit<NonNullable<Stripe.InvoiceLineItem["pricing"]>, "unit_amount_decimal"> & NativeDecimalField) | null;
}>;
type NativeInvoice = Omit<Stripe.Invoice, "lines"> & Readonly<{
  lines: Omit<Stripe.Invoice["lines"], "data"> & Readonly<{ data: Array<NativeInvoiceLine> }>;
}>;

export class StripeHistoryBudgetExhausted extends Error {
  constructor() {
    super("Stripe history reached its request budget; resume its committed checkpoint on the next invocation.");
    this.name = "StripeHistoryBudgetExhausted";
  }
}

function objectId(value: string | Readonly<{ id: string }> | null): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function requireHistoryMatch(matches: boolean): void {
  if (!matches) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
    "Stripe history object does not match its verified Nibomo catalog, customer, parent or environment.");
}

function nativeDecimalString(value: Stripe.Decimal | string | null): string | null {
  return value === null || typeof value === "string" ? value : value.toJSON();
}

function normalizeSubscriptionDecimals(input: Stripe.Subscription): NativeSubscription {
  const data: Array<NativeSubscriptionItem> = input.items.data.map((item) => {
    const { unit_amount_decimal: amount, ...price } = item.price;
    return { ...item, price: { ...price,
      ...(amount === undefined ? {} : { unit_amount_decimal: nativeDecimalString(amount) }) } };
  });
  return { ...input, items: { ...input.items, data } };
}

function normalizeInvoiceDecimals(input: Stripe.Invoice): NativeInvoice {
  const data: Array<NativeInvoiceLine> = input.lines.data.map((line) => {
    const { pricing: sdkPricing, ...fields } = line;
    if (sdkPricing === undefined) return fields;
    if (sdkPricing === null) return { ...fields, pricing: null };
    const { unit_amount_decimal: amount, ...pricing } = sdkPricing;
    return { ...fields, pricing: { ...pricing,
      ...(amount === undefined ? {} : { unit_amount_decimal: nativeDecimalString(amount) }) } };
  });
  return { ...input, lines: { ...input.lines, data } };
}

function parseNative<Schema extends z.ZodType>(
  schema: Schema, object: NativeSubscription | NativeInvoice | Stripe.InvoicePayment | Stripe.Refund,
): z.output<Schema> {
  const result = schema.safeParse(object);
  if (!result.success) throw new BillingHistoryError("BILLING_HISTORY_INVALID",
    "Stripe history response has invalid fields: " + result.error.issues.map((issue) => issue.path.join(".")).join(", "));
  return result.data;
}

function pageCursor<Item extends Readonly<{ id: string }>>(page: Stripe.ApiList<Item>): string | null {
  const last = page.data.at(-1);
  if (page.has_more && last === undefined) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
    "Stripe history pagination returned an empty page with has_more=true.");
  return page.has_more ? last!.id : null;
}

// Only StripeProvider constructs this reader after verifying the account with its existing key.
export class StripeHistoryProvider {
  constructor(
    private readonly client: Stripe,
    readonly environment: StripeEnvironment,
    private readonly catalog: StripeCatalog,
    private readonly request: StripeRequest,
    private readonly deadlineAtMs: number,
    private readonly signal: AbortSignal,
  ) {}

  requireBudget(): void {
    this.signal.throwIfAborted();
    // Leave time for a retried SDK request and the page's database commit.
    if (Date.now() + 30_000 >= this.deadlineAtMs) throw new StripeHistoryBudgetExhausted();
  }

  private async read<Result>(operation: string, callback: () => Promise<Result>): Promise<Result> {
    this.requireBudget();
    const result = await this.request(operation, callback);
    this.signal.throwIfAborted();
    return result;
  }

  private requireEnvironment(object: Readonly<{ livemode: boolean }>): void {
    requireHistoryMatch(object.livemode === this.catalog.livemode);
  }

  private matchesPrice(price: Readonly<{ id: string; product: string | Readonly<{ id: string }> }>): boolean {
    const matchesId = this.catalog.knownPrices.some((entry) => entry.priceId === price.id);
    const matchesProduct = objectId(price.product) === this.catalog.productId;
    if (matchesId !== matchesProduct) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
      "Stripe history contains an unconfigured price for the Nibomo product. Verify the catalog before importing.");
    return matchesId && matchesProduct;
  }

  private async completeSubscription(input: Stripe.Subscription): Promise<Stripe.Subscription> {
    this.requireEnvironment(input);
    if (!input.items.has_more) return input;
    const items: Array<Stripe.SubscriptionItem> = [];
    let cursor: string | null = null;
    do {
      const page = await this.read("history subscription items", () => this.client.subscriptionItems.list({
        subscription: input.id, limit: 100, ...(cursor === null ? {} : { starting_after: cursor }),
      }));
      for (const item of page.data) {
        requireHistoryMatch(item.subscription === input.id);
        items.push(item);
      }
      cursor = pageCursor(page);
    } while (cursor !== null);
    return { ...input, items: { ...input.items, data: items, has_more: false } };
  }

  private ownsSubscription(subscription: Stripe.Subscription): boolean {
    const matches = subscription.items.data.map((item) => {
      this.requireEnvironment(item.price);
      const matches = this.matchesPrice(item.price);
      if (matches) requireHistoryMatch(matchesStripeCatalogPrice(this.catalog, item.price));
      return matches;
    });
    if (!matches.some(Boolean)) return false;
    requireHistoryMatch(matches.every(Boolean) && objectId(subscription.customer) !== null);
    return true;
  }

  async subscriptionsPage(cursor: string | null, requestedTo: Date): Promise<StripeHistoryPage<StripeSubscriptionHistory>> {
    const page = await this.read("history subscriptions", () => this.client.subscriptions.list({
      status: "all", limit: 20,
      created: { gte: 0, lt: requestedTo.getTime() / 1000 },
      ...(cursor === null ? {} : { starting_after: cursor }),
    }));
    const data: Array<StripeSubscriptionHistory> = [];
    for (const input of page.data) {
      const subscription = await this.completeSubscription(input);
      if (this.ownsSubscription(subscription)) {
        data.push(parseNative(stripeSubscriptionHistorySchema, normalizeSubscriptionDecimals(subscription)));
      }
    }
    return { data, nextCursor: pageCursor(page) };
  }

  private async completeInvoice(input: Stripe.Invoice): Promise<Stripe.Invoice> {
    this.requireEnvironment(input);
    if (!input.lines.has_more) return input;
    const lines: Array<Stripe.InvoiceLineItem> = [];
    let cursor: string | null = null;
    do {
      const page = await this.read("history invoice lines", () => this.client.invoices.listLineItems(input.id, {
        limit: 100, ...(cursor === null ? {} : { starting_after: cursor }),
      }));
      for (const line of page.data) {
        requireHistoryMatch(line.invoice === input.id);
        lines.push(line);
      }
      cursor = pageCursor(page);
    } while (cursor !== null);
    return { ...input, lines: { ...input.lines, data: lines, has_more: false } };
  }

  private async scopedInvoice(input: Stripe.Invoice): Promise<StripeInvoiceHistory | null> {
    // Global subscription/invoice lists omit test clocks; keep all source scopes consistent.
    if (this.environment === "sandbox" && input.test_clock !== null) return null;
    const invoice = await this.completeInvoice(input);
    const matches = invoice.lines.data.map((line) => {
      const details = line.pricing?.price_details;
      return details !== undefined && details !== null
        && this.matchesPrice({ id: objectId(details.price)!, product: details.product });
    });
    const subscriptionId = objectId(invoice.parent?.subscription_details?.subscription ?? null);
    let ownsParent = false;
    if (subscriptionId !== null) {
      const parent = await this.completeSubscription(await this.read("history invoice subscription", () =>
        this.client.subscriptions.retrieve(subscriptionId)));
      requireHistoryMatch(objectId(parent.customer) === objectId(invoice.customer));
      ownsParent = this.ownsSubscription(parent);
    }
    if (!ownsParent && !matches.some(Boolean)) return null;
    requireHistoryMatch(objectId(invoice.customer) !== null && (matches.length === 0 || matches.every(Boolean)));
    return parseNative(stripeInvoiceHistorySchema, normalizeInvoiceDecimals(invoice));
  }

  async invoicesPage(cursor: string | null, requestedTo: Date): Promise<StripeHistoryPage<StripeInvoiceHistory>> {
    const page = await this.read("history invoices", () => this.client.invoices.list({
      limit: 20, created: { gte: 0, lt: requestedTo.getTime() / 1000 },
      ...(cursor === null ? {} : { starting_after: cursor }),
    }));
    const data: Array<StripeInvoiceHistory> = [];
    for (const input of page.data) {
      const invoice = await this.scopedInvoice(input);
      if (invoice !== null) data.push(invoice);
    }
    return { data, nextCursor: pageCursor(page) };
  }

  private async paymentContext(payment: Stripe.InvoicePayment): Promise<StripeHistoryPayment | null> {
    this.requireEnvironment(payment);
    const invoiceId = objectId(payment.invoice);
    requireHistoryMatch(invoiceId !== null);
    const invoice = await this.scopedInvoice(await this.read("history payment invoice", () =>
      this.client.invoices.retrieve(invoiceId!)));
    if (invoice === null) return null;
    if (payment.status === "paid") {
      requireHistoryMatch(payment.amount_paid !== null && payment.amount_paid >= 0
        && payment.status_transitions.paid_at !== null && payment.currency === invoice.currency);
    }
    return { invoice, payment: parseNative(stripePaymentHistorySchema, payment) };
  }

  async paymentsPage(cursor: string | null, requestedTo: Date): Promise<StripeHistoryPage<StripeHistoryPayment>> {
    const page = await this.read("history invoice payments", () => this.client.invoicePayments.list({
      limit: 20, created: { gte: 0, lt: requestedTo.getTime() / 1000 },
      ...(cursor === null ? {} : { starting_after: cursor }),
    }));
    const data: Array<StripeHistoryPayment> = [];
    for (const input of page.data) {
      const payment = await this.paymentContext(input);
      if (payment !== null) data.push(payment);
    }
    return { data, nextCursor: pageCursor(page) };
  }

  async refundsPage(cursor: string | null, requestedTo: Date): Promise<StripeHistoryPage<Stripe.Refund>> {
    const page = await this.read("history refunds", () => this.client.refunds.list({
      limit: 20, created: { gte: 0, lt: requestedTo.getTime() / 1000 },
      ...(cursor === null ? {} : { starting_after: cursor }),
    }));
    return { data: page.data, nextCursor: pageCursor(page) };
  }

  async refundContext(input: Stripe.Refund, directPaymentIds: ReadonlyArray<string>): Promise<StripeHistoryRefund | null> {
    const chargeId = objectId(input.charge);
    // Refunds funded without a charge cannot belong to the charge-backed Nibomo rail.
    if (chargeId === null) return null;
    const charge = await this.read("history refund charge", () => this.client.charges.retrieve(chargeId));
    this.requireEnvironment(charge);
    const intentId = objectId(charge.payment_intent);
    requireHistoryMatch(objectId(input.payment_intent) === intentId);
    const payments: Array<Stripe.InvoicePayment> = [];
    if (intentId === null) {
      for (const id of directPaymentIds) payments.push(await this.read("history direct charge payment", () =>
        this.client.invoicePayments.retrieve(id)));
    } else {
      let cursor: string | null = null;
      do {
        const page = await this.read("history charge invoice payments", () => this.client.invoicePayments.list({
          payment: { type: "payment_intent", payment_intent: intentId }, limit: 100,
          ...(cursor === null ? {} : { starting_after: cursor }),
        }));
        payments.push(...page.data);
        cursor = pageCursor(page);
      } while (cursor !== null);
    }
    let nibomoAmount = 0;
    let outsideCatalog = false;
    for (const payment of payments) {
      requireHistoryMatch(intentId === null ? objectId(payment.payment.charge ?? null) === charge.id
        : objectId(payment.payment.payment_intent ?? null) === intentId);
      const context = await this.paymentContext(payment);
      if (context === null) {
        outsideCatalog = true;
        continue;
      }
      requireHistoryMatch(objectId(context.invoice.customer) === objectId(charge.customer));
      if (payment.status === "paid" && payment.amount_paid !== null) nibomoAmount += payment.amount_paid;
    }
    if (nibomoAmount === 0) return null;
    // A shared charge cannot be allocated to Nibomo using a guessed refund proportion.
    requireHistoryMatch(!outsideCatalog && charge.paid && charge.captured && charge.status === "succeeded"
      && nibomoAmount === charge.amount_captured && objectId(charge.customer) !== null
      && input.currency === charge.currency);
    return { charge: { object: "charge", id: charge.id, customer: objectId(charge.customer)!,
      livemode: charge.livemode, payment_intent: intentId }, refund: parseNative(stripeRefundHistorySchema, input) };
  }
}
