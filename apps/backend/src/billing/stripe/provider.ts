import Stripe from "stripe";
import { requireStripeEmailData, stripeEmailNoticeSchema, stripeTransactionAmount, type StripeEmailNotice } from "./emailProjection";
import { stripeCheckoutCustomText } from "./checkoutPresentation";
import { z } from "zod";
import { loadStripeEnvironmentSecret, parseStripeBillingSecret } from "./config";
import {
  stripeApiVersion, stripeCatalog, stripeCheckoutSuccessUrl, stripePremiumMonthlyAmount,
  stripeSubscriptionReturnUrl, type StripeCatalog,
} from "./catalog";
import {
  StripeBillingError, type StripeCheckoutAttempt, type StripeCustomerIdentity,
  type StripeEnvironment, type StripeEnvironmentSecret, type StripeInvoiceFinancialState,
} from "./contracts";

function objectId(value: string | Readonly<{ id: string }> | null): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function requireMatch(matches: boolean): void {
  if (!matches) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
    "Stripe object does not match the expected Nibomo customer, catalog or environment.");
}

async function callStripe<Result>(operation: string, callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof StripeBillingError) throw error;
    const status = error instanceof Stripe.errors.StripeError ? error.statusCode : undefined;
    const retryable = error instanceof Stripe.errors.StripeConnectionError
      || status === 409 || status === 429 || (status !== undefined && status >= 500);
    // No SDK message, raw response, request parameters or cause: all may echo secret/PII input.
    const diagnostic = status === undefined ? "transport or SDK failure" : `HTTP ${status}`;
    console.warn(JSON.stringify({ event: "stripe_provider_failed", operation, status: status ?? null, retryable }));
    throw new StripeBillingError("STRIPE_PROVIDER_FAILED", retryable,
      `Stripe ${operation} failed (${diagnostic}). Check runtime permissions and provider availability.`);
  }
}

export async function loadStripeProvider(environment: StripeEnvironment): Promise<StripeProvider> {
  return StripeProvider.create(environment, await loadStripeEnvironmentSecret(environment));
}

export class StripeProvider {
  readonly #client: Stripe;
  readonly #signingSecret: string;
  readonly #catalog: StripeCatalog;

