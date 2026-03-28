import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type pg from "pg";
import type { DatabaseExecutor, SqlValue } from "./db";
import {
  completeGuestUpgradeInExecutor,
  prepareGuestUpgradeInExecutor,
} from "./guestAuth";

type GuestSessionState = Readonly<{
  sessionId: string;
  tokenHash: string;
  userId: string;
  revokedAt: string | null;
}>;

type UserSettingsState = Readonly<{
  workspaceId: string | null;
  email: string | null;
}>;

type WorkspaceSchedulerState = Readonly<{
  fsrs_algorithm: string;
  fsrs_desired_retention: number;
  fsrs_learning_steps_minutes: ReadonlyArray<number>;
  fsrs_relearning_steps_minutes: ReadonlyArray<number>;
  fsrs_maximum_interval_days: number;
  fsrs_enable_fuzz: boolean;
  fsrs_client_updated_at: string;
  fsrs_last_modified_by_device_id: string;
  fsrs_last_operation_id: string;
  fsrs_updated_at: string;
}>;

type WorkspaceState = Readonly<{
  name: string;
  createdAt: string;
  scheduler: WorkspaceSchedulerState;
}>;

type WorkspaceMembershipState = Readonly<{
  workspaceId: string;
  userId: string;
}>;

type SyncDeviceState = Readonly<{
  deviceId: string;
  workspaceId: string;
  userId: string;
  platform: string;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string;
}>;

