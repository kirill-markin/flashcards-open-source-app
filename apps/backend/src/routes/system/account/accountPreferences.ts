import type { Hono } from "hono";
import { queryWithUserScope } from "../../../database";
import type { AccountPreferences, AnalyticsConsentChoice } from "../../../auth/ensureUser";
import type { AppEnv } from "../../../server/app";
import type { loadRequestContextFromRequest } from "../../../server/requestContext";
import { expectRecord, parseJsonBody } from "../../../server/requestParsing";
import {
  assertAccountPreferencesHumanTransport,
  parseAccountPreferencesInput,
} from "../support";
import type {
  AccountPreferencesUpdate,
  UpdateAccountPreferencesFn,
  UpdateGuestSessionAnalyticsPreferencesFn,
} from "../types";

type AccountPreferencesRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  updateAccountPreferencesFn: UpdateAccountPreferencesFn;
  updateGuestSessionAnalyticsPreferencesFn: UpdateGuestSessionAnalyticsPreferencesFn;
}>;

type AccountPreferencesRow = Readonly<{
  review_reaction_animations_enabled: boolean;
  analytics_consent: AnalyticsConsentChoice | null;
  product_analytics_enabled: boolean | null;
}>;

function mapAccountPreferencesRow(row: AccountPreferencesRow): AccountPreferences {
  return {
    reviewReactionAnimationsEnabled: row.review_reaction_animations_enabled,
    analyticsConsent: row.analytics_consent,
    productAnalyticsEnabled: row.product_analytics_enabled,
  };
}

/**
 * Writes the preferences a PATCH named, and answers with what is stored afterwards.
 *
 * Two rules are not a plain overwrite, one per analytics column, and both say the same thing: an
 * answer that loosens a stored refusal is refused when it came from a client's reconciliation
 * rather than from a person, and the stored refusal stands. An account is read by several devices,
 * neither column carries a timestamp, and a device that read the account before a withdrawal on
 * another device cannot be ordered against it - so it would otherwise carry its older answer back
 * in silently, on every device the account has. A person's own answer is never refused, so both
 * switches stay reversible by the control that moved them.
 *
 * What a reverted refusal costs is not the same on the two columns, and only one of them is about
 * collection. On product_analytics_enabled a reverted FALSE resumes collection outright, because
 * ingest reads that column. On analytics_consent a reverted 'declined' restores the shared visitor
 * identifier and nothing else: refusing the cookie never stopped collection, which is what the
 * banner copy promises and what db/migrations/0149_product_analytics_off_switch.sql means by
 * forbidding either column to be derived from the other.
 *
 * The restrictive value differs per column, which is why the two branches are not one: on
 * analytics_consent it is 'declined', on product_analytics_enabled it is FALSE. NULL means nobody
 * answered on either (db/migrations/0142_analytics_consent_choice.sql and
 * db/migrations/0149_product_analytics_off_switch.sql), and a NULL row must still adopt an incoming
 * answer, including a reconciled one - that is the only way an answer given before signing in ever
 * reaches the account.
 *
 * The returned row is what the caller is told, so a client whose value was refused learns the
 * stored one from its own write rather than from a later read.
 */
