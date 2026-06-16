import type { Hono } from "hono";
import { queryWithUserScope } from "../../database";
import type { AccountPreferences } from "../../auth/ensureUser";
import type { AppEnv } from "../../server/app";
import type { loadRequestContextFromRequest } from "../../server/requestContext";
import { expectRecord, parseJsonBody } from "../../server/requestParsing";
import {
  assertAccountPreferencesHumanTransport,
  parseAccountPreferencesInput,
} from "./support";
import type { UpdateAccountPreferencesFn } from "./types";

type AccountPreferencesRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  updateAccountPreferencesFn: UpdateAccountPreferencesFn;
}>;

type AccountPreferencesRow = Readonly<{
  review_reaction_animations_enabled: boolean;
}>;

function mapAccountPreferencesRow(row: AccountPreferencesRow): AccountPreferences {
  return {
    reviewReactionAnimationsEnabled: row.review_reaction_animations_enabled,
  };
}

export async function updateAccountPreferences(
  userId: string,
  preferences: AccountPreferences,
): Promise<AccountPreferences> {
  const result = await queryWithUserScope<AccountPreferencesRow>(
    { userId },
    [
      "UPDATE org.user_settings",
      "SET review_reaction_animations_enabled = $2",
      "WHERE user_id = $1",
      "RETURNING review_reaction_animations_enabled",
    ].join(" "),
    [userId, preferences.reviewReactionAnimationsEnabled],
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
    const preferencesInput = parseAccountPreferencesInput(body);
    const preferences = await options.updateAccountPreferencesFn(requestContext.userId, preferencesInput);

    return context.json({
      preferences,
    });
  });
}
