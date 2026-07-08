import {
  createCardInExecutor,
  type BulkCreateCardItem,
  type Card,
  type CardMutationMetadata,
  type CreateCardInput,
} from "../../../cards";
import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../../database";
import { HttpError } from "../../../shared/errors";
import type { WorkspacePackageImportPlannedCard } from "../planning/importPlan";

const workspacePackageImportCardPersistenceBatchSize = 100;

export type WorkspacePackageImportCardPersistenceInput = Readonly<{
  userId: string;
  workspaceId: string;
  plannedCards: ReadonlyArray<WorkspacePackageImportPlannedCard>;
  clientUpdatedAt: string;
  lastModifiedByReplicaId: string;
  operationIdPrefix: string;
}>;

export type WorkspacePackageImportCardPersistenceSummary = Readonly<{
  cardCount: number;
  batchCount: number;
}>;

export type WorkspacePackageImportCardPersistenceResult = Readonly<{
  cards: ReadonlyArray<Card>;
  summary: WorkspacePackageImportCardPersistenceSummary;
}>;

export type WorkspacePackageImportCardPersistenceCreateCardInExecutorFn = (
  executor: DatabaseExecutor,
  workspaceId: string,
  input: CreateCardInput,
  metadata: CardMutationMetadata,
) => Promise<Card>;

export type WorkspacePackageImportCardPersistenceTransactionFn = (
  scope: WorkspaceDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<WorkspacePackageImportCardPersistenceResult>,
) => Promise<WorkspacePackageImportCardPersistenceResult>;

export type WorkspacePackageImportCardPersistenceDependencies = Readonly<{
  createCardInExecutorFn: WorkspacePackageImportCardPersistenceCreateCardInExecutorFn;
  transactionWithWorkspaceScopeFn: WorkspacePackageImportCardPersistenceTransactionFn;
}>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createCardPersistenceError(
  error: unknown,
  batchIndex: number,
  firstCardIndex: number,
  lastCardIndex: number,
): Error {
  const message = [
    "Workspace package import card persistence failed",
    `batchIndex=${batchIndex}`,
    `cardRange=${firstCardIndex}-${lastCardIndex}.`,
    `reason=${getErrorMessage(error)}`,
  ].join(" ");

  if (error instanceof HttpError) {
    return new HttpError(
      error.statusCode,
      message,
      error.code ?? undefined,
      error.details ?? undefined,
    );
  }

  return new Error(message);
}

function buildImportCardLastOperationId(operationIdPrefix: string, cardIndex: number): string {
  return `${operationIdPrefix}:card:${cardIndex}`;
}

function buildBulkCreateCardItem(
  input: WorkspacePackageImportCardPersistenceInput,
  plannedCard: WorkspacePackageImportPlannedCard,
  cardIndex: number,
): BulkCreateCardItem {
  return {
    input: {
      frontText: plannedCard.frontText,
      backText: plannedCard.backText,
      tags: plannedCard.tags,
      cardType: plannedCard.cardType,
      metadata: plannedCard.metadata,
    },
    metadata: {
      clientUpdatedAt: input.clientUpdatedAt,
      lastModifiedByReplicaId: input.lastModifiedByReplicaId,
      lastOperationId: buildImportCardLastOperationId(input.operationIdPrefix, cardIndex),
    },
  };
}

function splitBulkCreateCardItems(
  items: ReadonlyArray<BulkCreateCardItem>,
  batchSize: number,
): ReadonlyArray<ReadonlyArray<BulkCreateCardItem>> {
  const batches: Array<ReadonlyArray<BulkCreateCardItem>> = [];
  for (let startIndex = 0; startIndex < items.length; startIndex += batchSize) {
    batches.push(items.slice(startIndex, startIndex + batchSize));
  }

  return batches;
}

async function persistBulkCreateCardBatchInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  batch: ReadonlyArray<BulkCreateCardItem>,
  dependencies: WorkspacePackageImportCardPersistenceDependencies,
): Promise<ReadonlyArray<Card>> {
  const createdCards: Array<Card> = [];
  for (const item of batch) {
    createdCards.push(await dependencies.createCardInExecutorFn(
      executor,
      workspaceId,
      item.input,
      item.metadata,
    ));
  }

  return createdCards;
}

export async function persistWorkspacePackageImportCardsWithDependencies(
  input: WorkspacePackageImportCardPersistenceInput,
  dependencies: WorkspacePackageImportCardPersistenceDependencies,
): Promise<WorkspacePackageImportCardPersistenceResult> {
  const items = input.plannedCards.map((plannedCard, cardIndex) => buildBulkCreateCardItem(
    input,
    plannedCard,
    cardIndex,
  ));
  const batches = splitBulkCreateCardItems(items, workspacePackageImportCardPersistenceBatchSize);
  if (batches.length === 0) {
    return {
      cards: [],
      summary: {
        cardCount: 0,
        batchCount: 0,
      },
    };
  }

  return dependencies.transactionWithWorkspaceScopeFn(
    {
      userId: input.userId,
      workspaceId: input.workspaceId,
    },
    async (executor): Promise<WorkspacePackageImportCardPersistenceResult> => {
      const cards: Array<Card> = [];

      for (const [batchIndex, batch] of batches.entries()) {
        const firstCardIndex = batchIndex * workspacePackageImportCardPersistenceBatchSize;
        const lastCardIndex = firstCardIndex + batch.length - 1;
        try {
          const createdCards = await persistBulkCreateCardBatchInExecutor(
            executor,
            input.workspaceId,
            batch,
            dependencies,
          );
          cards.push(...createdCards);
        } catch (error) {
          throw createCardPersistenceError(error, batchIndex, firstCardIndex, lastCardIndex);
        }
      }

      return {
        cards,
        summary: {
          cardCount: cards.length,
          batchCount: batches.length,
        },
      };
    }
  );
}

export async function persistWorkspacePackageImportCards(
  input: WorkspacePackageImportCardPersistenceInput,
): Promise<WorkspacePackageImportCardPersistenceResult> {
  return persistWorkspacePackageImportCardsWithDependencies(input, {
    createCardInExecutorFn: createCardInExecutor,
    transactionWithWorkspaceScopeFn: async (
      scope: WorkspaceDatabaseScope,
      callback: (executor: DatabaseExecutor) => Promise<WorkspacePackageImportCardPersistenceResult>,
    ): Promise<WorkspacePackageImportCardPersistenceResult> => transactionWithWorkspaceScope(scope, callback),
  });
}
