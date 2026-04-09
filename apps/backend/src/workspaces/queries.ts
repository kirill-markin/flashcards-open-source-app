import {
  queryWithUserScope,
  type DatabaseExecutor,
} from "../db";
import { HttpError } from "../errors";
import {
  encodeOpaqueCursor,
  type CursorPageInput,
} from "../pagination";
import {
  createWorkspaceInvariantError,
  decodeWorkspacePageCursor,
  mapWorkspaceSummary,
  toIsoString,
  type TimestampValue,
} from "./shared";
import type {
  WorkspaceSummary,
  WorkspaceSummaryPage,
} from "./types";

type WorkspaceSummaryRow = Readonly<{
  workspace_id: string;
  name: string;
  created_at: TimestampValue;
}>;

type WorkspaceMembershipRow = Readonly<{
  workspace_id: string;
}>;

type WorkspaceManagementRow = Readonly<{
  workspace_id: string;
  name: string;
  created_at: TimestampValue;
  role: string;
  member_count: number;
}>;

type ActiveCardCountRow = Readonly<{
  active_card_count: string | number;
}>;

type ResettableCardCountRow = Readonly<{
  cards_to_reset_count: string | number;
}>;

type ResettableCardIdRow = Readonly<{
  card_id: string;
}>;

type UserSettingsWorkspaceRow = Readonly<{
  workspace_id: string | null;
}>;

const maximumWorkspacePageSize = 100;

function getResettableCardPredicateSql(): string {
  return [
    "workspace_id = $1",
    "AND deleted_at IS NULL",
    "AND (",
    "due_at IS NOT NULL",
    "OR reps <> 0",
    "OR lapses <> 0",
    "OR fsrs_card_state <> 'new'",
    "OR fsrs_step_index IS NOT NULL",
    "OR fsrs_stability IS NOT NULL",
    "OR fsrs_difficulty IS NOT NULL",
    "OR fsrs_last_reviewed_at IS NOT NULL",
    "OR fsrs_scheduled_days IS NOT NULL",
    ")",
  ].join(" ");
}

async function loadWorkspaceMembershipRowInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMembershipRow | null> {
  const result = await executor.query<WorkspaceMembershipRow>(
    [
      "SELECT workspace_id",
      "FROM org.workspace_memberships",
      "WHERE user_id = $1 AND workspace_id = $2",
    ].join(" "),
    [userId, workspaceId],
  );

  return result.rows[0] ?? null;
}

export async function assertUserHasWorkspaceMembershipInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const membership = await loadWorkspaceMembershipRowInExecutor(executor, userId, workspaceId);
  if (membership === null) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }
}

export async function listUserWorkspaceIdsInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<ReadonlyArray<string>> {
  const result = await executor.query<WorkspaceMembershipRow>(
    [
      "SELECT memberships.workspace_id",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1",
      "ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC",
    ].join(" "),
    [userId],
  );

  return result.rows.map((row) => row.workspace_id);
}

export async function loadSelectedWorkspaceIdInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<string | null> {
  const result = await executor.query<UserSettingsWorkspaceRow>(
    "SELECT workspace_id FROM org.user_settings WHERE user_id = $1",
    [userId],
  );

  return result.rows[0]?.workspace_id ?? null;
}

export async function loadWorkspaceSummaryInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  selectedWorkspaceId: string | null,
): Promise<WorkspaceSummary> {
  const result = await executor.query<WorkspaceSummaryRow>(
    [
      "SELECT",
      "workspaces.workspace_id,",
      "workspaces.name,",
      "workspaces.created_at",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1 AND memberships.workspace_id = $2",
    ].join(" "),
    [userId, workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return mapWorkspaceSummary(row, selectedWorkspaceId);
}

export async function loadWorkspaceManagementRowInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceManagementRow> {
  const result = await executor.query<WorkspaceManagementRow>(
    [
      "SELECT",
      "workspaces.workspace_id,",
      "workspaces.name,",
      "workspaces.created_at,",
      "memberships.role,",
      "(",
      "SELECT COUNT(*)::int",
      "FROM org.workspace_memberships all_memberships",
      "WHERE all_memberships.workspace_id = memberships.workspace_id",
      ") AS member_count",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1 AND memberships.workspace_id = $2",
    ].join(" "),
    [userId, workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
  }

  return row;
}

export async function loadActiveCardCountInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<number> {
  const result = await executor.query<ActiveCardCountRow>(
    [
      "SELECT COUNT(*)::int AS active_card_count",
      "FROM content.cards",
      "WHERE workspace_id = $1 AND deleted_at IS NULL",
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw createWorkspaceInvariantError(
      "Workspace card count could not be loaded.",
      "WORKSPACE_ACTIVE_CARD_COUNT_UNAVAILABLE",
    );
  }

  return typeof row.active_card_count === "number"
    ? row.active_card_count
    : Number.parseInt(row.active_card_count, 10);
}

export async function loadResettableCardCountInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<number> {
  const result = await executor.query<ResettableCardCountRow>(
    [
      "SELECT COUNT(*)::int AS cards_to_reset_count",
      "FROM content.cards",
      "WHERE",
      getResettableCardPredicateSql(),
    ].join(" "),
    [workspaceId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw createWorkspaceInvariantError(
      "Workspace progress reset count could not be loaded.",
      "WORKSPACE_RESET_PROGRESS_COUNT_UNAVAILABLE",
    );
  }

  return typeof row.cards_to_reset_count === "number"
    ? row.cards_to_reset_count
    : Number.parseInt(row.cards_to_reset_count, 10);
}

export async function loadResettableCardRowsInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
): Promise<ReadonlyArray<ResettableCardIdRow>> {
  const result = await executor.query<ResettableCardIdRow>(
    [
      "SELECT card_id",
      "FROM content.cards",
      "WHERE",
      getResettableCardPredicateSql(),
      "ORDER BY card_id ASC",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId],
  );

  return result.rows;
}

/**
 * Returns the full visible workspace set for internal bootstrap decisions that
 * must reason about the entire collection at once.
 *
 * Keep this helper because `ensureApiKeyWorkspaceSelection()` needs the full
 * set to decide whether to auto-create, auto-select, clear selection, or keep
 * the current selection. Transport-facing API reads should use
 * `listUserWorkspacesPageForSelectedWorkspace()` instead.
 */
export async function listUserWorkspacesForSelectedWorkspace(
  userId: string,
  selectedWorkspaceId: string | null,
): Promise<ReadonlyArray<WorkspaceSummary>> {
  const result = await queryWithUserScope<WorkspaceSummaryRow>(
    { userId },
    [
      "SELECT",
      "workspaces.workspace_id,",
      "workspaces.name,",
      "workspaces.created_at",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1",
      "ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC",
    ].join(" "),
    [userId],
  );

  return result.rows.map((row) => mapWorkspaceSummary(row, selectedWorkspaceId));
}

export async function listUserWorkspacesPageForSelectedWorkspace(
  userId: string,
  selectedWorkspaceId: string | null,
  input: CursorPageInput,
): Promise<WorkspaceSummaryPage> {
  if (input.limit < 1 || input.limit > maximumWorkspacePageSize) {
    throw new HttpError(400, `limit must be an integer between 1 and ${maximumWorkspacePageSize}`);
  }

  const decodedCursor = input.cursor === null ? null : decodeWorkspacePageCursor(input.cursor);
  const cursorClause = decodedCursor === null
    ? ""
    : "AND (workspaces.created_at > $2 OR (workspaces.created_at = $2 AND workspaces.workspace_id > $3))";
  const params = decodedCursor === null
    ? [userId, input.limit + 1]
    : [userId, new Date(decodedCursor.createdAt), decodedCursor.workspaceId, input.limit + 1];
  const limitParamIndex = decodedCursor === null ? 2 : 4;

  const result = await queryWithUserScope<WorkspaceSummaryRow>(
    { userId },
    [
      "SELECT",
      "workspaces.workspace_id,",
      "workspaces.name,",
      "workspaces.created_at",
      "FROM org.workspace_memberships memberships",
      "INNER JOIN org.workspaces workspaces ON workspaces.workspace_id = memberships.workspace_id",
      "WHERE memberships.user_id = $1",
      cursorClause,
      "ORDER BY workspaces.created_at ASC, workspaces.workspace_id ASC",
      `LIMIT $${limitParamIndex}`,
    ].join(" "),
    params,
  );

  const hasNextPage = result.rows.length > input.limit;
  const visibleRows = hasNextPage ? result.rows.slice(0, input.limit) : result.rows;
  const nextRow = hasNextPage ? visibleRows[visibleRows.length - 1] : undefined;

  return {
    workspaces: visibleRows.map((row) => mapWorkspaceSummary(row, selectedWorkspaceId)),
    nextCursor: nextRow === undefined ? null : encodeOpaqueCursor([
      toIsoString(nextRow.created_at),
      nextRow.workspace_id,
    ]),
  };
}
