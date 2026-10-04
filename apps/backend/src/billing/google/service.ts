import { randomUUID } from "node:crypto";
import { unsafeTransaction } from "../../database/unsafe";
import { GoogleBillingError, googleProductId, googleBasePlanId, type GooglePurchaseState } from "./contracts";
import { GoogleProvider } from "./provider";
import {
  googleAccountId, googlePredecessorToken, lockGooglePurchaseOwners, lockGooglePurchaseTokens,
  persistGooglePurchase, readGooglePurchase, type GooglePurchaseLink,
  readGoogleNotification, recordGoogleNotification, readGooglePurchaseByToken,
  lockKnownGooglePurchase, revokeGooglePurchase,
  readGoogleNotificationPreviousRenewal, expireUnavailableGooglePurchase, type StoredGooglePurchase,
} from "./store";
import { publishGoogleTransition, type GoogleCommittedTransition } from "./facts";
import type { GoogleNotification } from "./notifications";

export type GoogleBillingService = Readonly<{
  getOrCreateAccountId: (userId: string) => Promise<Readonly<{ obfuscatedAccountId: string }>>;
  attachPurchase: (userId: string, purchaseToken: string) => Promise<Readonly<{ attached: true }>>;
  reconcilePurchase: (purchaseToken: string) => Promise<Readonly<{ attached: true }>>;
}>;

async function discoverGoogleLineage(
  provider: GoogleProvider, state: GooglePurchaseState,
): Promise<ReadonlyArray<GooglePurchaseLink>> {
  return unsafeTransaction(async (executor) => {
    const links: Array<GooglePurchaseLink> = [];
    let token: string | null = state.purchaseToken;
    while (token !== null) {
      if (links.length >= 32 || links.some((link) => link.purchaseToken === token)) {
        throw new GoogleBillingError("GOOGLE_LINEAGE_INVALID", false, null,
          "Google purchase lineage is cyclic or exceeds 32 purchases. Contact support.");
      }
      const stored = await readGooglePurchase(executor, token, state.environment);
      let verified: GooglePurchaseState | null = token === state.purchaseToken ? state : null;
      if (verified === null && stored === null) {
        try {
          verified = await provider.currentState(token);
        } catch (error) {
          // Play stops serving sufficiently old expired tokens; the current verified link still
          // proves supersession. Retain a tombstone without inventing historical provider state.
          if (!(error instanceof GoogleBillingError) || error.code !== "GOOGLE_PROVIDER_FAILED"
            || (error.httpStatus !== 404 && error.httpStatus !== 410)) throw error;
          console.info(JSON.stringify({ event: "google_predecessor_unavailable",
            environment: state.environment, httpStatus: error.httpStatus }));
        }
      }
      if (verified !== null && verified.environment !== state.environment) {
        throw new GoogleBillingError("GOOGLE_LINEAGE_ENVIRONMENT_MISMATCH", false, null,
          "Google predecessor belongs to a different purchase environment.");
      }
      const providerLink: string | null = verified === null ? null : googlePredecessorToken(verified);
      if (providerLink !== null && stored?.linked_from_purchase_id != null
        && providerLink !== stored.linked_from_purchase_id) {
        throw new GoogleBillingError("GOOGLE_LINEAGE_INVALID", false, null,
          "Google purchase predecessor conflicts with its stored lineage. Contact support.");
      }
      const predecessorToken: string | null = providerLink ?? stored?.linked_from_purchase_id ?? null;
      links.push({ purchaseToken: token, predecessorToken, state: verified });
      token = predecessorToken;
    }
    return links;
  });
}

