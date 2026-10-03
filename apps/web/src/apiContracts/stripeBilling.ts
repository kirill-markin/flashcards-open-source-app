import {
  ApiContractError, parseArray, parseBoolean, parseEnum, parseLiteral, parseNonNegativeInteger,
  parseNullableBoolean, parseObject, parseRequiredField, parseString, type ValueParser,
} from "./core";

export type StripeEnvironment = "production" | "sandbox";
export type StripeOffer = Readonly<{
  environment: StripeEnvironment;
  checkoutAvailable: boolean;
  premiumAiMonthlyMessages: number | null;
  checkoutUnavailableReason: "purchases_disabled" | "existing_subscription" | "checkout_pending" | null;
  basePrice: Readonly<{ currency: string; unitAmount: number; interval: "month"; taxBehavior: "inclusive" }> | null;
  trialEligible: boolean | null;
}>;
export type StripeSubscription = Readonly<{
  subscriptionId: string; status: "active" | "in_grace" | "expired" | "revoked";
  providerStatus: string; isTrial: boolean; willRenew: boolean; until: string;
  trialEnd: string | null; cancelAt: string | null; invalidated: boolean;
}>;
export type StripeCustomer = Readonly<{
  identityId: string; environment: StripeEnvironment; managementAvailable: boolean;
  subscriptions: ReadonlyArray<StripeSubscription>;
}>;
export type StripeDetails = StripeOffer & Readonly<{
  customers: ReadonlyArray<StripeCustomer>;
  pendingCheckouts: ReadonlyArray<Readonly<{
    attemptId: string; identityId: string; sessionId: string | null;
    status: "pending" | "open"; expiresAt: string;
  }>>;
}>;
export type StripeCheckout =
  | Readonly<{ outcome: "checkout"; attemptId: string; sessionId: string; url: string; expiresAt: string; trialDays: 0 | 7 }>
  | Readonly<{ outcome: "existing_subscription"; identityId: string }>
  | Readonly<{ outcome: "complete"; attemptId: string; sessionId: string }>;
export type StripeCheckoutReturn = Readonly<{ attemptId: string; sessionId: string; status: "open" | "complete" | "expired" }>;

export function parseStripeUuid(value: unknown, endpoint: string, path: string): string {
  const text = parseString(value, endpoint, path);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new ApiContractError(endpoint, path, "UUID");
  }
  return text;
}

export function parseStripeSessionId(value: unknown, endpoint: string, path: string): string {
  const text = parseString(value, endpoint, path);
  if (text.length > 255 || !/^cs_[A-Za-z0-9_]+$/.test(text)) throw new ApiContractError(endpoint, path, "Checkout session ID");
  return text;
}

function parseDate(value: unknown, endpoint: string, path: string): string {
  const text = parseString(value, endpoint, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new ApiContractError(endpoint, path, "ISO date");
  }
  return text;
}

function nullable<Value>(parser: ValueParser<Value>): ValueParser<Value | null> {
  return (value, endpoint, path) => value === null ? null : parser(value, endpoint, path);
}

function parseEnvironment(value: unknown, endpoint: string, path: string): StripeEnvironment {
  return parseEnum(value, endpoint, path, ["production", "sandbox"]);
}

function parseNonemptyString(value: unknown, endpoint: string, path: string): string {
  const text = parseString(value, endpoint, path);
  if (text.length === 0) throw new ApiContractError(endpoint, path, "nonempty string");
  return text;
}

function parseHostedUrl(value: unknown, endpoint: string, path: string): string {
  const text = parseString(value, endpoint, path);
  let url: URL;
  try { url = new URL(text); } catch { throw new ApiContractError(endpoint, path, "HTTPS hosted URL"); }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new ApiContractError(endpoint, path, "HTTPS hosted URL without credentials");
  }
  return url.href;
}

export function parseStripeOffer(value: unknown, endpoint: string, path: string): StripeOffer {
  const object = parseObject(value, endpoint, path);
  const field = <Value,>(key: string, parser: ValueParser<Value>): Value => parseRequiredField(object, key, endpoint, path, parser);
  return {
    environment: field("environment", parseEnvironment),
    checkoutAvailable: field("checkoutAvailable", parseBoolean),
    premiumAiMonthlyMessages: field("premiumAiMonthlyMessages", nullable(parseNonNegativeInteger)),
    checkoutUnavailableReason: field("checkoutUnavailableReason", nullable((v, e, p) => parseEnum(v, e, p,
      ["purchases_disabled", "existing_subscription", "checkout_pending"]))),
    trialEligible: field("trialEligible", parseNullableBoolean),
    basePrice: field("basePrice", nullable((v, e, p) => {
      const price = parseObject(v, e, p);
      const currency = parseRequiredField(price, "currency", e, p, parseString);
      if (!/^[a-z]{3}$/.test(currency)) throw new ApiContractError(e, `${p}.currency`, "three-letter currency");
      return {
        currency,
        unitAmount: parseRequiredField(price, "unitAmount", e, p, parseNonNegativeInteger),
        interval: parseRequiredField(price, "interval", e, p, (v1, e1, p1) => parseLiteral(v1, e1, p1, "month")),
        taxBehavior: parseRequiredField(price, "taxBehavior", e, p, (v1, e1, p1) => parseLiteral(v1, e1, p1, "inclusive")),
      };
    })),
  };
}

