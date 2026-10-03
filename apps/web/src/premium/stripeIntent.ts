import { ApiContractError, parseObject, parseString } from "../apiContracts/core";
import { parseStripeSessionId, parseStripeUuid } from "../apiContracts/stripeBilling";
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

export type PremiumContinuation = Readonly<{ accentColor: string; requiredRank: number }>;
export type StripeIntent = Readonly<{
  userId: string;
  attemptId: string | null;
  sessionId: string | null;
  continuation: PremiumContinuation | null;
}>;

export function clearStripeIntent(): void {
  window.localStorage.removeItem(intentKey);
}

export function storeStripeIntent(intent: StripeIntent): void {
  window.localStorage.setItem(intentKey, JSON.stringify(intent));
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
      const pending = parseObject(value.continuation, "localStorage", "stripeIntent.continuation");
      const color = parseString(pending.accentColor, "localStorage", "stripeIntent.accentColor");
      if (!/^#[0-9A-F]{6}$/.test(color) || pending.requiredRank !== 20) {
        throw new ApiContractError("localStorage", "stripeIntent.continuation", "accent color Premium intent");
      }
      continuation = { accentColor: color, requiredRank: 20 };
    }
    return {
      userId, continuation,
      attemptId: value.attemptId === null ? null : parseStripeUuid(value.attemptId, "localStorage", "stripeIntent.attemptId"),
      sessionId: value.sessionId === null ? null : parseStripeSessionId(value.sessionId, "localStorage", "stripeIntent.sessionId"),
    };
  } catch (error) {
    clearStripeIntent();
    throw error;
  }
}

export function isCurrentStripeIntent(expected: StripeIntent): boolean {
  const current = readStripeIntent(expected.userId);
  return current !== null && current.attemptId === expected.attemptId && current.sessionId === expected.sessionId
    && current.continuation?.accentColor === expected.continuation?.accentColor
    && current.continuation?.requiredRank === expected.continuation?.requiredRank;
}

export function consumeStripeIntent(expected: StripeIntent): StripeIntent | null {
  if (!isCurrentStripeIntent(expected)) return null;
  clearStripeIntent();
  return expected;
}
