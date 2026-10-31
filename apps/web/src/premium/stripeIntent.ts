import { isAnalyticsEnabledForCurrentRuntime, isAwaitingAnalyticsConsentDecision, isProductAnalyticsCollectionEnabled, type AnalyticsPaywallEntryPoint } from "../analytics";
import { ApiContractError, parseObject, parseString } from "../apiContracts/core";
import { parseStripeSessionId, parseStripeUuid } from "../apiContracts/stripeBilling";
import { validatedPricingCountry } from "./regionalCountry";
import type { SessionInfo } from "../types";

const intentKey = "flashcards-stripe-intent";
const invalidationKey = "flashcards-stripe-invalidation";
const invalidationEvent = "flashcards-stripe-invalidated";
let billingInvalidated = false;
let billingGeneration = 0;
let billingSession: Pick<SessionInfo, "userId" | "csrfToken"> | null = null;

export function readStripeBillingGeneration(): number {
  return billingGeneration;
}

export function activateVerifiedStripeBillingSession(session: Pick<SessionInfo, "userId" | "csrfToken">): void {
  // A rerender, preference update, or entitlement reset cannot re-arm the departing credential.
  if (billingSession?.userId === session.userId && billingSession.csrfToken === session.csrfToken) return;
  billingSession = { userId: session.userId, csrfToken: session.csrfToken };
  billingInvalidated = false;
}

export function isStripeBillingInvalidated(): boolean {
  return billingInvalidated;
}

export function invalidateStripeBilling(): void {
  billingInvalidated = true;
  billingGeneration += 1;
  window.dispatchEvent(new Event(invalidationEvent));
  try {
    clearStripeIntent();
    window.localStorage.setItem(invalidationKey, crypto.randomUUID());
  } catch {
    // A blocked storage write must not prevent the already-requested sign-out.
    console.error("Stripe intent cleanup failed", { code: "STRIPE_INTENT_CLEANUP_FAILED" });
  }
}

export function subscribeToStripeBillingInvalidation(listener: () => void): () => void {
  window.addEventListener(invalidationEvent, listener);
  return (): void => window.removeEventListener(invalidationEvent, listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event: StorageEvent): void => {
    if (event.key !== invalidationKey || event.newValue === null) return;
    billingInvalidated = true;
    billingGeneration += 1;
    window.dispatchEvent(new Event(invalidationEvent));
  });
}

export function canCollectPaywallAnalytics(): boolean {
  return isAnalyticsEnabledForCurrentRuntime() && isProductAnalyticsCollectionEnabled();
}

export type PaywallPresentation = Readonly<{ presentationId: string; entryPoint: AnalyticsPaywallEntryPoint }>;

export function parsePaywallPresentation(presentationId: unknown, entryPoint: unknown): PaywallPresentation {
  const entries: ReadonlyArray<AnalyticsPaywallEntryPoint> = ["subscription_settings", "ai_limit", "accent_color", "review_animations", "ai_chat_suggestions", "app_icon", "guest_return", "review", "ai_low_balance"];
  if (typeof entryPoint !== "string" || !entries.includes(entryPoint as AnalyticsPaywallEntryPoint)) {
    throw new ApiContractError("Premium return", "entryPoint", "paywall entry point");
  }
  return { presentationId: parseStripeUuid(presentationId, "Premium return", "presentationId"), entryPoint: entryPoint as AnalyticsPaywallEntryPoint };
}

export function readPaywallReturn(query: URLSearchParams): PaywallPresentation | null {
  if (!canCollectPaywallAnalytics() || !query.has("premium_presentation_id")) return null;
  return parsePaywallPresentation(query.get("premium_presentation_id"), query.get("premium_entry_point"));
}

export type PremiumContinuation = Readonly<{ accentColor: string; requiredRank: number }>;

function parsePremiumContinuation(value: unknown): PremiumContinuation {
  const pending = parseObject(value, "Premium continuation", "continuation");
  const color = parseString(pending.accentColor, "Premium continuation", "accentColor");
  if (!/^#[0-9A-F]{6}$/.test(color) || pending.requiredRank !== 20) {
    throw new ApiContractError("Premium continuation", "continuation", "accent color Premium intent");
  }
  return { accentColor: color, requiredRank: 20 };
}

export function readPremiumReturnContinuation(query: URLSearchParams): PremiumContinuation | null {
  return query.has("premium_accent_color")
    ? parsePremiumContinuation({ accentColor: query.get("premium_accent_color"), requiredRank: 20 }) : null;
}
export type StripeIntent = Readonly<{
  userId: string;
  checkoutAfterSignIn?: string | null;
  country?: string | null;
  attemptId: string | null;
  sessionId: string | null;
  continuation: PremiumContinuation | null;
  presentation?: PaywallPresentation | null;
  // The `checkout:attemptId` return already reported as `purchase_finished` for this attempt.
  reportedReturn: string | null;
}>;

export function clearStripeIntent(): void {
  window.localStorage.removeItem(intentKey);
}

