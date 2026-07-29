import type { Buffer } from "node:buffer";
import type { Card } from "../../../cards";
import {
  transactionWithWorkspaceScopeReadOnly,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../../database";
import { assertReplicaBelongsToWorkspaceInExecutor } from "../../../mediaAssets/workspaceReplicas";
import type { BackendObservationScope } from "../../../observability/sentry";
import { HttpError } from "../../../shared/errors";
import {
  ingestWorkspacePackageImportMediaAssets,
  type WorkspacePackageImportedMediaAsset,
  type WorkspacePackageImportMediaAssetIngestionInput,
  type WorkspacePackageImportMediaAssetIngestionResult,
} from "../media/importMediaAssets";
import {
  loadWorkspacePackageImportReferencedMedia,
  type WorkspacePackageImportReferencedMediaInput,
  type WorkspacePackageImportReferencedMediaLoadResult,
} from "../media/importMedia";
import {
  persistWorkspacePackageImportCards,
  type WorkspacePackageImportCardPersistenceInput,
  type WorkspacePackageImportCardPersistenceResult,
} from "./importCards";
import {
  planWorkspacePackageImport,
  validateWorkspacePackageImportPlanPreflight,
  type WorkspacePackageImportPlan,
  type WorkspacePackageImportPlanInput,
  type WorkspacePackageImportPlanOptions,
  type WorkspacePackageImportPlanPreflightInput,
} from "../planning/importPlan";
import { assertValidWorkspacePackageImportOperationIdPrefix } from "../operationIds";

export type WorkspacePackageImportConfirmInput = Readonly<{
  userId: string;
  workspaceId: string;
  packageBytes: Buffer | Uint8Array;
  options: WorkspacePackageImportPlanOptions;
  createdAt: string;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  operationIdPrefix: string;
  observationScope: BackendObservationScope;
}>;

export type WorkspacePackageImportConfirmSummary = Readonly<{
  cardCount: number;
  cardBatchCount: number;
  referencedMediaCount: number;
  importedMediaAssetCount: number;
  appliedMediaAssetCount: number;
  keptTagCount: number;
  removedTagCount: number;
  importTag: string | null;
}>;

export type WorkspacePackageImportConfirmResult = Readonly<{
  cards: ReadonlyArray<Card>;
  importedMediaAssets: ReadonlyArray<WorkspacePackageImportedMediaAsset>;
  summary: WorkspacePackageImportConfirmSummary;
}>;

export type WorkspacePackageImportConfirmDependencies = Readonly<{
  loadReferencedMediaFn: (
    input: WorkspacePackageImportReferencedMediaInput,
  ) => Promise<WorkspacePackageImportReferencedMediaLoadResult>;
  ingestMediaAssetsFn: (
    input: WorkspacePackageImportMediaAssetIngestionInput,
  ) => Promise<WorkspacePackageImportMediaAssetIngestionResult>;
  assertReplicaBelongsToWorkspaceFn: (
    userId: string,
    workspaceId: string,
    replicaId: string,
  ) => Promise<void>;
  validatePlanPreflightFn: (input: WorkspacePackageImportPlanPreflightInput) => void;
  planImportFn: (input: WorkspacePackageImportPlanInput) => WorkspacePackageImportPlan;
  persistCardsFn: (
    input: WorkspacePackageImportCardPersistenceInput,
  ) => Promise<WorkspacePackageImportCardPersistenceResult>;
}>;

function createMediaAssetIngestionInput(
  input: WorkspacePackageImportConfirmInput,
  mediaLoadResult: WorkspacePackageImportReferencedMediaLoadResult,
): WorkspacePackageImportMediaAssetIngestionInput {
  return {
    userId: input.userId,
    workspaceId: input.workspaceId,
    referencedMediaFiles: mediaLoadResult.referencedMediaFiles,
    createdAt: input.createdAt,
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    operationIdPrefix: input.operationIdPrefix,
    observationScope: input.observationScope,
  };
}

function createImportPlanInput(
  input: WorkspacePackageImportConfirmInput,
  mediaLoadResult: WorkspacePackageImportReferencedMediaLoadResult,
  mediaAssetIngestionResult: WorkspacePackageImportMediaAssetIngestionResult,
): WorkspacePackageImportPlanInput {
  return {
    cardsJson: mediaLoadResult.cardsJson,
    options: input.options,
    mediaAssetIdsByPortablePath: mediaAssetIngestionResult.mediaAssetIdsByPortablePath,
  };
}

function createImportPlanPreflightInput(
  input: WorkspacePackageImportConfirmInput,
  mediaLoadResult: WorkspacePackageImportReferencedMediaLoadResult,
): WorkspacePackageImportPlanPreflightInput {
  return {
    cardsJson: mediaLoadResult.cardsJson,
    options: input.options,
  };
}

function createCardPersistenceInput(
  input: WorkspacePackageImportConfirmInput,
  plan: WorkspacePackageImportPlan,
): WorkspacePackageImportCardPersistenceInput {
  return {
    userId: input.userId,
    workspaceId: input.workspaceId,
    plannedCards: plan.cards,
    clientUpdatedAt: input.clientUpdatedAt,
    lastModifiedByReplicaId: input.lastModifiedByReplicaId,
    operationIdPrefix: input.operationIdPrefix,
  };
}

function countAppliedImportedMediaAssets(
  mediaAssets: ReadonlyArray<WorkspacePackageImportedMediaAsset>,
): number {
  return mediaAssets.filter((mediaAsset) => mediaAsset.applied).length;
}

function createConfirmResult(
  plan: WorkspacePackageImportPlan,
  mediaAssetIngestionResult: WorkspacePackageImportMediaAssetIngestionResult,
  cardPersistenceResult: WorkspacePackageImportCardPersistenceResult,
): WorkspacePackageImportConfirmResult {
  return {
    cards: cardPersistenceResult.cards,
    importedMediaAssets: mediaAssetIngestionResult.mediaAssets,
    summary: {
      cardCount: cardPersistenceResult.summary.cardCount,
      cardBatchCount: cardPersistenceResult.summary.batchCount,
      referencedMediaCount: plan.summary.referencedMediaCount,
      importedMediaAssetCount: mediaAssetIngestionResult.mediaAssets.length,
      appliedMediaAssetCount: countAppliedImportedMediaAssets(mediaAssetIngestionResult.mediaAssets),
      keptTagCount: plan.summary.keptTagCount,
      removedTagCount: plan.summary.removedTagCount,
      importTag: plan.summary.importTag,
    },
  };
}

function toWorkspacePackageImportInputError(error: unknown): Error {
  if (error instanceof TypeError && error.message.startsWith("Invalid workspace package import plan input:")) {
    return new HttpError(400, error.message, "WORKSPACE_PACKAGE_IMPORT_INPUT_INVALID");
  }

  return error instanceof Error ? error : new Error(String(error));
}

function toWorkspacePackageImportReplicaError(error: unknown): Error {
  if (error instanceof HttpError && error.code === "MEDIA_ASSET_REPLICA_INVALID") {
    return new HttpError(
      400,
      "lastModifiedByReplicaId must reference a workspace replica for this workspace.",
      "WORKSPACE_PACKAGE_IMPORT_REPLICA_INVALID",
      error.details ?? undefined,
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

function validatePlanPreflight(
  input: WorkspacePackageImportPlanPreflightInput,
  validatePlanPreflightFn: (preflightInput: WorkspacePackageImportPlanPreflightInput) => void,
): void {
  try {
    validatePlanPreflightFn(input);
  } catch (error) {
    throw toWorkspacePackageImportInputError(error);
  }
}

async function assertImportReplicaBelongsToWorkspaceInTransaction(
  executor: DatabaseExecutor,
  workspaceId: string,
  replicaId: string,
): Promise<void> {
  await assertReplicaBelongsToWorkspaceInExecutor(executor, workspaceId, replicaId);
}

async function assertImportReplicaBelongsToWorkspace(
  userId: string,
  workspaceId: string,
  replicaId: string,
): Promise<void> {
  try {
    await transactionWithWorkspaceScopeReadOnly(
      { userId, workspaceId } satisfies WorkspaceDatabaseScope,
      async (executor) => assertImportReplicaBelongsToWorkspaceInTransaction(executor, workspaceId, replicaId),
    );
  } catch (error) {
    throw toWorkspacePackageImportReplicaError(error);
  }
}

export async function confirmWorkspacePackageImportWithDependencies(
  input: WorkspacePackageImportConfirmInput,
  dependencies: WorkspacePackageImportConfirmDependencies,
): Promise<WorkspacePackageImportConfirmResult> {
  assertValidWorkspacePackageImportOperationIdPrefix(input.operationIdPrefix);
  await dependencies.assertReplicaBelongsToWorkspaceFn(
    input.userId,
    input.workspaceId,
    input.lastModifiedByReplicaId,
  );
  const mediaLoadResult = await dependencies.loadReferencedMediaFn({
    packageBytes: input.packageBytes,
  });
  validatePlanPreflight(
    createImportPlanPreflightInput(input, mediaLoadResult),
    dependencies.validatePlanPreflightFn,
  );
  const mediaAssetIngestionResult = await dependencies.ingestMediaAssetsFn(
    createMediaAssetIngestionInput(input, mediaLoadResult),
  );
  const plan = dependencies.planImportFn(createImportPlanInput(input, mediaLoadResult, mediaAssetIngestionResult));
  const cardPersistenceResult = await dependencies.persistCardsFn(createCardPersistenceInput(input, plan));

  return createConfirmResult(plan, mediaAssetIngestionResult, cardPersistenceResult);
}

export async function confirmWorkspacePackageImport(
  input: WorkspacePackageImportConfirmInput,
): Promise<WorkspacePackageImportConfirmResult> {
  return confirmWorkspacePackageImportWithDependencies(input, {
    loadReferencedMediaFn: loadWorkspacePackageImportReferencedMedia,
    ingestMediaAssetsFn: ingestWorkspacePackageImportMediaAssets,
    assertReplicaBelongsToWorkspaceFn: assertImportReplicaBelongsToWorkspace,
    validatePlanPreflightFn: validateWorkspacePackageImportPlanPreflight,
    planImportFn: planWorkspacePackageImport,
    persistCardsFn: persistWorkspacePackageImportCards,
  });
}