type CardState = Readonly<{
  cardId: string;
  workspaceId: string;
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  effortLevel: string;
  dueAt: string | null;
  createdAt: string;
  reps: number;
  lapses: number;
  fsrsCardState: string;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: string | null;
  fsrsScheduledDays: number | null;
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

type DeckState = Readonly<{
  deckId: string;
  workspaceId: string;
  name: string;
  filterDefinition: Readonly<Record<string, unknown>>;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

type ReviewEventState = Readonly<{
  reviewEventId: string;
  workspaceId: string;
  cardId: string;
  deviceId: string;
  clientEventId: string;
  rating: number;
  reviewedAtClient: string;
  reviewedAtServer: string;
}>;

type GuestUpgradeHistoryState = Readonly<{
  upgradeId: string;
  sourceGuestUserId: string;
  sourceGuestWorkspaceId: string;
  sourceGuestSessionId: string;
  targetSubjectUserId: string;
  targetUserId: string;
  targetWorkspaceId: string;
  selectionType: string;
}>;

type GuestDeviceAliasState = Readonly<{
  sourceGuestDeviceId: string;
  upgradeId: string;
  targetDeviceId: string;
}>;

type TestState = {
  guestSession: GuestSessionState;
  identityMappings: Map<string, string>;
  userSettingsByUserId: Map<string, UserSettingsState>;
  workspacesById: Map<string, WorkspaceState>;
  memberships: Array<WorkspaceMembershipState>;
  devices: Array<SyncDeviceState>;
  cards: Array<CardState>;
  decks: Array<DeckState>;
  reviewEvents: Array<ReviewEventState>;
  guestUpgradeHistory: Array<GuestUpgradeHistoryState>;
  guestDeviceAliases: Array<GuestDeviceAliasState>;
  queryLog: Array<string>;
  hotChangeCount: number;
};

const guestToken = "guest-token";
const guestSessionId = "0dce7d77-26fd-4d78-bc6e-9fe0e16aa001";
const guestUserId = "guest-user-1";
const guestWorkspaceId = "c3e9aa7f-f4fb-4d56-85ac-90f4dc6a6001";
const targetUserId = "user-1";
const targetSubjectUserId = "cognito-subject-1";
const targetWorkspaceId = "11c2bc56-2c43-4eca-8720-a4bd50c9d001";
const guestDeviceIdA = "38afd4a4-e453-4f44-9915-5a87b63ec001";
const guestDeviceIdB = "38afd4a4-e453-4f44-9915-5a87b63ec002";
const guestCardId = "25906f4c-6cd6-457b-a539-af5a8bf5b001";
const guestDeckId = "45db9304-3210-4f4b-b85f-11df4a254001";
const guestReviewEventId = "9ffbdfca-0e2f-46d5-a7f5-60fbe8077001";
const existingSelectionSql = "SELECT upgrade_id, target_user_id, target_workspace_id, selection_type FROM auth.guest_upgrade_history WHERE source_guest_user_id = $1";
const deviceLookupSql = "SELECT target_device_id, upgrade_id FROM auth.guest_device_aliases WHERE source_guest_device_id = $1";

function hashGuestToken(token: string): string {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

function makeQueryResult<Row extends pg.QueryResultRow>(
  rows: ReadonlyArray<pg.QueryResultRow>,
): pg.QueryResult<Row> {
  return {
    command: rows.length > 0 ? "SELECT" : "UPDATE",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows] as Array<Row>,
  };
}

function makeSchedulerState(
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): WorkspaceSchedulerState {
  return {
    fsrs_algorithm: "fsrs-6",
    fsrs_desired_retention: 0.9,
    fsrs_learning_steps_minutes: [1, 10],
    fsrs_relearning_steps_minutes: [10],
    fsrs_maximum_interval_days: 36500,
    fsrs_enable_fuzz: true,
    fsrs_client_updated_at: clientUpdatedAt,
    fsrs_last_modified_by_device_id: deviceId,
    fsrs_last_operation_id: operationId,
    fsrs_updated_at: clientUpdatedAt,
  };
}

function makeBaseState(existingMappedUserId: string | null): TestState {
  return {
    guestSession: {
      sessionId: guestSessionId,
      tokenHash: hashGuestToken(guestToken),
      userId: guestUserId,
      revokedAt: null,
    },
    identityMappings: existingMappedUserId === null
      ? new Map<string, string>()
      : new Map<string, string>([[targetSubjectUserId, existingMappedUserId]]),
    userSettingsByUserId: new Map<string, UserSettingsState>([
      [guestUserId, { workspaceId: guestWorkspaceId, email: null }],
      [targetUserId, { workspaceId: targetWorkspaceId, email: "target@example.com" }],
    ]),
    workspacesById: new Map<string, WorkspaceState>([
      [guestWorkspaceId, {
        name: "Guest Personal",
        createdAt: "2026-03-01T10:00:00.000Z",
        scheduler: makeSchedulerState("2026-03-15T10:00:00.000Z", guestDeviceIdA, "guest-scheduler-op"),
      }],
      [targetWorkspaceId, {
        name: "Existing Personal",
        createdAt: "2026-03-02T10:00:00.000Z",
        scheduler: makeSchedulerState("2026-03-10T10:00:00.000Z", "7f5720ee-a8cf-4d5b-a3fd-b77b0e086001", "target-scheduler-op"),
      }],
    ]),
    memberships: [
      { workspaceId: guestWorkspaceId, userId: guestUserId },
      { workspaceId: targetWorkspaceId, userId: targetUserId },
    ],
    devices: [
      {
        deviceId: guestDeviceIdA,
        workspaceId: guestWorkspaceId,
        userId: guestUserId,
        platform: "ios",
        appVersion: "1.0.0",
        createdAt: "2026-03-01T10:00:00.000Z",
        lastSeenAt: "2026-03-16T10:00:00.000Z",
      },
      {
        deviceId: guestDeviceIdB,
        workspaceId: guestWorkspaceId,
        userId: guestUserId,
        platform: "android",
        appVersion: "1.0.1",
        createdAt: "2026-03-02T10:00:00.000Z",
        lastSeenAt: "2026-03-16T11:00:00.000Z",
      },
    ],
    cards: [{
      cardId: guestCardId,
      workspaceId: guestWorkspaceId,
      frontText: "Question",
      backText: "Answer",
      tags: ["tag-a"],
      effortLevel: "fast",
      dueAt: null,
      createdAt: "2026-03-03T10:00:00.000Z",
      reps: 2,
      lapses: 1,
      fsrsCardState: "review",
      fsrsStepIndex: null,
      fsrsStability: 11.2,
      fsrsDifficulty: 4.3,
      fsrsLastReviewedAt: "2026-03-14T10:00:00.000Z",
      fsrsScheduledDays: 4,
      clientUpdatedAt: "2026-03-14T10:00:00.000Z",
      lastModifiedByDeviceId: guestDeviceIdA,
      lastOperationId: "guest-card-op",
      updatedAt: "2026-03-14T10:00:00.000Z",
      deletedAt: null,
    }],
    decks: [{
      deckId: guestDeckId,
      workspaceId: guestWorkspaceId,
      name: "Guest Deck",
      filterDefinition: { kind: "all" },
      createdAt: "2026-03-04T10:00:00.000Z",
      clientUpdatedAt: "2026-03-14T10:05:00.000Z",
      lastModifiedByDeviceId: guestDeviceIdB,
      lastOperationId: "guest-deck-op",
      updatedAt: "2026-03-14T10:05:00.000Z",
      deletedAt: null,
    }],
    reviewEvents: [{
      reviewEventId: guestReviewEventId,
      workspaceId: guestWorkspaceId,
      cardId: guestCardId,
      deviceId: guestDeviceIdA,
      clientEventId: "guest-review-client-event",
      rating: 2,
      reviewedAtClient: "2026-03-14T10:00:00.000Z",
      reviewedAtServer: "2026-03-14T10:00:01.000Z",
    }],
    guestUpgradeHistory: [],
    guestDeviceAliases: [],
    queryLog: [],
    hotChangeCount: 0,
  };
}

function hasMembership(
  state: TestState,
  userId: string,
  workspaceId: string,
): boolean {
  return state.memberships.some((membership) =>
    membership.userId === userId && membership.workspaceId === workspaceId);
}

function makeExecutor(state: TestState): DatabaseExecutor {
  return {
    async query<Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      state.queryLog.push(text);

      if (text.includes("set_config('app.user_id'")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("FROM auth.guest_sessions")) {
        return params[0] === state.guestSession.tokenHash && state.guestSession.revokedAt === null
          ? makeQueryResult<Row>([{
            session_id: state.guestSession.sessionId,
            user_id: state.guestSession.userId,
            revoked_at: state.guestSession.revokedAt,
          }])
          : makeQueryResult<Row>([]);
      }

      if (text.includes("FROM auth.user_identities")) {
        const providerSubject = params[0];
        if (typeof providerSubject !== "string") {
          throw new Error("Expected provider subject to be a string");
        }

        const userId = state.identityMappings.get(providerSubject);
        return userId === undefined
          ? makeQueryResult<Row>([])
          : makeQueryResult<Row>([{ user_id: userId }]);
      }

      if (text.includes("INSERT INTO auth.user_identities")) {
        const providerSubject = params[0];
        const userId = params[1];
        if (typeof providerSubject !== "string" || typeof userId !== "string") {
          throw new Error("Expected user identity insert params to be strings");
        }

        if (state.identityMappings.has(providerSubject) === false) {
          state.identityMappings.set(providerSubject, userId);
        }
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT workspace_id FROM org.user_settings WHERE user_id = $1 FOR UPDATE")) {
        const userId = params[0];
        if (typeof userId !== "string") {
          throw new Error("Expected user settings lookup user id to be a string");
        }

        const userSettings = state.userSettingsByUserId.get(userId);
        return userSettings === undefined
          ? makeQueryResult<Row>([])
          : makeQueryResult<Row>([{ workspace_id: userSettings.workspaceId }]);
      }

      if (text.includes("UPDATE org.user_settings SET email = $1 WHERE user_id = $2")) {
        const email = params[0];
        const userId = params[1];
        if (typeof userId !== "string") {
          throw new Error("Expected user id for email update");
        }

        const currentUserSettings = state.userSettingsByUserId.get(userId);
        if (currentUserSettings !== undefined) {
          state.userSettingsByUserId.set(userId, {
            ...currentUserSettings,
            email: typeof email === "string" ? email : null,
          });
        }
        return makeQueryResult<Row>([]);
      }

      if (text.includes("SELECT workspaces.workspace_id, workspaces.name, workspaces.created_at")) {
        const userId = params[0];
        const workspaceId = params[1];
        if (typeof userId !== "string" || typeof workspaceId !== "string") {
          throw new Error("Expected workspace summary params to be strings");
        }

        if (hasMembership(state, userId, workspaceId) === false) {
          return makeQueryResult<Row>([]);
        }

        const workspace = state.workspacesById.get(workspaceId);
        if (workspace === undefined) {
          return makeQueryResult<Row>([]);
        }

        return makeQueryResult<Row>([{
          workspace_id: workspaceId,
          name: workspace.name,
          created_at: workspace.createdAt,
        }]);
      }

      if (text.includes("FROM sync.devices")) {
        const workspaceId = params[0];
        if (typeof workspaceId !== "string") {
          throw new Error("Expected device lookup workspace id to be a string");
        }

        return makeQueryResult<Row>(state.devices
          .filter((device) => device.workspaceId === workspaceId)
          .map((device) => ({
            device_id: device.deviceId,
            platform: device.platform,
            app_version: device.appVersion,
            created_at: device.createdAt,
            last_seen_at: device.lastSeenAt,
          })));
      }

      if (text.includes("FROM content.cards")) {
        const workspaceId = params[0];
        if (typeof workspaceId !== "string") {
          throw new Error("Expected card lookup workspace id to be a string");
        }

        return makeQueryResult<Row>(state.cards
          .filter((card) => card.workspaceId === workspaceId)
          .map((card) => ({
            card_id: card.cardId,
            front_text: card.frontText,
            back_text: card.backText,
            tags: card.tags,
            effort_level: card.effortLevel,
            due_at: card.dueAt,
            created_at: card.createdAt,
            reps: card.reps,
            lapses: card.lapses,
            fsrs_card_state: card.fsrsCardState,
            fsrs_step_index: card.fsrsStepIndex,
            fsrs_stability: card.fsrsStability,
            fsrs_difficulty: card.fsrsDifficulty,
            fsrs_last_reviewed_at: card.fsrsLastReviewedAt,
            fsrs_scheduled_days: card.fsrsScheduledDays,
            client_updated_at: card.clientUpdatedAt,
            last_modified_by_device_id: card.lastModifiedByDeviceId,
            last_operation_id: card.lastOperationId,
            updated_at: card.updatedAt,
            deleted_at: card.deletedAt,
          })));
      }

      if (text.includes("FROM content.decks")) {
        const workspaceId = params[0];
        if (typeof workspaceId !== "string") {
          throw new Error("Expected deck lookup workspace id to be a string");
        }

        return makeQueryResult<Row>(state.decks
          .filter((deck) => deck.workspaceId === workspaceId)
          .map((deck) => ({
            deck_id: deck.deckId,
            name: deck.name,
            filter_definition: deck.filterDefinition,
            created_at: deck.createdAt,
            client_updated_at: deck.clientUpdatedAt,
            last_modified_by_device_id: deck.lastModifiedByDeviceId,
            last_operation_id: deck.lastOperationId,
            updated_at: deck.updatedAt,
            deleted_at: deck.deletedAt,
          })));
      }

      if (text.includes("FROM content.review_events")) {
        const workspaceId = params[0];
        if (typeof workspaceId !== "string") {
          throw new Error("Expected review-event lookup workspace id to be a string");
        }

        return makeQueryResult<Row>(state.reviewEvents
          .filter((reviewEvent) => reviewEvent.workspaceId === workspaceId)
          .map((reviewEvent) => ({
            review_event_id: reviewEvent.reviewEventId,
            card_id: reviewEvent.cardId,
            device_id: reviewEvent.deviceId,
            client_event_id: reviewEvent.clientEventId,
            rating: reviewEvent.rating,
            reviewed_at_client: reviewEvent.reviewedAtClient,
            reviewed_at_server: reviewEvent.reviewedAtServer,
          })));
      }

      if (text.includes("FROM org.workspaces") && text.includes("fsrs_algorithm")) {
        const workspaceId = params[0];
        if (typeof workspaceId !== "string") {
          throw new Error("Expected scheduler lookup workspace id to be a string");
        }

        const workspace = state.workspacesById.get(workspaceId);
        return workspace === undefined
          ? makeQueryResult<Row>([])
          : makeQueryResult<Row>([workspace.scheduler]);
      }

      if (text.includes("DELETE FROM content.decks")) {
        const workspaceId = params[0];
        if (typeof workspaceId !== "string") {
          throw new Error("Expected deck delete workspace id to be a string");
        }

        state.decks = state.decks.filter((deck) => deck.workspaceId !== workspaceId);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("DELETE FROM content.cards")) {
        const workspaceId = params[0];
        if (typeof workspaceId !== "string") {
          throw new Error("Expected card delete workspace id to be a string");
        }

        state.cards = state.cards.filter((card) => card.workspaceId !== workspaceId);
        state.reviewEvents = state.reviewEvents.filter((reviewEvent) => reviewEvent.workspaceId !== workspaceId);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO sync.workspace_sync_metadata")) {
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO sync.hot_changes")) {
        state.hotChangeCount += 1;
        return makeQueryResult<Row>([{ change_id: state.hotChangeCount }]);
      }

      if (text.includes("INSERT INTO sync.devices")) {
        const deviceId = params[0];
        const workspaceId = params[1];
        const userId = params[2];
        const platform = params[3];
        const appVersion = params[4];
        const createdAt = params[5];
        const lastSeenAt = params[6];

        if (
          typeof deviceId !== "string"
          || typeof workspaceId !== "string"
          || typeof userId !== "string"
          || typeof platform !== "string"
        ) {
          throw new Error("Expected sync device insert params to be strings");
        }

        state.devices.push({
          deviceId,
          workspaceId,
          userId,
          platform,
          appVersion: typeof appVersion === "string" ? appVersion : null,
          createdAt: typeof createdAt === "string" ? createdAt : "2026-03-20T10:00:00.000Z",
          lastSeenAt: typeof lastSeenAt === "string" ? lastSeenAt : "2026-03-20T10:00:00.000Z",
        });
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO content.cards")) {
        const nextCard: CardState = {
          cardId: String(params[0]),
          workspaceId: String(params[1]),
          frontText: String(params[2]),
          backText: String(params[3]),
          tags: params[4] as ReadonlyArray<string>,
          effortLevel: String(params[5]),
          dueAt: params[6] === null ? null : String(params[6]),
          reps: Number(params[7]),
          lapses: Number(params[8]),
          updatedAt: String(params[9]),
          deletedAt: params[10] === null ? null : String(params[10]),
          fsrsCardState: String(params[11]),
          fsrsStepIndex: params[12] === null ? null : Number(params[12]),
          fsrsStability: params[13] === null ? null : Number(params[13]),
          fsrsDifficulty: params[14] === null ? null : Number(params[14]),
          fsrsLastReviewedAt: params[15] === null ? null : String(params[15]),
          fsrsScheduledDays: params[16] === null ? null : Number(params[16]),
          clientUpdatedAt: String(params[17]),
          lastModifiedByDeviceId: String(params[18]),
          lastOperationId: String(params[19]),
          createdAt: String(params[20]),
        };
        state.cards.push(nextCard);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO content.decks")) {
        state.decks.push({
          deckId: String(params[0]),
          workspaceId: String(params[1]),
          name: String(params[2]),
          filterDefinition: JSON.parse(String(params[3])) as Readonly<Record<string, unknown>>,
          createdAt: String(params[4]),
          updatedAt: String(params[5]),
          deletedAt: params[6] === null ? null : String(params[6]),
          clientUpdatedAt: String(params[7]),
          lastModifiedByDeviceId: String(params[8]),
          lastOperationId: String(params[9]),
        });
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO content.review_events")) {
        state.reviewEvents.push({
          reviewEventId: String(params[0]),
          workspaceId: String(params[1]),
          cardId: String(params[2]),
          deviceId: String(params[3]),
          clientEventId: String(params[4]),
          rating: Number(params[5]),
          reviewedAtClient: String(params[6]),
          reviewedAtServer: String(params[7]),
        });
        return makeQueryResult<Row>([]);
      }

      if (text.includes("UPDATE org.workspaces") && text.includes("fsrs_algorithm = $1")) {
        const workspaceId = params[10];
        if (typeof workspaceId !== "string") {
          throw new Error("Expected scheduler update workspace id to be a string");
        }

        const currentWorkspace = state.workspacesById.get(workspaceId);
        if (currentWorkspace !== undefined) {
          state.workspacesById.set(workspaceId, {
            ...currentWorkspace,
            scheduler: {
              fsrs_algorithm: String(params[0]),
              fsrs_desired_retention: Number(params[1]),
              fsrs_learning_steps_minutes: JSON.parse(String(params[2])) as ReadonlyArray<number>,
              fsrs_relearning_steps_minutes: JSON.parse(String(params[3])) as ReadonlyArray<number>,
              fsrs_maximum_interval_days: Number(params[4]),
              fsrs_enable_fuzz: Boolean(params[5]),
              fsrs_client_updated_at: String(params[6]),
              fsrs_last_modified_by_device_id: String(params[7]),
              fsrs_last_operation_id: String(params[8]),
              fsrs_updated_at: String(params[9]),
            },
          });
        }
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO auth.guest_upgrade_history")) {
        state.guestUpgradeHistory.push({
          upgradeId: String(params[0]),
          sourceGuestUserId: String(params[1]),
          sourceGuestWorkspaceId: String(params[2]),
          sourceGuestSessionId: String(params[3]),
          targetSubjectUserId: String(params[4]),
          targetUserId: String(params[5]),
          targetWorkspaceId: String(params[6]),
          selectionType: String(params[7]),
        });
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO auth.guest_device_aliases")) {
        state.guestDeviceAliases.push({
          sourceGuestDeviceId: String(params[0]),
          upgradeId: String(params[1]),
          targetDeviceId: String(params[2]),
        });
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO org.user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING")) {
        const userId = params[0];
        if (typeof userId !== "string") {
          throw new Error("Expected user settings insert user id to be a string");
        }

        if (state.userSettingsByUserId.has(userId) === false) {
          state.userSettingsByUserId.set(userId, { workspaceId: null, email: null });
        }
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO org.workspaces")) {
        const workspaceId = params[0];
        const name = params[1];
        const bootstrapTimestamp = params[2];
        const bootstrapDeviceId = params[3];
        const bootstrapOperationId = params[4];
        if (
          typeof workspaceId !== "string"
          || typeof name !== "string"
          || typeof bootstrapTimestamp !== "string"
          || typeof bootstrapDeviceId !== "string"
          || typeof bootstrapOperationId !== "string"
        ) {
          throw new Error("Expected workspace insert params to be strings");
        }

        state.workspacesById.set(workspaceId, {
          name,
          createdAt: "2026-03-20T10:00:00.000Z",
          scheduler: makeSchedulerState(bootstrapTimestamp, bootstrapDeviceId, bootstrapOperationId),
        });
        return makeQueryResult<Row>([]);
      }

      if (text.includes("INSERT INTO org.workspace_memberships")) {
        const workspaceId = params[0];
        const userId = params[1];
        if (typeof workspaceId !== "string" || typeof userId !== "string") {
          throw new Error("Expected workspace membership params to be strings");
        }

        state.memberships.push({ workspaceId, userId });
        return makeQueryResult<Row>([]);
      }

      if (text.includes("UPDATE org.user_settings SET workspace_id = $1 WHERE user_id = $2")) {
        const workspaceId = params[0];
        const userId = params[1];
        if (typeof workspaceId !== "string" || typeof userId !== "string") {
          throw new Error("Expected workspace selection params to be strings");
        }

        const currentUserSettings = state.userSettingsByUserId.get(userId);
        if (currentUserSettings !== undefined) {
          state.userSettingsByUserId.set(userId, {
            ...currentUserSettings,
            workspaceId,
          });
        }
        return makeQueryResult<Row>([]);
      }

      if (text.includes("UPDATE auth.guest_sessions SET revoked_at = now()")) {
        const sessionId = params[0];
        if (typeof sessionId !== "string") {
          throw new Error("Expected guest session id to be a string");
        }

        if (state.guestSession.sessionId === sessionId) {
          state.guestSession = {
            ...state.guestSession,
            revokedAt: "2026-03-20T11:00:00.000Z",
          };
        }
        return makeQueryResult<Row>([]);
      }

      if (text.includes("DELETE FROM org.workspaces WHERE workspace_id = $1")) {
        const workspaceId = params[0];
        if (typeof workspaceId !== "string") {
          throw new Error("Expected workspace delete id to be a string");
        }

        state.workspacesById.delete(workspaceId);
        state.memberships = state.memberships.filter((membership) => membership.workspaceId !== workspaceId);
        state.devices = state.devices.filter((device) => device.workspaceId !== workspaceId);
        return makeQueryResult<Row>([]);
      }

      if (text.includes("DELETE FROM org.user_settings WHERE user_id = $1")) {
        const userId = params[0];
        if (typeof userId !== "string") {
          throw new Error("Expected user delete id to be a string");
        }

        state.userSettingsByUserId.delete(userId);
        state.identityMappings = new Map<string, string>(
          [...state.identityMappings.entries()].filter((entry) => entry[1] !== userId),
        );
        return makeQueryResult<Row>([]);
      }

      if (text === existingSelectionSql) {
        const sourceGuestUserId = params[0];
        if (typeof sourceGuestUserId !== "string") {
          throw new Error("Expected source guest user id lookup param to be a string");
        }

        return makeQueryResult<Row>(state.guestUpgradeHistory
          .filter((row) => row.sourceGuestUserId === sourceGuestUserId)
          .map((row) => ({
            upgrade_id: row.upgradeId,
            target_user_id: row.targetUserId,
            target_workspace_id: row.targetWorkspaceId,
            selection_type: row.selectionType,
          })));
      }

      if (text === deviceLookupSql) {
        const sourceGuestDeviceId = params[0];
        if (typeof sourceGuestDeviceId !== "string") {
          throw new Error("Expected source guest device id lookup param to be a string");
        }

        return makeQueryResult<Row>(state.guestDeviceAliases
          .filter((row) => row.sourceGuestDeviceId === sourceGuestDeviceId)
          .map((row) => ({
            target_device_id: row.targetDeviceId,
            upgrade_id: row.upgradeId,
          })));
      }

      throw new Error(`Unexpected SQL in guestAuth test: ${text}`);
    },
  };
}

test("prepareGuestUpgradeInExecutor binds an unmapped subject without destructive merge history", async () => {
  const state = makeBaseState(null);
  const executor = makeExecutor(state);

  const result = await prepareGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubjectUserId,
    "guest@example.com",
  );

  assert.equal(result.mode, "bound");
  assert.equal(state.identityMappings.get(targetSubjectUserId), guestUserId);
  assert.equal(state.userSettingsByUserId.get(guestUserId)?.email, "guest@example.com");
  assert.equal(state.guestUpgradeHistory.length, 0);
  assert.equal(state.guestDeviceAliases.length, 0);
});

