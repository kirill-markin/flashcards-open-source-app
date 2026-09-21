/**
 * What this browser is allowed to do before, and after, the person answers the consent banner
 * (docs/analytics-visitor-identity.md).
 *
 * Two facts decide everything here: the decision this browser has stored, and whether the
 * jurisdiction it is in requires one at all. The second is the backend's answer to
 * `GET /v1/analytics/visitor` and is unknown until that call returns, so a browser that has not
 * stored a decision starts out treated exactly as one that has to be asked — nothing may be written
 * to it and nothing it collects may leave it while the question is open.
 *
 * It holds no delivery state of its own: the runtime reads these answers, and the banner subscribes
 * to them.
 */
import type { AnalyticsConsentChoice } from "../types";
import { readStoredAnalyticsConsentDecision, writeStoredAnalyticsConsentDecision } from "./identity";

/**
 * Whether the person's country requires a decision before this browser may be given an identity, or
 * null while this load has not been told. A browser that already holds the shared cookie is told
 * `false` without a country lookup: the cookie is itself the record that it was allowed one.
 */
let requiresConsentDecision: boolean | null = null;

const consentListeners = new Set<() => void>();

function notifyConsentListeners(): void {
  for (const listener of consentListeners) {
    listener();
  }
}

/** The stored answer, named here so everything about consent is read from one module. */
export function readAnalyticsConsentDecision(): AnalyticsConsentChoice | null {
  return readStoredAnalyticsConsentDecision();
}

/**
 * Records the answer for this browser. It is the only write the consent flow makes to the device
 * before an identity exists, and it is what keeps the banner from asking the same person twice — a
 * browser that keeps no storage at all is asked again on its next load, which is the only honest
 * outcome there.
 */
export function recordAnalyticsConsentDecision(decision: AnalyticsConsentChoice): void {
  writeStoredAnalyticsConsentDecision(decision);
  notifyConsentListeners();
}

/** Published by the visitor identity resolution, which is the only caller that learns this. */
export function publishAnalyticsConsentJurisdiction(requiresDecision: boolean): void {
  if (requiresConsentDecision === requiresDecision) {
    return;
  }

  requiresConsentDecision = requiresDecision;
  notifyConsentListeners();
}

/**
 * Whether this browser is still waiting to be told what it may do — because it has not been asked
 * yet where it has to be, or because it does not know yet whether it has to be asked at all.
 * Nothing analytics collects may be written to the device or sent while this holds.
 */
export function isAwaitingAnalyticsConsentDecision(): boolean {
  return readAnalyticsConsentDecision() === null && requiresConsentDecision !== false;
}

/**
 * Whether this browser may be given an analytics identifier of any kind: it granted, or it is
 * somewhere that asks nobody. False while the question is open, and false after a refusal.
 */
export function isAnalyticsIdentityConsented(): boolean {
  return isAwaitingAnalyticsConsentDecision() === false && readAnalyticsConsentDecision() !== "declined";
}

/** The banner is shown only once the jurisdiction answer says this person has to be asked. */
export function isAnalyticsConsentBannerVisible(): boolean {
  return requiresConsentDecision === true && readAnalyticsConsentDecision() === null;
}

export function subscribeToAnalyticsConsent(listener: () => void): () => void {
  consentListeners.add(listener);
  return (): void => {
    consentListeners.delete(listener);
  };
}
