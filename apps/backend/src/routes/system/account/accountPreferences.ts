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
      "analytics_consent = COALESCE($3::TEXT, analytics_consent),",
      "product_analytics_enabled = COALESCE($4::BOOLEAN, product_analytics_enabled)",
      "WHERE user_id = $1",
      "RETURNING review_reaction_animations_enabled, analytics_consent, product_analytics_enabled",
    ].join(" "),
    [
      userId,
      update.reviewReactionAnimationsEnabled,
      update.analyticsConsent,
      update.productAnalyticsEnabled,
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
      analyticsConsent: null,
      productAnalyticsEnabled: null,
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
