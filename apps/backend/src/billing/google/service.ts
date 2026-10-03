import { randomUUID } from "node:crypto";
import { unsafeTransaction } from "../../database/unsafe";
import { GoogleBillingError, type GooglePurchaseState } from "./contracts";
import { GoogleProvider } from "./provider";
import {
  googleAccountId, googlePredecessorToken, lockGooglePurchaseOwners, lockGooglePurchaseTokens,
  persistGooglePurchase, readGooglePurchase, type GooglePurchaseLink,
} from "./store";
import { publishGoogleTransition, type GoogleCommittedTransition } from "./facts";

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

// Shared by explicit presentation and passive reconciliation; notifications can call the latter.
// Every provider fetch used for the live target is repeated under the lineage serialization locks.
export async function persistGoogleCurrentState(
  provider: GoogleProvider, purchaseToken: string, presentingUserId: string | null,
): Promise<GoogleCommittedTransition> {
  const receivedAt = new Date();
  const observed = await provider.currentState(purchaseToken);
  const lineage = await discoverGoogleLineage(provider, observed);
  const transition = await unsafeTransaction(async (executor): Promise<GoogleCommittedTransition> => {
    await lockGooglePurchaseTokens(executor, lineage, observed.environment);
    const state = await provider.currentState(purchaseToken);
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
    return { previous: locked.previous, purchase, state: attributedState, receivedAt,
      eventId: randomUUID(), affectedUserIds: locked.accounts.map((account) => account.userId) };
  });
  await publishGoogleTransition(transition);
  console.info(JSON.stringify({ event: "google_purchase_persisted", purchaseId: transition.purchase.purchase_id,
    environment: transition.state.environment, status: transition.purchase.status,
    outcome: transition.purchase.invalidated_at !== null ? "superseded"
      : transition.purchase.account_deleted_at !== null ? "deleted_owner"
        : transition.purchase.user_id === null ? "unowned" : "attached",
    intent: presentingUserId === null ? "passive" : "explicit" }));
  return transition;
}

async function verifyAndAcknowledge(
  provider: GoogleProvider, purchaseToken: string, presentingUserId: string | null,
): Promise<Readonly<{ attached: true }>> {
  const transition = await persistGoogleCurrentState(provider, purchaseToken, presentingUserId);
  if (!transition.state.completed) {
    throw new GoogleBillingError("GOOGLE_PURCHASE_INCOMPLETE", false, null,
      "Google purchase is pending or its initial payment was canceled. Complete payment in Google Play.");
  }
  if (transition.purchase.status !== "revoked" && transition.purchase.invalidated_at === null
    && transition.state.acknowledgementState === "pending") {
    // The purchase and its attribution are committed before acknowledgement. A failed acknowledgement
    // leaves them intact, and replaying this same token retries without another entitlement grant.
    try {
      await provider.acknowledge(purchaseToken);
      console.info(JSON.stringify({ event: "google_purchase_acknowledged", purchaseId: transition.purchase.purchase_id,
        environment: transition.state.environment }));
    } catch (error) {
      console.warn(JSON.stringify({ event: "google_purchase_acknowledgement_failed",
        purchaseId: transition.purchase.purchase_id, environment: transition.state.environment,
        errorCode: error instanceof GoogleBillingError ? error.code : "GOOGLE_ACKNOWLEDGEMENT_FAILED" }));
      throw error;
    }
  }
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
