/**
 * Carrying the analytics consent decision between this browser and the account signing in on it.
 *
 * The account is the durable record and wins wherever both exist: it travels with the person to
 * another browser or device, while the browser's own answer belongs to the browser. Where only the
 * browser has answered, the account adopts that answer, which is what makes a decision taken before
 * signing in — on a public catalog, invite or share route among them — survive the next device.
 */
import { updateAccountPreferences } from "../api";
import type { AnalyticsConsentChoice } from "../types";
import { declineAnalyticsConsent, grantAnalyticsConsent } from "./client";
import { readAnalyticsConsentDecision } from "./consent";

async function applyAccountConsentToBrowser(accountConsent: AnalyticsConsentChoice): Promise<void> {
  if (accountConsent === "granted") {
    await grantAnalyticsConsent();
    return;
  }

  await declineAnalyticsConsent();
}

async function runAnalyticsConsentAccountSync(
  accountConsent: AnalyticsConsentChoice | null,
): Promise<void> {
  const browserConsent = readAnalyticsConsentDecision();
  // Read as the two recorded answers rather than as "not null", so a payload that carries no such
  // field at all is the absent decision it describes rather than an answer nobody gave.
  if (accountConsent === "granted" || accountConsent === "declined") {
    if (accountConsent !== browserConsent) {
      await applyAccountConsentToBrowser(accountConsent);
    }

    return;
  }

  if (browserConsent === null) {
    return;
  }

  // Only the field this decision owns is written. A whole preferences object would carry a stored
  // null back as a value the route refuses, and the parser needs at least one writable field.
  await updateAccountPreferences({ analyticsConsent: browserConsent });
}

/**
 * Reconciles the two records, in the background. Called from the session layer once a session is
 * verified, on the same line the analytics owner is published: no user action may be blocked,
 * delayed or failed by analytics, so the sign-in path does not await this and a failure costs one
 * sync rather than a sign-in. The next verified session runs it again.
 *
 * The returned promise settles when the reconciliation is done and never rejects, so other
 * background analytics work that must not act on the browser's pre-sync answer — the guest identity
 * link, which spends an identity permanently — can wait for it without acquiring a failure path.
 *
 * A guest whose account was upgraded arrives here with `null` on the account — the upgrade copies
 * no preference columns and the guest row is deleted — and the browser's own stored answer is what
 * restores it, which is why this direction exists rather than a backend carry-over.
 */
export function syncAnalyticsConsentWithAccount(
  accountConsent: AnalyticsConsentChoice | null,
): Promise<void> {
  return runAnalyticsConsentAccountSync(accountConsent).catch((): void => undefined);
}
