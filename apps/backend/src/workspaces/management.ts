import { randomUUID } from "node:crypto";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithUserScope,
  type DatabaseExecutor,
} from "../db";
import { HttpError } from "../errors";
import { CARD_COLUMNS, mapCard, recordCardSyncChange } from "../cards/shared";
import type { CardRow } from "../cards/types";
import {
  addBackendBreadcrumb,
  captureBackendException,
  normalizeCaughtError,
  type BackendObservationScope,
  type WorkspaceTransactionDetails,
} from "../observability/sentry";
import { markBackendExceptionWrapperAsReported } from "../observability/reporting";
import { ensureSystemWorkspaceReplicaInExecutor } from "../syncIdentity";
import { lockWorkspaceAccessLifecycleInExecutor } from "../workspaceAccessLocks";
import { createWorkspaceInExecutorWithObservationScope } from "./create";
import {
  listUserWorkspaceIdsInExecutor,
  loadActiveCardCountInExecutor,
  loadResettableCardCountInExecutor,
  loadResettableCardRowsInExecutor,
  loadSelectedWorkspaceIdInExecutor,
  loadWorkspaceManagementRowInExecutor,
  loadWorkspaceSummaryInExecutor,
} from "./queries";
import { ensureUserSelectedWorkspaceInExecutor } from "./selection";
import {
  assertDeleteWorkspaceConfirmationText,
  assertResetWorkspaceProgressConfirmationText,
  assertWorkspaceIsSoleMember,
  assertWorkspaceIsSoleMemberForReset,
  assertWorkspaceOwner,
  createWorkspaceDeleteFailedError,
  createWorkspaceDeletePreviewFailedError,
  createWorkspaceResetProgressFailedError,
  createWorkspaceResetProgressPreviewFailedError,
  createWorkspaceTransactionScope,
  getDatabaseErrorDetails,
} from "./shared";
import { persistSelectedWorkspaceForUserInExecutor } from "./state";
import {
  AUTO_CREATED_WORKSPACE_NAME,
  deleteWorkspaceConfirmationText,
  resetWorkspaceProgressConfirmationText,
  type DeleteWorkspaceResult,
  type ResetWorkspaceProgressResult,
  type WorkspaceDeletePreview,
  type WorkspaceResetProgressPreview,
  type WorkspaceSummary,
} from "./types";

type WorkspaceDeleteFailureStage =
  | "load_management_row"
  | "prepare_selection"
  | "count_active_cards"
  | "delete_workspace"
  | "ensure_selected_workspace"
  | "load_replacement_workspace";

type WorkspaceResetProgressFailureStage =
  | "load_management_row"
  | "count_resettable_cards"
  | "reset_workspace_cards";

type WorkspaceTransactionErrorAction =
  | "workspace_delete_preview_transaction_error"
  | "workspace_reset_progress_preview_transaction_error"
  | "workspace_reset_progress_transaction_error"
  | "workspace_delete_transaction_error";

function createWorkspaceTransactionDetails(
  userId: string,
  workspaceId: string,
  stage: string | null,
  code: string | null,
  cardsResetCount: number | null,
  memberCount: number | null,
  selectedWorkspaceIdBeforeDelete: string | null,
  selectedWorkspaceIdAfterPreparation: string | null,
  deletedCardsCount: number | null,
  databaseErrorDetails: Readonly<{
    sqlState: string | null;
    constraint: string | null;
    table: string | null;
    detail: string | null;
  }>,
): WorkspaceTransactionDetails {
  return {
    userId,
    workspaceId,
    stage,
    code,
    cardsResetCount,
    memberCount,
    selectedWorkspaceIdBeforeDelete,
    selectedWorkspaceIdAfterPreparation,
    deletedCardsCount,
    ...databaseErrorDetails,
  };
}

