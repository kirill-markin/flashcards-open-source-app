import assert from "node:assert/strict";
import type pg from "pg";
import type { DatabaseExecutor } from "../database";
import { handleAuthExecutorQuery } from "./handlers/auth";
import { handleContentExecutorQuery } from "./handlers/content";
import { handleSyncExecutorQuery } from "./handlers/sync";
import { handleUserSettingsExecutorQuery } from "./handlers/userSettings";
import { handleWorkspaceExecutorQuery } from "./handlers/workspaces";
import {
  type GuestUpgradeExecutorParam,
  type GuestUpgradeHandlerContext,
  type MutableState,
  type PublicProfileState,
  type PublicReviewActivityFactState,
} from "./models";
import { createQueryResult } from "./queryResult";

function handleExecutorScopeQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  const { state } = context;

  if (!text.includes("set_config('app.user_id'")) {
    return null;
  }

  state.currentUserId = typeof params[0] === "string" ? params[0] : null;
  state.currentWorkspaceId = typeof params[1] === "string" && params[1] !== "" ? params[1] : null;
  return createQueryResult<Row>([]);
}

function handleFeedbackExecutorQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  if (text !== "SELECT support.transfer_guest_feedback($1, $2, $3, $4)") {
    return null;
  }

  const { state } = context;
  const sourceGuestUserId = String(params[0]);
  const sourceGuestWorkspaceId = String(params[1]);
  const targetUserId = String(params[2]);
  const targetWorkspaceId = String(params[3]);
  context.scope.requireCurrentWorkspaceScope(targetUserId, targetWorkspaceId);

  state.feedbackPromptEvents = state.feedbackPromptEvents.map((event) => {
    if (event.user_id !== sourceGuestUserId) {
      return event;
    }

    return {
      ...event,
      user_id: targetUserId,
      workspace_id: event.workspace_id === sourceGuestWorkspaceId
        ? targetWorkspaceId
        : event.workspace_id,
    };
  });
  state.feedbackSubmissions = state.feedbackSubmissions.map((submission) => {
    if (submission.user_id !== sourceGuestUserId) {
      return submission;
    }

    return {
      ...submission,
      user_id: targetUserId,
      workspace_id: submission.workspace_id === sourceGuestWorkspaceId
        ? targetWorkspaceId
        : submission.workspace_id,
    };
  });

  return createQueryResult<Row>([]);
}

function handleCommunityProfileExecutorQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  if (text !== "SELECT community.transfer_guest_public_profile($1, $2)") {
    return null;
  }

  const { state } = context;
  const sourceGuestUserId = String(params[0]);
  const targetUserId = String(params[1]);
  context.scope.requireCurrentUserScope(targetUserId);

  const sourceProfile = state.publicProfiles.find((profile) => profile.user_id === sourceGuestUserId);
  if (sourceProfile === undefined) {
    return createQueryResult<Row>([]);
  }

  const targetProfile = state.publicProfiles.find((profile) => profile.user_id === targetUserId);
  if (targetProfile === undefined) {
    state.publicProfiles = state.publicProfiles.map((profile) => {
      if (profile.user_id !== sourceGuestUserId) {
        return profile;
      }

      return {
        ...profile,
        user_id: targetUserId,
      };
    });
    return createQueryResult<Row>([]);
  }

  state.publicProfiles = state.publicProfiles.map((profile) => {
    if (profile.user_id !== targetUserId) {
      return profile;
    }

    return {
      ...profile,
      leaderboard_participation_enabled: (
        profile.leaderboard_participation_enabled
        && sourceProfile.leaderboard_participation_enabled
      ),
    };
  });

  return createQueryResult<Row>([]);
}

function toPublicProfileRow<Row extends pg.QueryResultRow>(profile: PublicProfileState): Row {
  return {
    public_profile_id: profile.public_profile_id,
    leaderboard_participation_enabled: profile.leaderboard_participation_enabled,
  } as unknown as Row;
}