function parseSubscription(value: unknown, endpoint: string, path: string): StripeSubscription {
  const object = parseObject(value, endpoint, path);
  const field = <Value,>(key: string, parser: ValueParser<Value>): Value => parseRequiredField(object, key, endpoint, path, parser);
  return {
    subscriptionId: field("subscriptionId", parseNonemptyString),
    status: field("status", (v, e, p) => parseEnum(v, e, p, ["active", "in_grace", "expired", "revoked"])),
    providerStatus: field("providerStatus", parseNonemptyString), isTrial: field("isTrial", parseBoolean),
    willRenew: field("willRenew", parseBoolean), until: field("until", parseDate),
    trialEnd: field("trialEnd", nullable(parseDate)), cancelAt: field("cancelAt", nullable(parseDate)),
    invalidated: field("invalidated", parseBoolean),
  };
}

export function parseStripeDetails(value: unknown, endpoint: string, path: string): StripeDetails {
  const object = parseObject(value, endpoint, path);
  return {
    ...parseStripeOffer(value, endpoint, path),
    customers: parseRequiredField(object, "customers", endpoint, path, (v, e, p) => parseArray(v, e, p, (v1, e1, p1) => {
      const customer = parseObject(v1, e1, p1);
      return {
        identityId: parseRequiredField(customer, "identityId", e1, p1, parseStripeUuid),
        environment: parseRequiredField(customer, "environment", e1, p1, parseEnvironment),
        managementAvailable: parseRequiredField(customer, "managementAvailable", e1, p1, parseBoolean),
        subscriptions: parseRequiredField(customer, "subscriptions", e1, p1, (v2, e2, p2) => parseArray(v2, e2, p2, parseSubscription)),
      };
    })),
    pendingCheckouts: parseRequiredField(object, "pendingCheckouts", endpoint, path, (v, e, p) => parseArray(v, e, p, (v1, e1, p1) => {
      const attempt = parseObject(v1, e1, p1);
      return {
        attemptId: parseRequiredField(attempt, "attemptId", e1, p1, parseStripeUuid),
        identityId: parseRequiredField(attempt, "identityId", e1, p1, parseStripeUuid),
        sessionId: parseRequiredField(attempt, "sessionId", e1, p1, nullable(parseStripeSessionId)),
        status: parseRequiredField(attempt, "status", e1, p1, (v2, e2, p2) => parseEnum(v2, e2, p2, ["pending", "open"])),
        expiresAt: parseRequiredField(attempt, "expiresAt", e1, p1, parseDate),
      };
    })),
  };
}

export function parseStripeCheckout(value: unknown, endpoint: string, path: string): StripeCheckout {
  const object = parseObject(value, endpoint, path);
  const outcome = parseRequiredField(object, "outcome", endpoint, path,
    (v, e, p) => parseEnum<StripeCheckout["outcome"]>(v, e, p, ["checkout", "complete", "existing_subscription"]));
  if (outcome === "existing_subscription") return { outcome, identityId: parseRequiredField(object, "identityId", endpoint, path, parseStripeUuid) };
  const identity = {
    attemptId: parseRequiredField(object, "attemptId", endpoint, path, parseStripeUuid),
    sessionId: parseRequiredField(object, "sessionId", endpoint, path, parseStripeSessionId),
  };
  if (outcome === "complete") return { outcome, ...identity };
  return {
    outcome, ...identity, url: parseRequiredField(object, "url", endpoint, path, parseHostedUrl),
    expiresAt: parseRequiredField(object, "expiresAt", endpoint, path, parseDate),
    trialDays: parseRequiredField(object, "trialDays", endpoint, path, (v, e, p) => parseEnum(v, e, p, [0, 7])),
  };
}

export function parseStripePortal(value: unknown, endpoint: string, path: string): Readonly<{ url: string }> {
  const object = parseObject(value, endpoint, path);
  return { url: parseRequiredField(object, "url", endpoint, path, parseHostedUrl) };
}

export function parseStripeCheckoutReturn(value: unknown, endpoint: string, path: string): StripeCheckoutReturn {
  const object = parseObject(value, endpoint, path);
  return {
    attemptId: parseRequiredField(object, "attemptId", endpoint, path, parseStripeUuid),
    sessionId: parseRequiredField(object, "sessionId", endpoint, path, parseStripeSessionId),
    status: parseRequiredField(object, "status", endpoint, path, (v, e, p) => parseEnum(v, e, p, ["open", "complete", "expired"])),
  };
}