async function commitGoogleCurrentState(
  provider: GoogleProvider, purchaseToken: string, presentingUserId: string | null,
  notification: GoogleNotification | null,
): Promise<GoogleCommittedTransition | null> {
  const receivedAt = new Date();
  const observed = await provider.currentState(purchaseToken);
  const lineage = await discoverGoogleLineage(provider, observed);
  const transition = await unsafeTransaction(async (executor): Promise<GoogleCommittedTransition | null> => {
    await lockGooglePurchaseTokens(executor, lineage, observed.environment);
    if (notification !== null && await readGoogleNotification(executor, notification)) return null;
    const latest = await provider.currentState(purchaseToken);
    // A voided renewal must match the current successful order, never an older period.
    const terminal = notification?.kind === "revoked" || (notification?.kind === "voided"
      && notification.revokedOrderId === latest.latestSuccessfulOrderId);
    const state = terminal ? { ...latest, status: "revoked" as const, willRenew: false, paid: false,
      isTrial: false, graceUntil: null } : latest;
    const predecessor = googlePredecessorToken(state);
    if (state.environment !== observed.environment
      || (predecessor !== null && predecessor !== lineage[0].predecessorToken)) {
      throw new GoogleBillingError("GOOGLE_LINEAGE_CHANGED", true, null,
        "Google purchase lineage changed during verification. Retry the same purchase.");
    }
    // Preserve the pre-acknowledgement context if another verified acknowledgement removed it.
    const attributedState = { ...state, outOfAppPurchaseContext: state.outOfAppPurchaseContext ?? observed.outOfAppPurchaseContext };
    const locked = await lockGooglePurchaseOwners(executor, attributedState, lineage, presentingUserId);
    const purchase = await persistGooglePurchase(executor, attributedState, lineage, locked, presentingUserId);
    let previous = locked.previous;
    if (notification !== null) {
      await recordGoogleNotification(executor, notification, purchase, previous?.will_renew ?? null);
      const previousRenewal = await readGoogleNotificationPreviousRenewal(executor, notification.eventId);
      if (previous !== null && previousRenewal !== null) previous = { ...previous, will_renew: previousRenewal };
    }
    return { previous, purchase, state: attributedState, receivedAt,
      eventId: notification?.eventId ?? randomUUID(), affectedUserIds: locked.accounts.map((account) => account.userId) };
  });
  if (transition === null) return null;
  console.info(JSON.stringify({ event: "google_purchase_persisted", purchaseId: transition.purchase.purchase_id,
    environment: transition.state.environment, status: transition.purchase.status,
    outcome: transition.purchase.invalidated_at !== null ? "superseded"
      : transition.purchase.account_deleted_at !== null ? "deleted_owner"
        : transition.purchase.user_id === null ? "unowned" : "attached",
    intent: presentingUserId === null ? "passive" : "explicit" }));
  return transition;
}

export async function persistGoogleCurrentState(
  provider: GoogleProvider, purchaseToken: string, presentingUserId: string | null,
): Promise<GoogleCommittedTransition> {
  const transition = await commitGoogleCurrentState(provider, purchaseToken, presentingUserId, null);
  if (transition === null) {
    throw new GoogleBillingError("GOOGLE_TRANSITION_MISSING", true, null, "Google purchase was not persisted.");
  }
  await publishGoogleTransition(transition);
  return transition;
}

export async function persistGoogleNotification(
  provider: GoogleProvider, notification: GoogleNotification,
): Promise<GoogleCommittedTransition | null> {
  if (notification.purchaseToken === null) {
    throw new GoogleBillingError("GOOGLE_NOTIFICATION_TOKEN_MISSING", false, null,
      "Purchase notification requires a token.");
  }
  return commitGoogleCurrentState(provider, notification.purchaseToken, null, notification);
}

export async function revokeKnownGoogleNotification(
  notification: GoogleNotification,
): Promise<GoogleCommittedTransition | null> {
  const purchaseToken = notification.purchaseToken;
  if (purchaseToken === null || (notification.kind !== "revoked" && notification.kind !== "voided")) return null;
  return unsafeTransaction(async (executor) => {
    const observed = await readGooglePurchaseByToken(executor, purchaseToken);
    if (observed === null) return null;
    const locked = await lockKnownGooglePurchase(executor, observed);
    if (await readGoogleNotification(executor, notification)) return null;
    if (notification.kind === "voided" && notification.revokedOrderId !== locked.purchase.google_latest_order_id) return null;
    const purchase = await revokeGooglePurchase(executor, locked.purchase);
    await recordGoogleNotification(executor, notification, purchase, locked.purchase.will_renew);
    // Only terminal denial is reconstructed from the correlated token; no provider access,
    // trial, payment, or renewal state is inferred from notification delivery.
    return storedTerminalTransition(locked.purchase, purchase, notification.occurredAt, notification.eventId,
      locked.accounts.map((account) => account.userId));
  });
}