function handleCommunityActivityExecutorQuery<Row extends pg.QueryResultRow>(
  context: GuestUpgradeHandlerContext,
  text: string,
  params: ReadonlyArray<GuestUpgradeExecutorParam>,
): pg.QueryResult<Row> | null {
  const { state } = context;

  if (text === "SELECT security.current_user_id() AS user_id") {
    return createQueryResult<Row>([{ user_id: state.currentUserId } as unknown as Row]);
  }

  if (
    text.startsWith("SELECT public_profile_id, leaderboard_participation_enabled")
    && text.includes("FROM community.public_profiles")
    && text.includes("WHERE user_id = $1")
  ) {
    const userId = typeof params[0] === "string" ? params[0] : null;
    const profile = state.publicProfiles.find((entry) => entry.user_id === userId);
    return createQueryResult<Row>(profile === undefined ? [] : [toPublicProfileRow<Row>(profile)]);
  }

  if (
    text.startsWith("WITH inserted_profile AS")
    && text.includes("INSERT INTO community.public_profiles")
  ) {
    const userId = typeof params[0] === "string" ? params[0] : null;
    const publicProfileId = typeof params[1] === "string" ? params[1] : null;
    if (userId === null || publicProfileId === null) {
      return createQueryResult<Row>([]);
    }

    const existingProfile = state.publicProfiles.find((entry) => entry.user_id === userId);
    if (existingProfile !== undefined) {
      return createQueryResult<Row>([toPublicProfileRow<Row>(existingProfile)]);
    }

    if (state.publicProfiles.some((entry) => entry.public_profile_id === publicProfileId)) {
      return createQueryResult<Row>([]);
    }

    const insertedProfile: PublicProfileState = {
      user_id: userId,
      public_profile_id: publicProfileId,
      leaderboard_participation_enabled: true,
    };
    state.publicProfiles.push(insertedProfile);
    return createQueryResult<Row>([toPublicProfileRow<Row>(insertedProfile)]);
  }

  if (
    text.startsWith("INSERT INTO community.public_review_activity_facts")
    && text.includes("ON CONFLICT (review_event_id, metric_version) DO NOTHING")
  ) {
    const reviewEventId = String(params[0]);
    const metricVersion = String(params[1]);
    const alreadyStored = state.publicReviewActivityFacts.some(
      (fact) => fact.review_event_id === reviewEventId && fact.metric_version === metricVersion,
    );
    if (alreadyStored) {
      return createQueryResult<Row>([]);
    }

    const insertedFact: PublicReviewActivityFactState = {
      review_event_id: reviewEventId,
      metric_version: metricVersion,
      public_profile_id: String(params[2]),
      reviewed_by_user_id: params[3] === null ? null : String(params[3]),
      rating: Number(params[4]),
      reviewed_at_client: String(params[5]),
      reviewed_at_server: String(params[6]),
      is_countable: Boolean(params[7]),
      exclusion_reason: params[8] === null ? null : String(params[8]),
    };
    state.publicReviewActivityFacts.push(insertedFact);
    return createQueryResult<Row>([]);
  }

  return null;
}

function handleSchemaExecutorQuery<Row extends pg.QueryResultRow>(
  text: string,
): pg.QueryResult<Row> | null {
  if (
    !text.includes("FROM information_schema.columns")
    || !text.includes("table_schema = 'auth'")
    || !text.includes("table_name = 'guest_sessions'")
    || !text.includes("column_name = 'platform'")
  ) {
    return null;
  }

  return createQueryResult<Row>([{ column_exists: true } as unknown as Row]);
}

