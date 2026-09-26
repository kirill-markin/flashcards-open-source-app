import type pg from "pg";
import { createUserSettingsState } from "../fixtures";
import {
  type GuestUpgradeExecutorParam,
  type GuestUpgradeHandlerContext,
} from "../models";
import { createQueryResult } from "../queryResult";

export function handleUserSettingsExecutorQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  const { scope, state } = context;

  if (text === "SELECT user_id FROM org.user_settings WHERE user_id = $1 LIMIT 1") {
    const userId = String(params[0]);
    scope.requireCurrentUserScope(userId);
    const row = state.userSettings.get(userId);
    return createQueryResult<Row>(row === undefined ? [] : [{ user_id: row.user_id } as unknown as Row]);
  }

  if (
    text.startsWith("INSERT INTO org.user_settings (user_id, email)")
    && text.includes("ON CONFLICT (user_id) DO UPDATE")
  ) {
    const userId = String(params[0]);
    const email = params[1] === null ? null : String(params[1]);
    scope.requireCurrentUserScope(userId);
    const current = state.userSettings.get(userId);
    if (current === undefined) {
      state.userSettings.set(userId, createUserSettingsState(userId, null, email));
    } else if (current.email === null && email !== null) {
      state.userSettings.set(userId, {
        ...current,
        email,
      });
    }
    return createQueryResult<Row>([]);
  }

  if (
    text.startsWith(
      "SELECT workspace_id, email, locale, review_reaction_animations_enabled, analytics_consent,"
      + " product_analytics_enabled, accent_color, created_at",
    )
    && text.includes("FROM org.user_settings")
    && text.includes("FOR UPDATE")
  ) {
    const userId = String(params[0]);
    scope.requireCurrentUserScope(userId);
    const row = state.userSettings.get(userId);
    return createQueryResult<Row>(row === undefined ? [] : [{
      workspace_id: row.workspace_id,
      email: row.email,
      locale: "en",
      accent_color: row.accent_color,
      review_reaction_animations_enabled: true,
      analytics_consent: row.analytics_consent,
      product_analytics_enabled: row.product_analytics_enabled,
      created_at: "2026-04-02T13:00:00.000Z",
    } as unknown as Row]);
  }

  if (text === "INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING") {
    const userId = String(params[0]);
    scope.requireCurrentUserScope(userId);
    if (!state.userSettings.has(userId)) {
      state.userSettings.set(userId, createUserSettingsState(userId, null, null));
    }
    return createQueryResult<Row>([]);
  }

  if (text === "SELECT workspace_id FROM org.user_settings WHERE user_id = $1 FOR UPDATE") {
    const userId = params[0];
    if (typeof userId !== "string") {
      return createQueryResult<Row>([]);
    }

    scope.requireCurrentUserScope(userId);
    const row = state.userSettings.get(userId) ?? null;
    const rows = row === null ? [] : [{ workspace_id: row.workspace_id } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (text === "SELECT user_id FROM org.user_settings WHERE user_id = $1 FOR UPDATE") {
    const userId = params[0];
    if (typeof userId !== "string") {
      return createQueryResult<Row>([]);
    }

    scope.requireCurrentUserScope(userId);
    const row = state.userSettings.get(userId) ?? null;
    const rows = row === null ? [] : [{ user_id: row.user_id } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (text === "SELECT progress_time_zone FROM org.user_settings WHERE user_id = $1 LIMIT 1") {
    const userId = params[0];
    if (typeof userId !== "string") {
      return createQueryResult<Row>([]);
    }

    scope.requireCurrentUserScope(userId);
    const row = state.userSettings.get(userId) ?? null;
    const rows = row === null ? [] : [{ progress_time_zone: row.progress_time_zone } as unknown as Row];
    return createQueryResult<Row>(rows);
  }

  if (text === "SELECT accent_color FROM org.user_settings WHERE user_id = $1") {
    const userId = String(params[0]);
    scope.requireCurrentUserScope(userId);
    const row = state.userSettings.get(userId);
    return createQueryResult<Row>(row === undefined ? [] : [{ accent_color: row.accent_color } as unknown as Row]);
  }

  if (
    text === "UPDATE org.user_settings SET accent_color = CASE WHEN accent_color = '#C44B2D'"
      + " THEN $2::TEXT ELSE accent_color END WHERE user_id = $1 RETURNING user_id"
  ) {
    const userId = String(params[0]);
    scope.requireCurrentUserScope(userId);
    const current = state.userSettings.get(userId);
    if (current === undefined) {
      return createQueryResult<Row>([]);
    }
    state.userSettings.set(userId, {
      ...current,
      accent_color: current.accent_color === "#C44B2D" ? String(params[1]) : current.accent_color,
    });
    return createQueryResult<Row>([{ user_id: userId } as unknown as Row]);
  }

  if (text === "UPDATE org.user_settings SET email = $1 WHERE user_id = $2") {
    const email = params[0] === null ? null : String(params[0]);
    const userId = String(params[1]);
    scope.requireCurrentUserScope(userId);
    const current = state.userSettings.get(userId);
    if (current === undefined) {
      throw new Error(`Missing user_settings row for ${userId}`);
    }
    state.userSettings.set(userId, {
      ...current,
      email,
    });
    return createQueryResult<Row>([]);
  }

  if (
    text === "UPDATE org.user_settings SET analytics_consent = $2 WHERE user_id = $1 AND analytics_consent IS NULL"
  ) {
    const userId = String(params[0]);
    const analyticsConsent = params[1];
    if (analyticsConsent === "granted" || analyticsConsent === "declined") {
      scope.requireCurrentUserScope(userId);
      const current = state.userSettings.get(userId);
      if (current !== undefined && current.analytics_consent === null) {
        state.userSettings.set(userId, {
          ...current,
          analytics_consent: analyticsConsent,
        });
      }

      return createQueryResult<Row>([]);
    }

    // The real column carries a CHECK constraint, so a value outside it fails at the statement that
    // produced it instead of being stored as "no decision" and read back as a confusing assertion.
    throw new Error(
      `Unexpected analytics consent written to org.user_settings for ${userId}:`
      + ` ${String(analyticsConsent)}. Only granted and declined are storable.`,
    );
  }

  if (
    text === "UPDATE org.user_settings SET product_analytics_enabled = $2"
      + " WHERE user_id = $1 AND product_analytics_enabled IS NULL"
  ) {
    const userId = String(params[0]);
    const productAnalyticsEnabled = params[1];
    if (typeof productAnalyticsEnabled !== "boolean") {
      // The real column is BOOLEAN and the carry only runs on a non-null guest answer, so anything
      // else here is the caller being wrong rather than a state the database could hold.
      throw new Error(
        `Unexpected product analytics switch written to org.user_settings for ${userId}:`
        + ` ${String(productAnalyticsEnabled)}. Only true and false are storable.`,
      );
    }

    scope.requireCurrentUserScope(userId);
    const current = state.userSettings.get(userId);
    if (current !== undefined && current.product_analytics_enabled === null) {
      state.userSettings.set(userId, {
        ...current,
        product_analytics_enabled: productAnalyticsEnabled,
      });
    }

    return createQueryResult<Row>([]);
  }

  if (text === "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2") {
    const workspaceId = String(params[0]);
    const userId = String(params[1]);
    scope.requireCurrentUserScope(userId);
    const current = state.userSettings.get(userId) ?? createUserSettingsState(userId, null, null);
    state.userSettings.set(userId, {
      ...current,
      workspace_id: workspaceId,
    });
    return createQueryResult<Row>([]);
  }

  if (text === "DELETE FROM org.user_settings WHERE user_id = $1") {
    const userId = String(params[0]);
    state.userSettings.delete(userId);
    if (state.guestSession?.user_id === userId) {
      state.guestSession = null;
    }
    state.publicProfiles = state.publicProfiles.filter((profile) => profile.user_id !== userId);
    for (const [providerSubject, mappedUserId] of state.identityMappings) {
      if (mappedUserId === userId) {
        state.identityMappings.delete(providerSubject);
      }
    }
    return createQueryResult<Row>([]);
  }

  return null;
}