export function storeStripeIntent(intent: StripeIntent): void {
  window.localStorage.setItem(intentKey, JSON.stringify({ ...intent, presentation: canCollectPaywallAnalytics() && !isAwaitingAnalyticsConsentDecision() ? intent.presentation : null }));
}

export function readStripeIntent(userId: string): StripeIntent | null {
  const raw = window.localStorage.getItem(intentKey);
  if (raw === null) return null;
  let decoded: unknown;
  try { decoded = JSON.parse(raw) as unknown; } catch {
    clearStripeIntent();
    throw new ApiContractError("localStorage", "stripeIntent", "valid JSON");
  }
  try {
    const value = parseObject(decoded, "localStorage", "stripeIntent");
    if (parseString(value.userId, "localStorage", "stripeIntent.userId") !== userId) {
      return null;
    }
    let continuation: PremiumContinuation | null = null;
    if (value.continuation !== null) {
      continuation = parsePremiumContinuation(value.continuation);
    }
    return {
      userId, continuation, country: validatedPricingCountry(value.country),
      checkoutAfterSignIn: value.checkoutAfterSignIn === undefined || value.checkoutAfterSignIn === null ? null
        : parseStripeUuid(value.checkoutAfterSignIn, "localStorage", "stripeIntent.checkoutAfterSignIn"),
      presentation: value.presentation === undefined || value.presentation === null || !canCollectPaywallAnalytics() ? null
        : parsePaywallPresentation(parseObject(value.presentation, "localStorage", "stripeIntent.presentation").presentationId,
          parseObject(value.presentation, "localStorage", "stripeIntent.presentation").entryPoint),
      attemptId: value.attemptId === null ? null : parseStripeUuid(value.attemptId, "localStorage", "stripeIntent.attemptId"),
      sessionId: value.sessionId === null ? null : parseStripeSessionId(value.sessionId, "localStorage", "stripeIntent.sessionId"),
      reportedReturn: value.reportedReturn === undefined || value.reportedReturn === null
        ? null : parseString(value.reportedReturn, "localStorage", "stripeIntent.reportedReturn"),
    };
  } catch (error) {
    clearStripeIntent();
    throw error;
  }
}

export function isCurrentStripeIntent(expected: StripeIntent): boolean {
  const current = readStripeIntent(expected.userId);
  return current !== null && current.attemptId === expected.attemptId && current.sessionId === expected.sessionId
    && (current.country ?? null) === (expected.country ?? null)
    && (current.checkoutAfterSignIn ?? null) === (expected.checkoutAfterSignIn ?? null)
    && current.continuation?.accentColor === expected.continuation?.accentColor
    && current.continuation?.requiredRank === expected.continuation?.requiredRank;
}

export function consumeStripeIntent(expected: StripeIntent): StripeIntent | null {
  if (!isCurrentStripeIntent(expected)) return null;
  clearStripeIntent();
  return expected;
}

export function consumeStripeContinuation(expected: StripeIntent): PremiumContinuation | null {
  if (!isCurrentStripeIntent(expected)) return null;
  storeStripeIntent({ ...expected, continuation: null });
  return expected.continuation;
}

export function storeGuestStripeCheckout(userId: string, continuation: PremiumContinuation | null, presentation: PaywallPresentation | null, country: string | null): string {
  const token = crypto.randomUUID();
  storeStripeIntent({ userId, checkoutAfterSignIn: token, continuation, presentation, country,
    attemptId: null, sessionId: null, reportedReturn: null });
  return token;
}

export function guestStripeCheckoutReturnUrl(sourceUserId: string): string | null {
  const intent = readStripeIntent(sourceUserId);
  if (intent?.checkoutAfterSignIn == null) return null;
  const url = new URL("/settings/subscription?premium=checkout", window.location.origin);
  url.searchParams.set("premium_checkout_token", intent.checkoutAfterSignIn);
  return url.toString();
}

export function bindGuestStripeCheckout(sourceUserId: string, destinationUserId: string): boolean {
  const query = new URLSearchParams(window.location.search);
  if (query.get("premium") !== "checkout") return true;
  const token = query.get("premium_checkout_token");
  if (token === null) return false;
  if (readStripeIntent(destinationUserId)?.checkoutAfterSignIn === token) return true;
  const intent = readStripeIntent(sourceUserId);
  if (intent?.checkoutAfterSignIn !== token) return false;
  storeStripeIntent({ ...intent, userId: destinationUserId });
  return true;
}

export function cancelGuestStripeCheckout(sourceUserId: string): void {
  const intent = readStripeIntent(sourceUserId);
  if (intent?.checkoutAfterSignIn == null) return;
  clearStripeIntent();
  const url = new URL(window.location.href);
  for (const key of ["premium", "premium_checkout_token", "premium_presentation_id", "premium_entry_point", "premium_accent_color"]) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url);
}

export function consumeGuestStripeCheckout(userId: string, token: string | null): StripeIntent | null {
  const intent = readStripeIntent(userId);
  if (token === null || intent?.checkoutAfterSignIn !== token) return null;
  const consumed = { ...intent, checkoutAfterSignIn: null };
  storeStripeIntent(consumed);
  return consumed;
}