export function createGuestUpgradeExecutor(state: MutableState): DatabaseExecutor {
  function requireCurrentUserScope(userId: string): void {
    assert.equal(
      state.currentUserId,
      userId,
      `Expected app.user_id scope ${userId}, got ${state.currentUserId ?? "null"}`,
    );
  }

  function requireCurrentWorkspaceScope(userId: string, workspaceId: string): void {
    requireCurrentUserScope(userId);
    assert.equal(
      state.currentWorkspaceId,
      workspaceId,
      `Expected app.workspace_id scope ${workspaceId}, got ${state.currentWorkspaceId ?? "null"}`,
    );
  }

  const context: GuestUpgradeHandlerContext = {
    state,
    scope: {
      requireCurrentUserScope,
      requireCurrentWorkspaceScope,
    },
  };

  return {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<GuestUpgradeExecutorParam>,
    ): Promise<pg.QueryResult<Row>> {
      const scopeResult = handleExecutorScopeQuery<Row>(context, text, params);
      if (scopeResult !== null) {
        return scopeResult;
      }

      const schemaResult = handleSchemaExecutorQuery<Row>(text);
      if (schemaResult !== null) {
        return schemaResult;
      }

      const authResult = handleAuthExecutorQuery<Row>(context, text, params);
      if (authResult !== null) {
        return authResult;
      }

      const userSettingsResult = handleUserSettingsExecutorQuery<Row>(context, text, params);
      if (userSettingsResult !== null) {
        return userSettingsResult;
      }

      const workspaceResult = handleWorkspaceExecutorQuery<Row>(context, text, params);
      if (workspaceResult !== null) {
        return workspaceResult;
      }

      const syncResult = handleSyncExecutorQuery<Row>(context, text, params);
      if (syncResult !== null) {
        return syncResult;
      }

      const contentResult = handleContentExecutorQuery<Row>(context, text, params);
      if (contentResult !== null) {
        return contentResult;
      }

      const feedbackResult = handleFeedbackExecutorQuery<Row>(context, text, params);
      if (feedbackResult !== null) {
        return feedbackResult;
      }

      const communityProfileResult = handleCommunityProfileExecutorQuery<Row>(context, text, params);
      if (communityProfileResult !== null) {
        return communityProfileResult;
      }

      const communityActivityResult = handleCommunityActivityExecutorQuery<Row>(context, text, params);
      if (communityActivityResult !== null) {
        return communityActivityResult;
      }

      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

export function isGuestUpgradeMergeOnlyExecutorQuery(text: string): boolean {
  return (
    text.includes("FROM information_schema.columns")
    && text.includes("table_schema = 'auth'")
    && text.includes("table_name = 'guest_sessions'")
    && text.includes("column_name = 'platform'")
  )
    || text.includes("FROM sync.claim_installation")
    || (text.includes("pg_advisory_xact_lock") && text.includes("hashtextextended"))
    || (
      text.startsWith("SELECT")
      && text.includes("FROM org.workspaces AS workspaces")
      && text.includes("security.user_has_workspace_access(workspaces.workspace_id)")
      && text.includes("FOR KEY SHARE OF workspaces")
    )
    || (text.startsWith("SELECT") && text.includes("FROM sync.workspace_replicas"))
    || text.includes("INSERT INTO sync.workspace_replicas")
    || text.includes("UPDATE sync.workspace_replicas")
    || text.includes("INSERT INTO auth.guest_upgrade_history")
    || text.includes("INSERT INTO auth.guest_replica_aliases")
    || text === "SELECT support.transfer_guest_feedback($1, $2, $3, $4)"
    || text === "SELECT community.transfer_guest_public_profile($1, $2)"
    || text === "UPDATE auth.guest_sessions SET revoked_at = now() WHERE session_id = $1"
    || text === "SELECT workspace_id FROM sync.find_conflicting_workspace_id($1, $2) LIMIT 1"
    || text.includes("FROM sync.hot_changes")
    || text.includes("INSERT INTO sync.hot_changes")
    || text === "SELECT progress_time_zone FROM org.user_settings WHERE user_id = $1 LIMIT 1"
    || text.startsWith("DELETE FROM content.")
    || text.startsWith("INSERT INTO content.")
    || text.startsWith("UPDATE content.")
    || text.startsWith("DELETE FROM org.workspaces")
    || text === "DELETE FROM org.user_settings WHERE user_id = $1"
    || text
      === "INSERT INTO org.workspaces ( workspace_id, name, fsrs_client_updated_at, fsrs_last_modified_by_replica_id, fsrs_last_operation_id ) VALUES ($1, $2, $3, $4, $5)"
    || text === "INSERT INTO org.workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')"
    || text
      === "INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at) VALUES ($1, 0, now()) ON CONFLICT (workspace_id) DO NOTHING"
    || text === "UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2"
    || text.startsWith("UPDATE org.workspaces SET");
}
