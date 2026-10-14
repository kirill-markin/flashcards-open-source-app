/**
 * Whether this person is measured at all. It is the product-analytics setting's answer, and the one
 * decision that stops collection outright: while it is off nothing is sent, nothing is queued and
 * nothing is held.
 *
 * This is where the two analytics decisions meet, and they are deliberately not the same answer.
 * The consent banner in `consent.ts` decides only whether this browser carries the shared
 * `analytics_visitor` identifier; a person who refused it keeps being measured, identity-free while
 * signed out and under their account while signed in. A stored cookie refusal must therefore never
 * be migrated or read into this decision, which is why it is stored under its own key and
 * reconciled with the account on its own field (`productAnalyticsEnabled`).
 *
 * It is on by default because the basis is legitimate interest rather than consent: no stored
 * answer reads as on, and only an explicit `false` — this browser's own, or the account's — turns
 * collection off. It covers product analytics alone; error and crash reporting is unaffected.
 *
 * It holds no delivery state of its own: the runtime reads this answer, and the setting card
 * subscribes to it. The answer is shared across this browser's open tabs: a change in one is
 * published to the others, which carry it out on the same terms as the tab it was given in.
 */
import {
  productAnalyticsCollectionStorageKey,
  readStoredProductAnalyticsCollection,
  writeStoredProductAnalyticsCollection,
} from "./identity";
import { isAwaitingAnalyticsConsentDecision, subscribeToAnalyticsConsent } from "./consent";
import {
  readSharedProductAnalyticsCollection,
  writeSharedProductAnalyticsCollection,
} from "./sharedCollectionPreference";

const collectionListeners = new Set<() => void>();

/**
 * The answer this browsing context is acting on. Browser storage throws or silently keeps nothing in
 * a few real configurations (Safari private browsing, storage disabled by policy), and this decision
 * may not fail open there: a write that was swallowed would send every reader back to an empty store,
 * the answer would read as on again on the very next call, and the switch would snap back under the
 * person's finger while collection resumed. The account's own `false` cannot rescue it either,
 * because it is applied through the same failing write.
 */
let collectionDecision: boolean | null = null;
let hasSeededCollectionDecision = false;
let hasStartedCrossDocumentWatch = false;
let lastStoredCollectionDecision: boolean | null = null;
let lastSharedCollectionDecision: boolean | null = null;
let hasPublishedInitialCollectionPreference = false;

function notifyCollectionDecisionChange(previousDecision: boolean | null): void {
  if (previousDecision === collectionDecision) {
    return;
  }

  for (const listener of collectionListeners) {
    listener();
  }
}

function startCrossDocumentCollectionWatch(): void {
  if (hasStartedCrossDocumentWatch || typeof window === "undefined") {
    return;
  }

  hasStartedCrossDocumentWatch = true;
  subscribeToAnalyticsConsent((): void => {
    readProductAnalyticsCollectionDecision();
  });
  window.addEventListener("storage", (event: StorageEvent): void => {
    if (event.key !== productAnalyticsCollectionStorageKey) {
      return;
    }

    readProductAnalyticsCollectionDecision();
  });
}

/** The recorded answer, or null while nobody has given one on this browser. */
export function readProductAnalyticsCollectionDecision(): boolean | null {
  startCrossDocumentCollectionWatch();
  const previousDecision = collectionDecision;
  const storedDecision = readStoredProductAnalyticsCollection();
  const sharedDecision = readSharedProductAnalyticsCollection();
  if (hasSeededCollectionDecision === false) {
    collectionDecision = storedDecision === false || sharedDecision === false ? false : storedDecision;
  } else if (sharedDecision !== null && sharedDecision !== lastSharedCollectionDecision) {
    collectionDecision = sharedDecision;
  } else if (storedDecision !== null && storedDecision !== lastStoredCollectionDecision) {
    collectionDecision = storedDecision;
  }

  // Missing storage is not a new answer. Snapshot before notifying to make subscriber reads stable.
  if (storedDecision !== null) {
    lastStoredCollectionDecision = storedDecision;
  }
  if (sharedDecision !== null) {
    lastSharedCollectionDecision = sharedDecision;
  }
  hasSeededCollectionDecision = true;
  if (collectionDecision !== null && storedDecision !== collectionDecision
    && (collectionDecision === false || isAwaitingAnalyticsConsentDecision() === false)) {
    writeStoredProductAnalyticsCollection(collectionDecision);
    lastStoredCollectionDecision = readStoredProductAnalyticsCollection();
  }

  if (hasPublishedInitialCollectionPreference === false
    && (collectionDecision !== null || isAwaitingAnalyticsConsentDecision() === false)) {
    hasPublishedInitialCollectionPreference = true;
    if (sharedDecision === null) {
      writeSharedProductAnalyticsCollection(collectionDecision !== false);
      lastSharedCollectionDecision = readSharedProductAnalyticsCollection();
    }
  }

  notifyCollectionDecisionChange(previousDecision);
  return collectionDecision;
}

/** Whether anything may be collected right now. An unanswered browser is measured. */
export function isProductAnalyticsCollectionEnabled(): boolean {
  return readProductAnalyticsCollectionDecision() !== false;
}

/**
 * Records the answer for this browser. The caller carries it to the account, and the runtime is
 * what acts on it, so this only stores and publishes it.
 */
export function recordProductAnalyticsCollectionDecision(isCollectionEnabled: boolean): void {
  startCrossDocumentCollectionWatch();
  const previousDecision = collectionDecision;
  // Before the store, so the answer holds for this browsing context even where the write goes nowhere.
  collectionDecision = isCollectionEnabled;
  hasSeededCollectionDecision = true;
  writeSharedProductAnalyticsCollection(isCollectionEnabled);
  writeStoredProductAnalyticsCollection(isCollectionEnabled);
  lastSharedCollectionDecision = readSharedProductAnalyticsCollection();
  lastStoredCollectionDecision = readStoredProductAnalyticsCollection();
  hasPublishedInitialCollectionPreference = true;
  notifyCollectionDecisionChange(previousDecision);
}

export function subscribeToProductAnalyticsCollection(listener: () => void): () => void {
  collectionListeners.add(listener);
  return (): void => {
    collectionListeners.delete(listener);
  };
}
