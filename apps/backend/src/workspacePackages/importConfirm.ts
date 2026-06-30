import type { Buffer } from "node:buffer";
import type { Card } from "../cards";
import type { BackendObservationScope } from "../observability/sentry";
import {
  ingestWorkspacePackageImportMediaAssets,
  type WorkspacePackageImportedMediaAsset,
  type WorkspacePackageImportMediaAssetIngestionInput,
  type WorkspacePackageImportMediaAssetIngestionResult,
} from "./importMediaAssets";
import {
  loadWorkspacePackageImportReferencedMedia,
  type WorkspacePackageImportReferencedMediaInput,
  type WorkspacePackageImportReferencedMediaLoadResult,
} from "./importMedia";
import {
  persistWorkspacePackageImportCards,
  type WorkspacePackageImportCardPersistenceInput,
  type WorkspacePackageImportCardPersistenceResult,
} from "./importCards";
import {
  planWorkspacePackageImport,
  type WorkspacePackageImportPlan,
  type WorkspacePackageImportPlanInput,
  type WorkspacePackageImportPlanOptions,
} from "./importPlan";

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

export async function confirmWorkspacePackageImportWithDependencies(
  input: WorkspacePackageImportConfirmInput,
  dependencies: WorkspacePackageImportConfirmDependencies,
): Promise<WorkspacePackageImportConfirmResult> {
  const mediaLoadResult = await dependencies.loadReferencedMediaFn({
    packageBytes: input.packageBytes,
  });
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
    planImportFn: planWorkspacePackageImport,
    persistCardsFn: persistWorkspacePackageImportCards,
  });
}
