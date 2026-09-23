/**
 * Carrying the two analytics decisions between this browser and the account signing in on it.
 *
 * They are reconciled together because they travel on one `PATCH /me/preferences` body, and they
 * are kept apart in every other respect: `analyticsConsent` answers the cookie banner, and
 * `productAnalyticsEnabled` answers whether this person is measured at all. Neither is ever read
 * into the other, so a person who refused the cookie keeps analytics on
 * (`productAnalyticsCollection.ts`).
 *
 * The account is the durable record and wins wherever both exist: it travels with the person to
 * another browser or device, while the browser's own answer belongs to the browser. Where only the
 * browser has answered, the account adopts that answer, which is what makes a decision taken before
 * signing in — on a public catalog, invite or share route among them — survive the next device. The
 * collection decision is the exception in both directions, and only ever toward less collection:
 * it carries up only as an opt-out, and comes down over an explicit browser answer only as one.
 */
import { updateAccountPreferences } from "../api";
import type { AccountPreferencesUpdate, AnalyticsConsentChoice } from "../types";
import {
  declineAnalyticsConsent,
  grantAnalyticsConsent,
  setProductAnalyticsCollection,
} from "./client";
import { readAnalyticsConsentDecision } from "./consent";
import { readProductAnalyticsCollectionDecision } from "./productAnalyticsCollection";

type AccountAnalyticsPreferences = Readonly<{
  analyticsConsent: AnalyticsConsentChoice | null;
  productAnalyticsEnabled: boolean | null;
}>;

async function applyAccountConsentToBrowser(accountConsent: AnalyticsConsentChoice): Promise<void> {
  if (accountConsent === "granted") {
    await grantAnalyticsConsent();
    return;
  }

  await declineAnalyticsConsent();
}

/** Returns the browser answer the account is missing, or null when there is nothing to carry up. */
async function reconcileConsentDecision(
  accountConsent: AnalyticsConsentChoice | null,
): Promise<AnalyticsConsentChoice | null> {
  const browserConsent = readAnalyticsConsentDecision();
  // Read as the two recorded answers rather than as "not null", so a payload that carries no such
  // field at all is the absent decision it describes rather than an answer nobody gave.
  if (accountConsent === "granted" || accountConsent === "declined") {
    if (accountConsent !== browserConsent) {
      await applyAccountConsentToBrowser(accountConsent);
    }

    return null;
  }

  return browserConsent;
}

/**
 * The same reconciliation for the collection decision, except that an opt-in crosses in neither
 * direction. The account's answer is applied through the runtime rather than stored directly,
 * because an account arriving with `false` has to stop this load's collection and discard what it
 * already holds, exactly as the setting card does.
 *
 * The browser's answer outlives the person who gave it — it is deliberately kept across a local
 * data cleanup, so a logout leaves it in place — and the next account signing in here with no
 * answer of its own would otherwise adopt a stranger's, permanently and on every device they use.
 * An opt-out carried to the wrong person measures them less than they had allowed, which is the
 * safe direction and costs nothing they asked for; an opt-in would switch collection back on for
 * somebody who had turned it off, silently, so `true` is left for that person to give on their own
 * account. Nothing is lost by withholding it: an account with no answer is measured already.
 */
function reconcileCollectionDecision(accountCollection: boolean | null): boolean | null {
  const browserCollection = readProductAnalyticsCollectionDecision();
  if (accountCollection !== null) {
    // Downwards the account answer is applied on the same asymmetry the carry-up uses: an opt-out
    // always, an opt-in only onto a browser that has answered nothing. The switch records this
    // browser's `false` before it writes the account half and deliberately does not roll back when
    // that write fails, so an account left holding `true` would otherwise turn collection back on
    // here, on the next verified session, with nobody touching anything. An explicit re-enable comes
    // from the switch, which writes both halves.
    const isApplicable = accountCollection === false || browserCollection === null;
    if (isApplicable && accountCollection !== browserCollection) {
      setProductAnalyticsCollection(accountCollection);
    }

    return null;
  }

  if (browserCollection === false) {
    return false;
  }

  return null;
}

async function runAnalyticsPreferencesAccountSync(
  accountPreferences: AccountAnalyticsPreferences,
): Promise<void> {
  const consentToCarryUp = await reconcileConsentDecision(accountPreferences.analyticsConsent);
  const collectionToCarryUp = reconcileCollectionDecision(accountPreferences.productAnalyticsEnabled);
  if (consentToCarryUp === null && collectionToCarryUp === null) {
    return;
  }

  // Only the fields this browser has an answer for are written. A whole preferences object would
  // carry a stored null back as a value the route refuses, and the parser needs at least one
  // writable field.
  //
  // Both origins are `reconciliation`, because that is what every write from this module is: the
  // browser carrying over an answer it read from its own storage, given at a time nothing in the
  // request records and possibly before this account existed. Omitting them means `user_action` on
  // the route, which would say a person is answering right now and let a remembered answer
  // overwrite a refusal taken since on another device. They are sent whether or not the value
  // beside them travels: an origin names who asked, and the route ignores the one whose field the
  // body leaves out. The controls a person actually presses are elsewhere — the settings screen,
  // the banner, the public panel — and send no origin, so they keep the `user_action` default they
  // want and both switches stay reversible by the control that moved them.
  const update: AccountPreferencesUpdate = {
    ...(consentToCarryUp === null ? {} : { analyticsConsent: consentToCarryUp }),
    ...(collectionToCarryUp === null ? {} : { productAnalyticsEnabled: collectionToCarryUp }),
    analyticsConsentOrigin: "reconciliation",
    productAnalyticsEnabledOrigin: "reconciliation",
  };
  await updateAccountPreferences(update);
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
 * A guest whose account was upgraded does not necessarily arrive here with `null` on the account:
 * the upgrade carries both answers the guest session recorded onto a target row still holding NULL
 * (`apps/backend/src/guestAuth/store/session.ts`). This direction exists for what that carry-over
 * cannot reach — an answer given on this browser that never became a guest session's stored answer,
 * a target row that already held one of its own, and every decision taken on a browser with no
 * guest session behind it at all.
 */
export function syncAnalyticsPreferencesWithAccount(
  accountPreferences: AccountAnalyticsPreferences,
): Promise<void> {
  return runAnalyticsPreferencesAccountSync(accountPreferences).catch((): void => undefined);
}