function reportWorkspaceTransactionError(
  action: WorkspaceTransactionErrorAction,
  details: WorkspaceTransactionDetails,
  observationScope: BackendObservationScope | null,
): void {
  const scope = createWorkspaceTransactionScope(details.userId, details.workspaceId, observationScope);
  switch (action) {
    case "workspace_delete_preview_transaction_error":
      addBackendBreadcrumb({ action: "workspace_delete_preview_transaction_error", scope, details });
      return;
    case "workspace_reset_progress_preview_transaction_error":
      addBackendBreadcrumb({ action: "workspace_reset_progress_preview_transaction_error", scope, details });
      return;
    case "workspace_reset_progress_transaction_error":
      addBackendBreadcrumb({ action: "workspace_reset_progress_transaction_error", scope, details });
      return;
    case "workspace_delete_transaction_error":
      addBackendBreadcrumb({ action: "workspace_delete_transaction_error", scope, details });
      return;
  }
}

function captureWorkspaceTransactionError(
  action: WorkspaceTransactionErrorAction,
  error: unknown,
  details: WorkspaceTransactionDetails,
  observationScope: BackendObservationScope | null,
): void {
  const scope = createWorkspaceTransactionScope(details.userId, details.workspaceId, observationScope);
  switch (action) {
    case "workspace_delete_preview_transaction_error":
      captureBackendException({
        action: "workspace_delete_preview_transaction_error",
        error: normalizeCaughtError(error),
        scope,
        details,
      });
      return;
    case "workspace_reset_progress_preview_transaction_error":
      captureBackendException({
        action: "workspace_reset_progress_preview_transaction_error",
        error: normalizeCaughtError(error),
        scope,
        details,
      });
      return;
    case "workspace_reset_progress_transaction_error":
      captureBackendException({
        action: "workspace_reset_progress_transaction_error",
        error: normalizeCaughtError(error),
        scope,
        details,
      });
      return;
    case "workspace_delete_transaction_error":
      captureBackendException({
        action: "workspace_delete_transaction_error",
        error: normalizeCaughtError(error),
        scope,
        details,
      });
      return;
  }
}

type DeletedWorkspaceRow = Readonly<{
  workspace_id: string;
}>;

async function resetCardProgressInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  replicaId: string,
  cardId: string,
): Promise<CardRow> {
  const clientUpdatedAt = new Date().toISOString();
  const operationId = randomUUID();

  const result = await executor.query<CardRow>(
    [
      "UPDATE content.cards",
      "SET due_at = NULL, reps = 0, lapses = 0, fsrs_card_state = 'new', fsrs_step_index = NULL,",
      "fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_last_reviewed_at = NULL, fsrs_scheduled_days = NULL,",
      "client_updated_at = $1, last_modified_by_replica_id = $2, last_operation_id = $3, updated_at = now()",
      "WHERE workspace_id = $4 AND card_id = $5 AND deleted_at IS NULL",
      "RETURNING",
      CARD_COLUMNS,
    ].join(" "),
    [clientUpdatedAt, replicaId, operationId, workspaceId, cardId],
  );

  const updatedCardRow = result.rows[0];
  if (updatedCardRow === undefined) {
    throw new HttpError(404, "Card not found");
  }

  const updatedCard = mapCard(updatedCardRow);
  await recordCardSyncChange(executor, workspaceId, updatedCard);
  return updatedCardRow;
}

async function prepareSelectedWorkspaceForDeletionInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  deletedWorkspaceId: string,
  observationScope: BackendObservationScope | null,
): Promise<Readonly<{
  selectedWorkspaceIdBeforeDelete: string | null;
  selectedWorkspaceIdAfterPreparation: string | null;
}>> {
  const selectedWorkspaceIdBeforeDelete = await loadSelectedWorkspaceIdInExecutor(executor, userId);
  if (selectedWorkspaceIdBeforeDelete !== deletedWorkspaceId) {
    return {
      selectedWorkspaceIdBeforeDelete,
      selectedWorkspaceIdAfterPreparation: selectedWorkspaceIdBeforeDelete,
    };
  }

  const accessibleWorkspaceIds = await listUserWorkspaceIdsInExecutor(executor, userId);
  const replacementWorkspaceId = accessibleWorkspaceIds.find((workspaceId) => workspaceId !== deletedWorkspaceId)
    ?? await createWorkspaceInExecutorWithObservationScope(executor, userId, AUTO_CREATED_WORKSPACE_NAME, observationScope);
  await persistSelectedWorkspaceForUserInExecutor(executor, userId, replacementWorkspaceId);

  return {
    selectedWorkspaceIdBeforeDelete,
    selectedWorkspaceIdAfterPreparation: replacementWorkspaceId,
  };
}

