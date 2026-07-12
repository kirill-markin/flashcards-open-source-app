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
    text.startsWith("SELECT workspace_id, email, locale, review_reaction_animations_enabled, created_at")
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
      review_reaction_animations_enabled: true,
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