test("completeGuestUpgradeInExecutor records durable history and aliases before destructive cleanup for existing workspace selection", async () => {
  const state = makeBaseState(targetUserId);
  const executor = makeExecutor(state);

  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubjectUserId,
    {
      type: "existing",
      workspaceId: targetWorkspaceId,
    },
  );

  assert.equal(result.workspace.workspaceId, targetWorkspaceId);
  assert.equal(state.guestUpgradeHistory.length, 1);
  assert.equal(state.guestDeviceAliases.length, 2);
  assert.equal(state.userSettingsByUserId.has(guestUserId), false);
  assert.equal(state.workspacesById.has(guestWorkspaceId), false);
  assert.equal(state.hotChangeCount, 3);

  const historyRow = state.guestUpgradeHistory[0];
  assert.equal(historyRow?.sourceGuestUserId, guestUserId);
  assert.equal(historyRow?.sourceGuestWorkspaceId, guestWorkspaceId);
  assert.equal(historyRow?.sourceGuestSessionId, guestSessionId);
  assert.equal(historyRow?.targetSubjectUserId, targetSubjectUserId);
  assert.equal(historyRow?.targetUserId, targetUserId);
  assert.equal(historyRow?.targetWorkspaceId, targetWorkspaceId);
  assert.equal(historyRow?.selectionType, "existing");
  assert.match(historyRow?.upgradeId ?? "", /^[0-9a-f-]{36}$/);

  const historyLookup = await executor.query<Readonly<{
    upgrade_id: string;
    target_user_id: string;
    target_workspace_id: string;
    selection_type: string;
  }>>(existingSelectionSql, [guestUserId]);
  assert.deepEqual(historyLookup.rows, [{
    upgrade_id: historyRow?.upgradeId,
    target_user_id: targetUserId,
    target_workspace_id: targetWorkspaceId,
    selection_type: "existing",
  }]);

  const aliasLookup = await executor.query<Readonly<{
    target_device_id: string;
    upgrade_id: string;
  }>>(deviceLookupSql, [guestDeviceIdA]);
  assert.equal(aliasLookup.rows.length, 1);
  assert.equal(aliasLookup.rows[0]?.upgrade_id, historyRow?.upgradeId);
  assert.notEqual(aliasLookup.rows[0]?.target_device_id, guestDeviceIdA);

  const historyInsertIndex = state.queryLog.findIndex((query) => query.includes("INSERT INTO auth.guest_upgrade_history"));
  const workspaceDeleteIndex = state.queryLog.findIndex((query) => query.includes("DELETE FROM org.workspaces"));
  const userDeleteIndex = state.queryLog.findIndex((query) => query.includes("DELETE FROM org.user_settings"));
  assert.notEqual(historyInsertIndex, -1);
  assert.notEqual(workspaceDeleteIndex, -1);
  assert.notEqual(userDeleteIndex, -1);
  assert.ok(historyInsertIndex < workspaceDeleteIndex);
  assert.ok(historyInsertIndex < userDeleteIndex);
});

test("completeGuestUpgradeInExecutor records create_new selection in durable history", async () => {
  const state = makeBaseState(targetUserId);
  const executor = makeExecutor(state);

  const result = await completeGuestUpgradeInExecutor(
    executor,
    guestToken,
    targetSubjectUserId,
    {
      type: "create_new",
    },
  );

  assert.equal(state.guestUpgradeHistory.length, 1);
  const historyRow = state.guestUpgradeHistory[0];
  assert.equal(historyRow?.selectionType, "create_new");
  assert.equal(historyRow?.targetUserId, targetUserId);
  assert.equal(historyRow?.targetWorkspaceId, result.workspace.workspaceId);
  assert.notEqual(result.workspace.workspaceId, targetWorkspaceId);
  assert.equal(state.userSettingsByUserId.get(targetUserId)?.workspaceId, result.workspace.workspaceId);
  assert.equal(state.guestDeviceAliases.length, 2);
});