export async function renameWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  name: string,
  selectedWorkspaceId: string | null,
): Promise<WorkspaceSummary> {
  const managedWorkspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
  assertWorkspaceOwner(managedWorkspace.role);
  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
  await executor.query(
    "UPDATE org.workspaces SET name = $1 WHERE workspace_id = $2",
    [name, workspaceId],
  );

  return loadWorkspaceSummaryInExecutor(executor, userId, workspaceId, selectedWorkspaceId);
}

export async function renameWorkspaceForUser(
  userId: string,
  workspaceId: string,
  name: string,
  selectedWorkspaceId: string | null,
): Promise<WorkspaceSummary> {
  return transactionWithUserScope({ userId }, async (executor) => renameWorkspaceInExecutor(
    executor,
    userId,
    workspaceId,
    name,
    selectedWorkspaceId,
  ));
}

export async function loadWorkspaceDeletePreviewInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceDeletePreview> {
  return loadWorkspaceDeletePreviewInExecutorWithObservationScope(executor, userId, workspaceId, null);
}

async function loadWorkspaceDeletePreviewInExecutorWithObservationScope(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  observationScope: BackendObservationScope | null,
): Promise<WorkspaceDeletePreview> {
  try {
    const managedWorkspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
    assertWorkspaceOwner(managedWorkspace.role);
    assertWorkspaceIsSoleMember(managedWorkspace.member_count);
    const activeCardCount = await loadActiveCardCountInExecutor(executor, workspaceId);
    const workspaceIds = await listUserWorkspaceIdsInExecutor(executor, userId);

    return {
      workspaceId,
      workspaceName: managedWorkspace.name,
      activeCardCount,
      confirmationText: deleteWorkspaceConfirmationText,
      isLastAccessibleWorkspace: workspaceIds.length === 1,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    captureWorkspaceTransactionError(
      "workspace_delete_preview_transaction_error",
      error,
      createWorkspaceTransactionDetails(
        userId,
        workspaceId,
        null,
        "WORKSPACE_DELETE_PREVIEW_FAILED",
        null,
        null,
        null,
        null,
        null,
        getDatabaseErrorDetails(error),
      ),
      observationScope,
    );
    throw markBackendExceptionWrapperAsReported(createWorkspaceDeletePreviewFailedError());
  }
}

export async function loadWorkspaceDeletePreviewForUser(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceDeletePreview> {
  return loadWorkspaceDeletePreviewForUserWithObservationScope(userId, workspaceId, null);
}

export async function loadWorkspaceDeletePreviewForUserWithObservationScope(
  userId: string,
  workspaceId: string,
  observationScope: BackendObservationScope | null,
): Promise<WorkspaceDeletePreview> {
  return transactionWithUserScope({ userId }, async (executor) => loadWorkspaceDeletePreviewInExecutorWithObservationScope(
    executor,
    userId,
    workspaceId,
    observationScope,
  ));
}

export async function loadWorkspaceResetProgressPreviewInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceResetProgressPreview> {
  return loadWorkspaceResetProgressPreviewInExecutorWithObservationScope(executor, userId, workspaceId, null);
}

async function loadWorkspaceResetProgressPreviewInExecutorWithObservationScope(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  observationScope: BackendObservationScope | null,
): Promise<WorkspaceResetProgressPreview> {
  try {
    const managedWorkspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
    assertWorkspaceOwner(managedWorkspace.role);
    assertWorkspaceIsSoleMemberForReset(managedWorkspace.member_count);
    await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
    const cardsToResetCount = await loadResettableCardCountInExecutor(executor, workspaceId);

    return {
      workspaceId,
      workspaceName: managedWorkspace.name,
      cardsToResetCount,
      confirmationText: resetWorkspaceProgressConfirmationText,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    captureWorkspaceTransactionError(
      "workspace_reset_progress_preview_transaction_error",
      error,
      createWorkspaceTransactionDetails(
        userId,
        workspaceId,
        null,
        "WORKSPACE_RESET_PROGRESS_PREVIEW_FAILED",
        null,
        null,
        null,
        null,
        null,
        getDatabaseErrorDetails(error),
      ),
      observationScope,
    );
    throw markBackendExceptionWrapperAsReported(createWorkspaceResetProgressPreviewFailedError());
  }
}

export async function loadWorkspaceResetProgressPreviewForUser(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceResetProgressPreview> {
  return loadWorkspaceResetProgressPreviewForUserWithObservationScope(userId, workspaceId, null);
}

export async function loadWorkspaceResetProgressPreviewForUserWithObservationScope(
  userId: string,
  workspaceId: string,
  observationScope: BackendObservationScope | null,
): Promise<WorkspaceResetProgressPreview> {
  return transactionWithUserScope({ userId }, async (executor) => loadWorkspaceResetProgressPreviewInExecutorWithObservationScope(
    executor,
    userId,
    workspaceId,
    observationScope,
  ));
}

async function resetWorkspaceProgressInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  confirmationText: string,
  observationScope: BackendObservationScope | null,
): Promise<ResetWorkspaceProgressResult> {
  assertResetWorkspaceProgressConfirmationText(confirmationText);
  let stage: WorkspaceResetProgressFailureStage = "load_management_row";
  const managedWorkspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
  assertWorkspaceOwner(managedWorkspace.role);
  assertWorkspaceIsSoleMemberForReset(managedWorkspace.member_count);
  await applyWorkspaceDatabaseScopeInExecutor(executor, { userId, workspaceId });
  let cardsResetCount = 0;

  try {
    stage = "count_resettable_cards";
    const resettableCards = await loadResettableCardRowsInExecutor(executor, workspaceId);
    cardsResetCount = resettableCards.length;

    if (resettableCards.length === 0) {
      return {
        ok: true,
        workspaceId,
        cardsResetCount: 0,
      };
    }

    stage = "reset_workspace_cards";
    const resetReplicaId = await ensureSystemWorkspaceReplicaInExecutor(executor, {
      workspaceId,
      userId,
      actorKind: "workspace_reset",
      actorKey: "reset-progress",
      platform: "system",
      appVersion: null,
    });

    for (const resettableCard of resettableCards) {
      await resetCardProgressInExecutor(
        executor,
        workspaceId,
        resetReplicaId,
        resettableCard.card_id,
      );
    }

    return {
      ok: true,
      workspaceId,
      cardsResetCount,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      reportWorkspaceTransactionError(
        "workspace_reset_progress_transaction_error",
        createWorkspaceTransactionDetails(
          userId,
          workspaceId,
          stage,
          error.code,
          cardsResetCount,
          null,
          null,
          null,
          null,
          {
            sqlState: null,
            constraint: null,
            table: null,
            detail: null,
          },
        ),
        observationScope,
      );
      throw error;
    }

    captureWorkspaceTransactionError(
      "workspace_reset_progress_transaction_error",
      error,
      createWorkspaceTransactionDetails(
        userId,
        workspaceId,
        stage,
        "WORKSPACE_RESET_PROGRESS_FAILED",
        cardsResetCount,
        null,
        null,
        null,
        null,
        getDatabaseErrorDetails(error),
      ),
      observationScope,
    );
    throw markBackendExceptionWrapperAsReported(createWorkspaceResetProgressFailedError());
  }
}

export async function resetWorkspaceProgressForUser(
  userId: string,
  workspaceId: string,
  confirmationText: string,
): Promise<ResetWorkspaceProgressResult> {
  return resetWorkspaceProgressForUserWithObservationScope(userId, workspaceId, confirmationText, null);
}

export async function resetWorkspaceProgressForUserWithObservationScope(
  userId: string,
  workspaceId: string,
  confirmationText: string,
  observationScope: BackendObservationScope | null,
): Promise<ResetWorkspaceProgressResult> {
  return transactionWithUserScope({ userId }, async (executor) => resetWorkspaceProgressInExecutor(
    executor,
    userId,
    workspaceId,
    confirmationText,
    observationScope,
  ));
}

export async function deleteWorkspaceInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  confirmationText: string,
): Promise<DeleteWorkspaceResult> {
  return deleteWorkspaceInExecutorWithObservationScope(executor, userId, workspaceId, confirmationText, null);
}

async function deleteWorkspaceInExecutorWithObservationScope(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  confirmationText: string,
  observationScope: BackendObservationScope | null,
): Promise<DeleteWorkspaceResult> {
  assertDeleteWorkspaceConfirmationText(confirmationText);
  await lockWorkspaceAccessLifecycleInExecutor(executor, userId, workspaceId);
  let stage: WorkspaceDeleteFailureStage = "load_management_row";
  const managedWorkspace = await loadWorkspaceManagementRowInExecutor(executor, userId, workspaceId);
  assertWorkspaceOwner(managedWorkspace.role);
  assertWorkspaceIsSoleMember(managedWorkspace.member_count);
  let selectedWorkspaceIdBeforeDelete: string | null = null;
  let selectedWorkspaceIdAfterPreparation: string | null = null;
  let deletedCardsCount: number | null = null;

  try {
    stage = "prepare_selection";
    const selectionPreparation = await prepareSelectedWorkspaceForDeletionInExecutor(
      executor,
      userId,
      workspaceId,
      observationScope,
    );
    selectedWorkspaceIdBeforeDelete = selectionPreparation.selectedWorkspaceIdBeforeDelete;
    selectedWorkspaceIdAfterPreparation = selectionPreparation.selectedWorkspaceIdAfterPreparation;

    stage = "count_active_cards";
    deletedCardsCount = await loadActiveCardCountInExecutor(executor, workspaceId);
    stage = "delete_workspace";
    const deleteResult = await executor.query<DeletedWorkspaceRow>(
      "DELETE FROM org.workspaces WHERE workspace_id = $1 RETURNING workspace_id",
      [workspaceId],
    );
    if (deleteResult.rows.length === 0) {
      throw new HttpError(404, "Workspace not found", "WORKSPACE_NOT_FOUND");
    }
    stage = "ensure_selected_workspace";
    const selectedWorkspaceId = await ensureUserSelectedWorkspaceInExecutor(
      executor,
      userId,
      selectedWorkspaceIdAfterPreparation,
    );
    stage = "load_replacement_workspace";
    const workspace = await loadWorkspaceSummaryInExecutor(executor, userId, selectedWorkspaceId, selectedWorkspaceId);

    return {
      ok: true,
      deletedWorkspaceId: workspaceId,
      deletedCardsCount,
      workspace,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      reportWorkspaceTransactionError(
        "workspace_delete_transaction_error",
        createWorkspaceTransactionDetails(
          userId,
          workspaceId,
          stage,
          error.code,
          null,
          managedWorkspace.member_count,
          selectedWorkspaceIdBeforeDelete,
          selectedWorkspaceIdAfterPreparation,
          deletedCardsCount,
          {
            sqlState: null,
            constraint: null,
            table: null,
            detail: null,
          },
        ),
        observationScope,
      );
      throw error;
    }

    captureWorkspaceTransactionError(
      "workspace_delete_transaction_error",
      error,
      createWorkspaceTransactionDetails(
        userId,
        workspaceId,
        stage,
        "WORKSPACE_DELETE_FAILED",
        null,
        managedWorkspace.member_count,
        selectedWorkspaceIdBeforeDelete,
        selectedWorkspaceIdAfterPreparation,
        deletedCardsCount,
        getDatabaseErrorDetails(error),
      ),
      observationScope,
    );
    throw markBackendExceptionWrapperAsReported(createWorkspaceDeleteFailedError());
  }
}

export async function deleteWorkspaceForUser(
  userId: string,
  workspaceId: string,
  confirmationText: string,
): Promise<DeleteWorkspaceResult> {
  return deleteWorkspaceForUserWithObservationScope(userId, workspaceId, confirmationText, null);
}

export async function deleteWorkspaceForUserWithObservationScope(
  userId: string,
  workspaceId: string,
  confirmationText: string,
  observationScope: BackendObservationScope | null,
): Promise<DeleteWorkspaceResult> {
  return transactionWithUserScope({ userId }, async (executor) => deleteWorkspaceInExecutorWithObservationScope(
    executor,
    userId,
    workspaceId,
    confirmationText,
    observationScope,
  ));
}
