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
import type { AccountPreferencesUpdate, UpdateAccountPreferencesFn } from "../types";

type AccountPreferencesRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  updateAccountPreferencesFn: UpdateAccountPreferencesFn;
}>;

type AccountPreferencesRow = Readonly<{
  review_reaction_animations_enabled: boolean;
  analytics_consent: AnalyticsConsentChoice | null;
}>;

function mapAccountPreferencesRow(row: AccountPreferencesRow): AccountPreferences {
  return {
    reviewReactionAnimationsEnabled: row.review_reaction_animations_enabled,
    analyticsConsent: row.analytics_consent,
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
      "analytics_consent = COALESCE($3::TEXT, analytics_consent)",
      "WHERE user_id = $1",
      "RETURNING review_reaction_animations_enabled, analytics_consent",
    ].join(" "),
    [userId, update.reviewReactionAnimationsEnabled, update.analyticsConsent],
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
    const preferences = await options.updateAccountPreferencesFn(requestContext.userId, preferencesUpdate);

    return context.json({
      preferences,
    });
  });
}
