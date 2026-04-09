import { HttpError } from "../errors";
import { decodeOpaqueCursor } from "../pagination";
import {
  deleteWorkspaceConfirmationText,
  resetWorkspaceProgressConfirmationText,
  type WorkspaceSummary,
} from "./types";

export type TimestampValue = Date | string;

export type WorkspacePageCursor = Readonly<{
  createdAt: string;
  workspaceId: string;
}>;

export type DatabaseErrorDetails = Readonly<{
  sqlState: string | null;
  constraint: string | null;
  table: string | null;
  detail: string | null;
}>;

type WorkspaceSummaryRow = Readonly<{
  workspace_id: string;
  name: string;
  created_at: TimestampValue;
}>;

export function toIsoString(value: TimestampValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

export function mapWorkspaceSummary(
  row: WorkspaceSummaryRow,
  selectedWorkspaceId: string | null,
): WorkspaceSummary {
  return {
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: toIsoString(row.created_at),
    isSelected: selectedWorkspaceId === row.workspace_id,
  };
}

export function assertWorkspaceOwner(role: string): void {
  if (role !== "owner") {
    throw new HttpError(403, "Only workspace owners can manage this workspace", "WORKSPACE_OWNER_REQUIRED");
  }
}

export function assertWorkspaceIsSoleMember(memberCount: number): void {
  if (memberCount !== 1) {
    throw new HttpError(
      409,
      "This workspace cannot be deleted while it still has multiple members.",
      "WORKSPACE_DELETE_SHARED",
    );
  }
}

export function assertWorkspaceIsSoleMemberForReset(memberCount: number): void {
  if (memberCount !== 1) {
    throw new HttpError(
      409,
      "This workspace cannot reset progress while it still has multiple members.",
      "WORKSPACE_RESET_SHARED",
    );
  }
}

export function assertDeleteWorkspaceConfirmationText(confirmationText: string): void {
  if (confirmationText !== deleteWorkspaceConfirmationText) {
    throw new HttpError(
      400,
      `Type "${deleteWorkspaceConfirmationText}" exactly to confirm workspace deletion.`,
      "WORKSPACE_DELETE_CONFIRMATION_INVALID",
    );
  }
}

export function assertResetWorkspaceProgressConfirmationText(confirmationText: string): void {
  if (confirmationText !== resetWorkspaceProgressConfirmationText) {
    throw new HttpError(
      400,
      `Type "${resetWorkspaceProgressConfirmationText}" exactly to confirm workspace progress reset.`,
      "WORKSPACE_RESET_PROGRESS_CONFIRMATION_INVALID",
    );
  }
}

export function createWorkspaceInvariantError(message: string, code: string): HttpError {
  return new HttpError(500, message, code);
}

export function getDatabaseErrorDetails(error: unknown): DatabaseErrorDetails {
  if (typeof error !== "object" || error === null) {
    return {
      sqlState: null,
      constraint: null,
      table: null,
      detail: null,
    };
  }

  const errorRecord = error as Readonly<Record<string, unknown>>;
  return {
    sqlState: typeof errorRecord.code === "string" && errorRecord.code !== "" ? errorRecord.code : null,
    constraint: typeof errorRecord.constraint === "string" && errorRecord.constraint !== "" ? errorRecord.constraint : null,
    table: typeof errorRecord.table === "string" && errorRecord.table !== "" ? errorRecord.table : null,
    detail: typeof errorRecord.detail === "string" && errorRecord.detail !== "" ? errorRecord.detail : null,
  };
}

export function createWorkspaceDeleteFailedError(): HttpError {
  return new HttpError(
    500,
    "Workspace deletion failed on the server before it could be completed. Try again.",
    "WORKSPACE_DELETE_FAILED",
  );
}

export function createWorkspaceDeletePreviewFailedError(): HttpError {
  return new HttpError(
    500,
    "Workspace deletion preview failed on the server before it could be loaded. Try again.",
    "WORKSPACE_DELETE_PREVIEW_FAILED",
  );
}

export function createWorkspaceResetProgressFailedError(): HttpError {
  return new HttpError(
    500,
    "Workspace progress reset failed on the server before it could be completed. Try again.",
    "WORKSPACE_RESET_PROGRESS_FAILED",
  );
}

export function createWorkspaceResetProgressPreviewFailedError(): HttpError {
  return new HttpError(
    500,
    "Workspace progress reset preview failed on the server before it could be loaded. Try again.",
    "WORKSPACE_RESET_PROGRESS_PREVIEW_FAILED",
  );
}

export function createWorkspaceCreateFailedError(): HttpError {
  return new HttpError(
    500,
    "Workspace creation failed on the server before it could be completed. Try again.",
    "WORKSPACE_CREATE_FAILED",
  );
}

export function decodeWorkspacePageCursor(cursor: string): WorkspacePageCursor {
  const decodedCursor = decodeOpaqueCursor(cursor, "cursor");
  if (decodedCursor.values.length !== 2) {
    throw new HttpError(400, "cursor does not match the requested workspaces order");
  }

  const createdAt = decodedCursor.values[0];
  const workspaceId = decodedCursor.values[1];
  if (typeof createdAt !== "string" || typeof workspaceId !== "string") {
    throw new HttpError(400, "cursor does not match the requested workspaces order");
  }

  return {
    createdAt,
    workspaceId,
  };
}