export async function updateAccountPreferences(
  userId: string,
  update: AccountPreferencesUpdate,
): Promise<AccountPreferences> {
  const result = await queryWithUserScope<AccountPreferencesRow>(
    { userId },
    [
      // A null parameter is a field the request left out, so the stored value survives the write.
      "UPDATE org.user_settings",
      "SET review_reaction_animations_enabled = COALESCE($2::BOOLEAN, review_reaction_animations_enabled),",
      // `analytics_consent = 'declined'` is unknown rather than false for a stored NULL, so an
      // account nobody answered on falls through to the write, which is what this needs.
      "analytics_consent = CASE",
      "WHEN $3::TEXT IS NULL THEN analytics_consent",
      "WHEN $4::BOOLEAN AND $3::TEXT = 'granted' AND analytics_consent = 'declined'",
      "THEN analytics_consent",
      "ELSE $3::TEXT END,",
      // `IS FALSE` rather than `= FALSE`: a stored NULL falls through either way, and stating it
      // leaves nothing resting on three-valued logic for the column where the guard being wrong
      // resumes collection rather than only restoring an identifier.
      "product_analytics_enabled = CASE",
      "WHEN $5::BOOLEAN IS NULL THEN product_analytics_enabled",
      "WHEN $6::BOOLEAN AND $5::BOOLEAN AND product_analytics_enabled IS FALSE",
      "THEN product_analytics_enabled",
      "ELSE $5::BOOLEAN END",
      "WHERE user_id = $1",
      "RETURNING review_reaction_animations_enabled, analytics_consent, product_analytics_enabled",
    ].join(" "),
    [
      userId,
      update.reviewReactionAnimationsEnabled,
      update.analyticsConsent,
      update.analyticsConsentOrigin === "reconciliation",
      update.productAnalyticsEnabled,
      update.productAnalyticsEnabledOrigin === "reconciliation",
    ],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Failed to update account preferences for user ${userId}`);
  }

  return mapAccountPreferencesRow(row);
}

export function registerAccountPreferencesRoutes(
  app: Hono<AppEnv>,
  options: AccountPreferencesRoutesOptions,
): void {
  app.patch("/me/preferences", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertAccountPreferencesHumanTransport(requestContext.transport);

    const body = expectRecord(await parseJsonBody(context.req.raw));
    const preferencesUpdate = parseAccountPreferencesInput(body);
    const guestSessionId = requestContext.guestSessionId;
    if (guestSessionId === null) {
      return context.json({
        preferences: await options.updateAccountPreferencesFn(requestContext.userId, preferencesUpdate),
      });
    }

    // A guest has no account, so both of its analytics answers are stored beside its credential
    // instead. The transport picks the column; the request body and the response shape are the same
    // either way, and every other preference stays on org.user_settings, which a guest does own a
    // row in.
    //
    // The guest-session write goes first because it is the one that can fail - it refuses a
    // pre-0147 schema and a revoked session - and a failure must leave no other column already
    // changed. Both guest columns are written by that single call, in one transaction, so a request
    // carrying both answers stores both or neither and never returns a 500 over an answer that
    // landed. A request that only toggles another preference never reaches either column, not even
    // to ask whether it exists, so it keeps working while migration 0147 is still pending; its
    // stored answers were already read with the credential that authenticated this request.
    //
    // The origins the body may carry are not weighed on this branch, and neither column below is
    // guarded the way the account ones above are. The guard above exists because an account is
    // written by several devices that cannot see each other's answers; a guest session row belongs
    // to one credential on one device, and every writer either column has today is that device's
    // own PATCH - the iOS and Android off switches, falling back to the guest credential when the
    // install has no account to store the answer on.
    //
    // That is a census of the writers that exist, not a property of the column. A device can write
    // a value it merely adopted from somewhere else - an answer read off an account it has since
    // signed out of, say - and republish it onto a guest row that already holds a stricter one, and
    // on product_analytics_enabled that resumes ingest immediately. Both mobile clients do send
    // answers here that nobody is giving again - a retry of one still owed, and one re-owed at an
    // identity boundary - and both label those `reconciliation`, so the provenance is already on
    // the wire. What keeps each of them safe is not the same thing, so neither reason covers both.
    //
    // iOS re-owes in either direction, and every site that does it clears the stored credentials
    // and the guest session first (`FlashcardsStore+CloudSync`, `switchCloudServer`,
    // `resetAccountPreferencesForCloudIdentityReset`), so the debt is handed to a credential minted
    // afterwards. Its other re-owe, in `ProductAnalyticsPreference.adoptServerAnswer`, fires only
    // where the server has just reported no answer for that identity. Either way the row it reaches
    // holds NULL and there is nothing to loosen.
    //
    // Android is safe for the opposite reason: it re-owes only an opt-out
    // (`CloudPreferencesStore.clearAccountPreferences` keeps the marker only for FALSE), and it
    // does land on rows that already hold an answer. `resetInvalidCloudCredentialRecoveryState`
    // goes through `disconnectCloudIdentityPreservingLocalState`, which deliberately preserves the
    // stored guest session - unlike its deleted-account sibling, which clears it because that one
    // is an identity boundary - so the re-owed answer is pushed on the surviving analytics guest
    // credential, whose row can already hold an explicit TRUE from an earlier delivered opt-in.
    // Nor is that the row the answer was read from: the marker is re-armed off the account
    // preferences being cleared, and Android's other re-arm - the one a /me read triggers for an
    // account reporting no answer - cannot be trusted to name this row either, because the account
    // read and the analytics push resolve guest credentials through different lookups
    // (`loadActiveGuestSessionOrNull` and `loadProductAnalyticsGuestSessionOrNull`) that diverge
    // once more than one session is stored. So here it is the DIRECTION that makes it safe, because
    // both re-arms fire only for a stored FALSE, an opt-out loosens nothing, and this CASE refuses
    // only TRUE over a stored FALSE.
    //
    // What would break it is therefore Android (or any client) re-owing an opt-IN, or iOS re-owing
    // onto a credential that outlived the identity the answer was made under. Either one, and the
    // same CASE belongs here; this comment must not be read as saying it does not.
    const storedGuestPreferences = (
      preferencesUpdate.analyticsConsent === null
      && preferencesUpdate.productAnalyticsEnabled === null
    )
      ? null
      : await options.updateGuestSessionAnalyticsPreferencesFn(
        requestContext.userId,
        guestSessionId,
        {
          analyticsConsent: preferencesUpdate.analyticsConsent,
          productAnalyticsEnabled: preferencesUpdate.productAnalyticsEnabled,
        },
      );
    // Null from that call is a column the request left out, so the stored answer the credential
    // already carried is what the response reports.
    const analyticsConsent = storedGuestPreferences?.analyticsConsent
      ?? requestContext.preferences.analyticsConsent;
    const productAnalyticsEnabled = storedGuestPreferences?.productAnalyticsEnabled
      ?? requestContext.preferences.productAnalyticsEnabled;

    if (preferencesUpdate.reviewReactionAnimationsEnabled === null) {
      // Nothing left for org.user_settings to store, and writing anyway would rewrite the row for
      // nothing. This is the shape the legal and privacy settings screen sends.
      return context.json({
        preferences: {
          ...requestContext.preferences,
          analyticsConsent,
          productAnalyticsEnabled,
        },
      });
    }

    const accountPreferences = await options.updateAccountPreferencesFn(requestContext.userId, {
      reviewReactionAnimationsEnabled: preferencesUpdate.reviewReactionAnimationsEnabled,
      // Both analytics columns are the guest session's on this branch, so neither is written here.
      // The origins ride along and decide nothing while the value beside them is null.
      analyticsConsent: null,
      analyticsConsentOrigin: preferencesUpdate.analyticsConsentOrigin,
      productAnalyticsEnabled: null,
      productAnalyticsEnabledOrigin: preferencesUpdate.productAnalyticsEnabledOrigin,
    });

    return context.json({
      preferences: {
        ...accountPreferences,
        analyticsConsent,
        productAnalyticsEnabled,
      },
    });
  });
}