  private constructor(readonly environment: StripeEnvironment, secret: StripeEnvironmentSecret) {
    this.#catalog = stripeCatalog[environment];
    this.#signingSecret = secret.webhookSigningSecret;
    this.#client = new Stripe(secret.apiKey, {
      apiVersion: stripeApiVersion, maxNetworkRetries: 2, timeout: 10_000,
      telemetry: false, emitEventBodies: false, appInfo: { name: "Nibomo" },
    });
    this.#client.on("response", (response: Stripe.ResponseEvent) => {
      if (response.status === 409 || response.status === 429 || response.status >= 500) {
        console.warn(JSON.stringify({ event: "stripe_provider_retryable_response", status: response.status,
          environment: this.environment }));
      }
    });
  }

  static async create(environment: StripeEnvironment, secret: StripeEnvironmentSecret): Promise<StripeProvider> {
    parseStripeBillingSecret(JSON.stringify({ [environment]: secret }));
    const provider = new StripeProvider(environment, secret);
    const account = await callStripe("verify account", () => provider.#client.accounts.retrieve(null));
    requireMatch(account.id === stripeCatalog[environment].accountId);
    return provider;
  }

  private requireEnvironment(value: Readonly<{ livemode: boolean }>): void {
    requireMatch(value.livemode === this.#catalog.livemode);
  }

  private requirePrice(price: Stripe.Price): void {
    this.requireEnvironment(price);
    requireMatch(price.id === this.#catalog.priceId && objectId(price.product) === this.#catalog.productId
      && price.currency === "usd" && price.unit_amount === stripePremiumMonthlyAmount
      && price.tax_behavior === "inclusive" && price.type === "recurring"
      && price.recurring?.interval === "month" && price.recurring.interval_count === 1
      && price.recurring.usage_type === "licensed");
  }

  async retrieveKnownPrice(): Promise<Stripe.Price> {
    const price = await callStripe("retrieve price", () => this.#client.prices.retrieve(this.#catalog.priceId));
    this.requirePrice(price);
    requireMatch(price.active);
    return price;
  }

  async retrieveCustomer(customerId: string): Promise<Stripe.Customer> {
    const customer = await callStripe("retrieve customer", () => this.#client.customers.retrieve(customerId));
    if (customer.deleted) throw new StripeBillingError("STRIPE_ACCOUNT_RETIRED", false,
      "The Stripe customer was deleted; reconcile its durable billing identity before purchasing.");
    this.requireEnvironment(customer);
    requireMatch(customer.id === customerId && customer.metadata.application === "nibomo");
    return customer;
  }

  // The identity reservation must already be committed; the lifecycle lock stays held across this call.
  async createOrRecoverCustomer(identity: StripeCustomerIdentity): Promise<Stripe.Customer> {
    requireMatch(identity.environment === this.environment && identity.accountDeletedAt === null
      && z.uuid().safeParse(identity.identityId).success);
    if (identity.customerId !== null) {
      const customer = await this.retrieveCustomer(identity.customerId);
      requireMatch(customer.metadata.nibomo_identity_id === identity.identityId);
      return customer;
    }
    // Stripe may prune idempotency keys after 24 hours. Never POST an old unresolved reservation.
    if (Date.now() - identity.createdAt.getTime() >= 23 * 60 * 60 * 1000) {
      const result = await callStripe("recover customer", () => this.#client.customers.search({
        query: `metadata['nibomo_identity_id']:'${identity.identityId}' AND metadata['application']:'nibomo'`, limit: 2,
      }));
      if (result.data.length !== 1 || result.has_more) {
        throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", false,
          "The Stripe customer creation window expired. Reconcile the reserved identity before another creation attempt.");
      }
      const customer = result.data[0];
      this.requireEnvironment(customer);
      requireMatch(customer.metadata.nibomo_identity_id === identity.identityId && customer.metadata.application === "nibomo");
      return customer;
    }
    const customer = await callStripe("create customer", () => this.#client.customers.create({
      metadata: { application: "nibomo", nibomo_identity_id: identity.identityId },
    }, { idempotencyKey: `nibomo:customer:${this.environment}:${identity.identityId}` }));
    this.requireEnvironment(customer);
    requireMatch(customer.metadata.nibomo_identity_id === identity.identityId && customer.metadata.application === "nibomo");
    return customer;
  }

  private async validateCheckout(session: Stripe.Checkout.Session, customerId: string): Promise<Stripe.Checkout.Session> {
    this.requireEnvironment(session);
    requireMatch(session.mode === "subscription" && objectId(session.customer) === customerId
      && session.metadata?.application === "nibomo");
    const lines = await callStripe("retrieve checkout lines", () =>
      this.#client.checkout.sessions.listLineItems(session.id, { limit: 2 }));
    requireMatch(!lines.has_more && lines.data.length === 1 && lines.data[0].quantity === 1);
    const price = lines.data[0].price;
    if (price === null) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
      "Stripe Checkout returned no recurring price.");
    this.requirePrice(price);
    return session;
  }

  async retrieveCheckout(sessionId: string, customerId: string): Promise<Stripe.Checkout.Session> {
    const session = await callStripe("retrieve checkout", () => this.#client.checkout.sessions.retrieve(sessionId));
    return this.validateCheckout(session, customerId);
  }

  async listCheckouts(customerId: string): Promise<ReadonlyArray<Stripe.Checkout.Session>> {
    const sessions = await callStripe("list checkouts", async () => {
      const result: Array<Stripe.Checkout.Session> = [];
      for await (const session of this.#client.checkout.sessions.list({ customer: customerId, limit: 100 })) {
        this.requireEnvironment(session);
        if (session.metadata?.application === "nibomo") result.push(session);
      }
      return result;
    });
    const result: Array<Stripe.Checkout.Session> = [];
    for (const session of sessions) result.push(await this.validateCheckout(session, customerId));
    return result;
  }

  async createCheckout(attempt: StripeCheckoutAttempt): Promise<Stripe.Checkout.Session> {
    requireMatch(attempt.environment === this.environment && attempt.accountDeletedAt === null
      && attempt.status !== "abandoned" && z.uuid().safeParse(attempt.attemptId).success
      && (attempt.trialDays === 0 || attempt.trialDays === 7));
    if (attempt.sessionId !== null) {
      const session = await this.retrieveCheckout(attempt.sessionId, attempt.customerId);
      requireMatch(session.client_reference_id === attempt.attemptId);
      return session;
    }
    // The absolute expiry and frozen parameters are reused on every POST, including an ambiguous retry.
    if (attempt.expiresAt.getTime() <= Date.now() + 30 * 60 * 1000) {
      const matches = (await this.listCheckouts(attempt.customerId))
        .filter((session) => session.client_reference_id === attempt.attemptId);
      if (matches.length === 1) return matches[0];
      throw new StripeBillingError("STRIPE_RECOVERY_REQUIRED", false,
        "The Checkout creation window expired. Reconcile this attempt before reserving another.");
    }
    await this.retrieveKnownPrice();
    const customer = await this.retrieveCustomer(attempt.customerId);
    requireMatch(customer.metadata.nibomo_identity_id === attempt.identityId);
    const metadata = { application: "nibomo", nibomo_checkout_attempt_id: attempt.attemptId };
    const session = await callStripe("create checkout", () => this.#client.checkout.sessions.create({
      mode: "subscription", customer: attempt.customerId, client_reference_id: attempt.attemptId,
      line_items: [{ price: this.#catalog.priceId, quantity: 1 }],
      automatic_tax: { enabled: true }, adaptive_pricing: { enabled: true },
      payment_method_collection: "always", customer_update: { address: "auto", name: "auto" },
      branding_settings: { display_name: "Nibomo", icon: { type: "file", file: this.#catalog.iconFileId } },
      subscription_data: { metadata, billing_mode: { type: "flexible" }, ...(attempt.trialDays === 7 ? {
        trial_period_days: 7, trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      } : {}) },
      custom_text: stripeCheckoutCustomText(attempt.locale),
      metadata, locale: attempt.locale, expires_at: Math.floor(attempt.expiresAt.getTime() / 1000),
      success_url: `${stripeCheckoutSuccessUrl}&checkout=success&checkout_attempt_id=${attempt.attemptId}`,
      cancel_url: `${stripeSubscriptionReturnUrl}?checkout=cancelled&checkout_attempt_id=${attempt.attemptId}`,
    }, { idempotencyKey: `nibomo:checkout:${this.environment}:${attempt.attemptId}` }));
    requireMatch(session.client_reference_id === attempt.attemptId);
    return this.validateCheckout(session, attempt.customerId);
  }

  async expireCheckout(sessionId: string, customerId: string): Promise<Stripe.Checkout.Session> {
    const session = await this.retrieveCheckout(sessionId, customerId);
    if (session.status !== "open") return session;
    const expired = await callStripe("expire checkout", () => this.#client.checkout.sessions.expire(sessionId, {},
      { idempotencyKey: `nibomo:expire:${this.environment}:${sessionId}` }));
    return this.validateCheckout(expired, customerId);
  }

  async createPortal(
    customerId: string, operationId: string, locale: Stripe.BillingPortal.SessionCreateParams.Locale,
  ): Promise<Stripe.BillingPortal.Session> {
    requireMatch(z.uuid().safeParse(operationId).success);
    await this.retrieveCustomer(customerId);
    const session = await callStripe("create portal", () => this.#client.billingPortal.sessions.create({
      customer: customerId, configuration: this.#catalog.portalConfigurationId, locale,
      return_url: `${stripeSubscriptionReturnUrl}?portal=returned`,
    }, { idempotencyKey: `nibomo:portal:${this.environment}:${operationId}` }));
    requireMatch(session.customer === customerId && objectId(session.configuration) === this.#catalog.portalConfigurationId);
    return session;
  }

  private validateSubscription(subscription: Stripe.Subscription, customerId: string): Stripe.Subscription {
    this.requireEnvironment(subscription);
    requireMatch(objectId(subscription.customer) === customerId && !subscription.items.has_more
      && subscription.items.data.length === 1 && subscription.items.data[0].quantity === 1);
    this.requirePrice(subscription.items.data[0].price);
    // API 2026-09-30.endive exposes the paid-through date on the item, not the subscription.
    requireMatch(Number.isSafeInteger(subscription.items.data[0].current_period_end));
    return subscription;
  }

  async retrieveSubscription(subscriptionId: string, customerId: string): Promise<Stripe.Subscription> {
    const subscription = await callStripe("retrieve subscription", () => this.#client.subscriptions.retrieve(subscriptionId));
    return this.validateSubscription(subscription, customerId);
  }

  async listSubscriptions(customerId: string): Promise<ReadonlyArray<Stripe.Subscription>> {
    return callStripe("list subscriptions", async () => {
      const result: Array<Stripe.Subscription> = [];
      for await (const subscription of this.#client.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
        this.requireEnvironment(subscription);
        if (subscription.items.data.some((item) => item.price.id === this.#catalog.priceId
          || objectId(item.price.product) === this.#catalog.productId)) {
          result.push(this.validateSubscription(subscription, customerId));
        }
      }
      return result;
    });
  }

  // Trial eligibility belongs to the customer, even if another product once granted its trial.
  async retrieveFirstCustomerTrial(
    customerId: string,
  ): Promise<Readonly<{ subscriptionId: string; consumedAt: Date }> | null> {
    return callStripe("retrieve customer trial history", async () => {
      let earliest: Readonly<{ subscriptionId: string; consumedAt: Date }> | null = null;
      for await (const subscription of this.#client.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
        this.requireEnvironment(subscription);
        requireMatch(objectId(subscription.customer) === customerId);
        const start = subscription.trial_start;
        const end = subscription.trial_end;
        if (start === null || end === null || end <= start || start * 1000 > Date.now()) continue;
        requireMatch(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > 0);
        const consumedAt = new Date(start * 1000);
        if (earliest === null || consumedAt.getTime() < earliest.consumedAt.getTime()) {
          earliest = { subscriptionId: subscription.id, consumedAt };
        }
      }
      return earliest;
    });
  }

  async cancelSubscription(subscriptionId: string, customerId: string): Promise<Stripe.Subscription> {
    const subscription = await this.retrieveSubscription(subscriptionId, customerId);
    if (subscription.status === "canceled") return subscription;
    const canceled = await callStripe("cancel subscription", () => this.#client.subscriptions.cancel(subscriptionId,
      { invoice_now: false, prorate: false }));
    return this.validateSubscription(canceled, customerId);
  }

  async retrieveInvoice(invoiceId: string, customerId: string): Promise<Stripe.Invoice> {
    const invoice = await callStripe("retrieve invoice", () => this.#client.invoices.retrieve(invoiceId));
    this.requireEnvironment(invoice);
    requireMatch(objectId(invoice.customer) === customerId);
    const subscriptionId = objectId(invoice.parent?.subscription_details?.subscription ?? null);
    if (subscriptionId === null) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
      "Stripe invoice is not linked to a Nibomo subscription.");
    await this.retrieveSubscription(subscriptionId, customerId);
    return invoice;
  }

  async retrieveCharge(chargeId: string, customerId: string): Promise<Stripe.Charge> {
    const charge = await callStripe("retrieve charge", () => this.#client.charges.retrieve(chargeId));
    this.requireEnvironment(charge);
    requireMatch(objectId(charge.customer) === customerId);
    const paymentIntent = objectId(charge.payment_intent);
    if (paymentIntent === null) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
      "Stripe charge has no subscription invoice payment intent.");
    const payments = await callStripe("list invoice payments", async () => {
      const result: Array<Stripe.InvoicePayment> = [];
      for await (const payment of this.#client.invoicePayments.list({
        payment: { type: "payment_intent", payment_intent: paymentIntent }, limit: 100,
      })) result.push(payment);
      return result;
    });
    requireMatch(payments.length > 0);
    for (const payment of payments) {
      this.requireEnvironment(payment);
      const invoiceId = objectId(payment.invoice);
      requireMatch(invoiceId !== null);
      if (invoiceId !== null) await this.retrieveInvoice(invoiceId, customerId);
    }
    return charge;
  }

  // Attribution probes return only identifiers; callers must resolve our durable identity before
  // retaining an event, and validate the Nibomo subscription before writing a purchase.
  async retrieveChargeCustomerId(chargeId: string): Promise<string | null> {
    const charge = await callStripe("attribute charge", () => this.#client.charges.retrieve(chargeId));
    this.requireEnvironment(charge);
    return objectId(charge.customer);
  }

  async retrieveChargeSubscriptionIds(chargeId: string, customerId: string): Promise<ReadonlyArray<string>> {
    const charge = await callStripe("retrieve charge attribution", () => this.#client.charges.retrieve(chargeId));
    this.requireEnvironment(charge);
    requireMatch(objectId(charge.customer) === customerId);
    const paymentIntentId = objectId(charge.payment_intent);
    if (paymentIntentId === null) {
      return callStripe("list direct charge subscriptions", async () => {
        const ids = new Set<string>();
        for await (const invoice of this.#client.invoices.list({ customer: customerId, limit: 100 })) {
          this.requireEnvironment(invoice);
          requireMatch(objectId(invoice.customer) === customerId);
          const subscriptionId = objectId(invoice.parent?.subscription_details?.subscription ?? null);
          if (subscriptionId === null) continue;
          for await (const payment of this.#client.invoicePayments.list({ invoice: invoice.id, limit: 100 })) {
            this.requireEnvironment(payment);
            requireMatch(objectId(payment.invoice) === invoice.id);
            if (objectId(payment.payment.charge ?? null) === chargeId) ids.add(subscriptionId);
          }
        }
        return [...ids];
      });
    }
    return callStripe("list charge subscriptions", async () => {
      const ids = new Set<string>();
      for await (const payment of this.#client.invoicePayments.list({
        payment: { type: "payment_intent", payment_intent: paymentIntentId }, limit: 100,
      })) {
        this.requireEnvironment(payment);
        const invoiceId = objectId(payment.invoice);
        if (invoiceId === null) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
          "Stripe invoice payment has no invoice identifier.");
        const invoice = await this.#client.invoices.retrieve(invoiceId);
        this.requireEnvironment(invoice);
        requireMatch(objectId(invoice.customer) === customerId);
        const subscriptionId = objectId(invoice.parent?.subscription_details?.subscription ?? null);
        if (subscriptionId !== null) ids.add(subscriptionId);
      }
      return [...ids];
    });
  }

  async retrieveSubscriptionFinancialState(
    subscription: Stripe.Subscription, customerId: string,
  ): Promise<StripeInvoiceFinancialState> {
    this.validateSubscription(subscription, customerId);
    return callStripe("retrieve subscription financial state", async () => {
      const item = subscription.items.data[0];
      let currentInvoice: Stripe.Invoice | null = null;
      let firstPaidAt: Date | null = null;
      let firstPaidInvoiceId: string | null = null;
      for await (const invoice of this.#client.invoices.list({ subscription: subscription.id, limit: 100 })) {
        this.requireEnvironment(invoice);
        requireMatch(objectId(invoice.customer) === customerId
          && objectId(invoice.parent?.subscription_details?.subscription ?? null) === subscription.id);
        if (invoice.status === "paid" && invoice.amount_paid > 0 && invoice.status_transitions.paid_at !== null) {
          requireMatch(Number.isSafeInteger(invoice.status_transitions.paid_at) && invoice.status_transitions.paid_at > 0);
          const paidAt = new Date(invoice.status_transitions.paid_at * 1000);
          if (firstPaidAt === null || paidAt < firstPaidAt) {
            firstPaidAt = paidAt;
            firstPaidInvoiceId = invoice.id;
          }
        }
        const lines: Array<Stripe.InvoiceLineItem> = [];
        if (invoice.lines.has_more) {
          for await (const line of this.#client.invoices.listLineItems(invoice.id, { limit: 100 })) lines.push(line);
        } else lines.push(...invoice.lines.data);
        if (lines.some((line) => line.parent?.subscription_item_details?.subscription_item === item.id
          && !line.parent.subscription_item_details.proration
          && line.period.start === item.current_period_start && line.period.end === item.current_period_end)
          && (currentInvoice === null || invoice.created > currentInvoice.created)) {
          currentInvoice = invoice;
        }
      }
      const payments: Array<StripeInvoiceFinancialState["payments"][number]> = [];
      if (currentInvoice !== null) {
        requireMatch(Number.isSafeInteger(currentInvoice.amount_paid) && currentInvoice.amount_paid >= 0);
        for await (const payment of this.#client.invoicePayments.list({
          invoice: currentInvoice.id, status: "paid", limit: 100,
        })) {
          this.requireEnvironment(payment);
          requireMatch(objectId(payment.invoice) === currentInvoice.id && payment.currency === currentInvoice.currency
            && payment.status === "paid" && Number.isSafeInteger(payment.amount_paid) && payment.amount_paid !== null
            && payment.amount_paid >= 0);
          if (payment.amount_paid === 0) continue;
          const charges: Array<Stripe.Charge> = [];
          const paymentIntentId = objectId(payment.payment.payment_intent ?? null);
          if (payment.payment.type === "payment_intent" && paymentIntentId !== null) {
            // Charges read permission is sufficient; no PaymentIntents runtime permission is needed.
            for await (const charge of this.#client.charges.list({
              customer: customerId, payment_intent: paymentIntentId, limit: 100,
            })) {
              if (charge.paid && charge.status === "succeeded") charges.push(charge);
            }
          } else if (payment.payment.type === "charge" && payment.payment.charge !== undefined) {
            const chargeId = objectId(payment.payment.charge);
            if (chargeId === null) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
              "Stripe invoice payment has no charge identifier.");
            charges.push(await this.#client.charges.retrieve(chargeId));
          } else {
            throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
              "Stripe invoice uses an unsupported payment rail. Reconcile this invoice before granting access.");
          }
          requireMatch(charges.length === 1);
          const charge = charges[0];
          this.requireEnvironment(charge);
          requireMatch(objectId(charge.customer) === customerId && charge.paid
            && charge.currency === payment.currency && charge.amount_captured === payment.amount_paid);
          const refunds: Array<Stripe.Refund> = [];
          for await (const refund of this.#client.refunds.list({ charge: charge.id, limit: 100 })) {
            requireMatch(objectId(refund.charge) === charge.id && refund.currency === charge.currency
              && Number.isSafeInteger(refund.amount) && refund.amount >= 0);
            refunds.push(refund);
          }
          const disputes: Array<Stripe.Dispute> = [];
          for await (const dispute of this.#client.disputes.list({ charge: charge.id, limit: 100 })) {
            this.requireEnvironment(dispute);
            requireMatch(objectId(dispute.charge) === charge.id);
            disputes.push(dispute);
          }
          payments.push({ payment, charge, refunds, disputes });
        }
      }
      return { invoice: currentInvoice, firstPaidAt, firstPaidInvoiceId, payments };
    });
  }

  async retrieveBillingEmail(customerId: string): Promise<string> {
    const customer = await this.retrieveCustomer(customerId);
    const email = z.email().safeParse(customer.email);
    requireStripeEmailData(email.success);
    return email.data;
  }

  async retrievePaymentNotice(invoiceId: string, customerId: string): Promise<StripeEmailNotice | null> {
    const invoice = await this.retrieveInvoice(invoiceId, customerId);
    if (invoice.status !== "paid" || invoice.amount_paid === 0) return null;
    const subscriptionId = objectId(invoice.parent?.subscription_details?.subscription ?? null);
    requireStripeEmailData(subscriptionId !== null && Number.isSafeInteger(invoice.amount_paid)
      && invoice.amount_paid > 0 && invoice.status_transitions.paid_at !== null);
    const subscription = await this.retrieveSubscription(subscriptionId, customerId);
    requireStripeEmailData(!invoice.lines.has_more && invoice.lines.data.length > 0
      && invoice.lines.data.every((line) => line.parent?.subscription_item_details?.subscription_item
        === subscription.items.data[0].id));
    const amounts = await callStripe("retrieve payment receipt amounts", async () => {
      const amounts: Array<Readonly<{ amount: number; currency: string }>> = [];
      let accountedAmount = 0;
      for await (const payment of this.#client.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 100 })) {
        this.requireEnvironment(payment);
        requireStripeEmailData(objectId(payment.invoice) === invoice.id && payment.status === "paid"
          && Number.isSafeInteger(payment.amount_paid) && payment.amount_paid !== null && payment.amount_paid >= 0
          && payment.currency === invoice.currency);
        if (payment.amount_paid === 0) continue;
        const charges: Array<Stripe.Charge> = [];
        const intentId = objectId(payment.payment.payment_intent ?? null);
        const chargeId = objectId(payment.payment.charge ?? null);
        if (payment.payment.type === "payment_intent" && intentId !== null) {
          for await (const charge of this.#client.charges.list({ customer: customerId, payment_intent: intentId, limit: 100 })) {
            if (charge.paid && charge.status === "succeeded") charges.push(charge);
          }
        } else if (payment.payment.type === "charge" && chargeId !== null) {
          charges.push(await this.#client.charges.retrieve(chargeId));
        }
        requireStripeEmailData(charges.length === 1);
        const charge = charges[0];
        this.requireEnvironment(charge);
        requireStripeEmailData(objectId(charge.customer) === customerId && charge.paid && charge.status === "succeeded"
          && charge.captured && charge.amount === charge.amount_captured && charge.amount_captured === payment.amount_paid
          && charge.currency === invoice.currency);
        const expectedCurrency = subscription.presentment_details?.presentment_currency ?? invoice.currency;
        requireStripeEmailData(expectedCurrency === charge.currency || charge.presentment_details !== undefined);
        accountedAmount += payment.amount_paid;
        amounts.push(stripeTransactionAmount(charge.amount_captured, charge.currency, charge.presentment_details));
      }
      requireStripeEmailData(accountedAmount === invoice.amount_paid && amounts.length > 0
        && amounts.every((amount) => amount.currency === amounts[0].currency));
      return amounts;
    });
    const notice = stripeEmailNoticeSchema.safeParse({
      kind: "payment", entityId: invoice.id, subscriptionId,
      amount: amounts.reduce((sum, value) => sum + value.amount, 0), currency: amounts[0].currency,
      url: invoice.hosted_invoice_url, trialEnd: null,
    });
    requireStripeEmailData(notice.success);
    return notice.data;
  }

  async retrieveRefundNotices(chargeId: string, customerId: string): Promise<ReadonlyArray<StripeEmailNotice>> {
    const subscriptionIds = await this.retrieveChargeSubscriptionIds(chargeId, customerId);
    requireStripeEmailData(subscriptionIds.length === 1);
    await this.retrieveSubscription(subscriptionIds[0], customerId);
    return callStripe("retrieve refund receipt amounts", async () => {
      const charge = await this.#client.charges.retrieve(chargeId);
      this.requireEnvironment(charge);
      requireStripeEmailData(objectId(charge.customer) === customerId && charge.paid && charge.status === "succeeded");
      const notices: Array<StripeEmailNotice> = [];
      for await (const refund of this.#client.refunds.list({ charge: charge.id, limit: 100 })) {
        requireStripeEmailData(objectId(refund.charge) === charge.id && refund.currency === charge.currency
          && Number.isSafeInteger(refund.amount) && refund.amount > 0);
        if (refund.status !== "succeeded") continue;
        // Never reconstruct partial-refund FX from the original charge or an exchange-rate estimate.
        requireStripeEmailData(charge.presentment_details === undefined || refund.presentment_details !== undefined);
        const amount = stripeTransactionAmount(refund.amount, refund.currency, refund.presentment_details);
        const notice = stripeEmailNoticeSchema.safeParse({ kind: "refund", entityId: refund.id,
          subscriptionId: subscriptionIds[0], ...amount, url: charge.receipt_url, trialEnd: null });
        requireStripeEmailData(notice.success && notice.data.amount > 0);
        notices.push(notice.data);
      }
      return notices;
    });
  }

  async retrieveTrialNotice(subscriptionId: string, customerId: string): Promise<StripeEmailNotice | null> {
    const subscription = await this.retrieveSubscription(subscriptionId, customerId);
    if (subscription.status !== "trialing" || subscription.trial_end === null
      || subscription.trial_end * 1000 <= Date.now() || subscription.cancel_at_period_end
      || subscription.cancel_at !== null || subscription.pause_collection !== null) return null;
    const latestInvoiceId = objectId(subscription.latest_invoice);
    requireStripeEmailData(latestInvoiceId !== null);
    const latest = await this.retrieveInvoice(latestInvoiceId, customerId);
    requireStripeEmailData(Number.isSafeInteger(latest.amount_paid) && latest.amount_paid >= 0
      && Number.isSafeInteger(latest.amount_due) && latest.amount_due >= 0
      && Number.isSafeInteger(latest.total));
    if (latest.status !== "paid" || latest.amount_paid > 0 || latest.amount_due > 0 || latest.total !== 0) return null;
    // The free trial invoice is normally paid at zero. A collected invoice must not trigger a future-charge reminder.
    const price = subscription.items.data[0].price;
    requireStripeEmailData(Number.isSafeInteger(subscription.trial_start) && subscription.trial_start !== null
      && subscription.trial_start > 0 && subscription.trial_start < subscription.trial_end);
    const confirmed = await this.retrieveSubscription(subscription.id, customerId);
    if (confirmed.status !== "trialing" || confirmed.trial_end !== subscription.trial_end
      || confirmed.trial_end * 1000 <= Date.now() || confirmed.cancel_at_period_end
      || confirmed.cancel_at !== null || confirmed.pause_collection !== null
      || objectId(confirmed.latest_invoice) !== latestInvoiceId) return null;
    const notice = stripeEmailNoticeSchema.safeParse({ kind: "trial",
      entityId: `${subscription.id}:${subscription.trial_start}`, subscriptionId: subscription.id,
      amount: price.unit_amount, currency: price.currency, url: stripeSubscriptionReturnUrl, trialEnd: subscription.trial_end });
    requireStripeEmailData(notice.success);
    return notice.data;
  }

  async retrieveRefund(refundId: string, customerId: string): Promise<Stripe.Refund> {
    const refund = await callStripe("retrieve refund", () => this.#client.refunds.retrieve(refundId));
    const chargeId = objectId(refund.charge);
    if (chargeId === null) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
      "Stripe refund has no subscription charge.");
    await this.retrieveCharge(chargeId, customerId);
    return refund;
  }

  async retrieveDispute(disputeId: string, customerId: string): Promise<Stripe.Dispute> {
    const dispute = await callStripe("retrieve dispute", () => this.#client.disputes.retrieve(disputeId));
    this.requireEnvironment(dispute);
    const chargeId = objectId(dispute.charge);
    if (chargeId === null) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
      "Stripe dispute has no subscription charge.");
    await this.retrieveCharge(chargeId, customerId);
    return dispute;
  }

  // Signature verification authenticates an envelope only; lifecycle handlers still retrieve and
  // validate its customer/product/price through the methods above before attributing any state.
  verifyWebhook(rawBody: Buffer, signature: string): Stripe.Event {
    let event: Stripe.Event;
    try {
      event = this.#client.webhooks.constructEvent(rawBody, signature, this.#signingSecret, 300);
    } catch {
      throw new StripeBillingError("STRIPE_SIGNATURE_INVALID", false,
        "Stripe webhook signature is invalid. Verify the endpoint signing secret and preserve the raw request bytes.");
    }
    this.requireEnvironment(event);
    requireMatch(event.account === undefined || event.account === this.#catalog.accountId);
    requireMatch(event.api_version === stripeApiVersion);
    return event;
  }
}