export async function settleUnavailableGoogleToken(
  purchaseToken: string, failedAt: Date, httpStatus: number, notification: GoogleNotification | null,
): Promise<GoogleCommittedTransition | null> {
  return unsafeTransaction(async (executor) => {
    const observed = await readGooglePurchaseByToken(executor, purchaseToken);
    if (observed === null) return null;
    const locked = await lockKnownGooglePurchase(executor, observed);
    const previous = locked.purchase;
    if (previous.google_verified_at !== null && previous.google_verified_at.getTime() >= failedAt.getTime()) return null;
    const lookupExpired = previous.until !== null && previous.until.getTime() < failedAt.getTime() - 60 * 86_400_000;
    if (httpStatus !== 410 && !(httpStatus === 404 && lookupExpired)) return null;
    const purchase = await expireUnavailableGooglePurchase(executor, previous);
    if (notification !== null) await recordGoogleNotification(executor, notification, purchase, previous.will_renew);
    return storedTerminalTransition(previous, purchase, failedAt, notification?.eventId ?? randomUUID(),
      locked.accounts.map((account) => account.userId));
  });
}

function storedTerminalTransition(
  previous: StoredGooglePurchase, purchase: StoredGooglePurchase, occurredAt: Date, eventId: string,
  affectedUserIds: ReadonlyArray<string>,
): GoogleCommittedTransition {
  const state: GooglePurchaseState = {
    purchaseToken: purchase.provider_purchase_id, productId: googleProductId, basePlanId: googleBasePlanId,
    offerId: null, price: null, status: purchase.status, providerStatus: purchase.provider_status_raw ?? "SUBSCRIPTION_STATE_EXPIRED",
    environment: purchase.environment, currentPhase: "unknown", isTrial: false, willRenew: false, paid: false,
    completed: true, until: purchase.until, graceUntil: null, startedAt: null, verifiedAt: occurredAt,
    latestSuccessfulOrderId: purchase.google_latest_order_id, linkedPurchaseToken: purchase.linked_from_purchase_id,
    acknowledgementState: purchase.google_acknowledgement_state ?? "pending",
    obfuscatedExternalAccountId: null, outOfAppPurchaseContext: null,
  };
  return { previous, purchase, state, eventId, receivedAt: new Date(), affectedUserIds };
}

export async function acknowledgeGoogleTransition(
  provider: GoogleProvider, transition: GoogleCommittedTransition,
): Promise<void> {
  if (!transition.state.completed || transition.purchase.status === "revoked"
    || transition.purchase.invalidated_at !== null || transition.state.acknowledgementState !== "pending") return;
  try {
    await provider.acknowledge(transition.state.purchaseToken);
    await unsafeTransaction(async (executor) => {
      const locked = await lockKnownGooglePurchase(executor, transition.purchase);
      await executor.query(`UPDATE billing.purchases SET google_acknowledgement_state = 'acknowledged'
        WHERE purchase_id = $1`, [locked.purchase.purchase_id]);
    });
    console.info(JSON.stringify({ event: "google_purchase_acknowledged", purchaseId: transition.purchase.purchase_id,
      environment: transition.state.environment }));
  } catch (error) {
    console.warn(JSON.stringify({ event: "google_purchase_acknowledgement_failed",
      purchaseId: transition.purchase.purchase_id, environment: transition.state.environment,
      errorCode: error instanceof GoogleBillingError ? error.code : "GOOGLE_ACKNOWLEDGEMENT_FAILED" }));
    throw error;
  }
}

async function verifyAndAcknowledge(
  provider: GoogleProvider, purchaseToken: string, presentingUserId: string | null,
): Promise<Readonly<{ attached: true }>> {
  const transition = await persistGoogleCurrentState(provider, purchaseToken, presentingUserId);
  if (!transition.state.completed) {
    throw new GoogleBillingError("GOOGLE_PURCHASE_INCOMPLETE", false, null,
      "Google purchase is pending or its initial payment was canceled. Complete payment in Google Play.");
  }
  await acknowledgeGoogleTransition(provider, transition);
  return { attached: true };
}

export function createGoogleBillingService(): GoogleBillingService {
  const provider = new GoogleProvider();
  return {
    async getOrCreateAccountId(userId) {
      return { obfuscatedAccountId: await unsafeTransaction((executor) => googleAccountId(executor, userId)) };
    },
    async attachPurchase(userId, purchaseToken) {
      return verifyAndAcknowledge(provider, purchaseToken, userId);
    },
    async reconcilePurchase(purchaseToken) {
      return verifyAndAcknowledge(provider, purchaseToken, null);
    },
  };
}
