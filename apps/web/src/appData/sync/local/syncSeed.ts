import {
  hasHydratedHotState,
  hasHydratedReviewHistory,
  loadWorkspaceSettings,
} from "../../../localDb/cards/workspace";
import type { WorkspaceSummary } from "../../../types";
import type {
  TestSeedCardInput,
  TestSeedCardResult,
  TestSeedRequest,
  TestSeedResult,
} from "./testSeedBridge";
import {
  createCardLocally,
  submitReviewLocally,
} from "./syncLocalMutations";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";

const deterministicSeedReviewTimeZone = "UTC";

export type WorkspaceSeedReadiness = Readonly<{
  workspaceSettingsLoaded: boolean;
  hotStateHydrated: boolean;
  reviewHistoryHydrated: boolean;
}>;

export type EnsureWorkspaceSeedReadyInput = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  workspace: WorkspaceSummary;
  waitForWorkspaceSyncToSettle: (workspaceId: string) => Promise<void>;
  refreshWorkspaceView: (workspaceId: string) => Promise<void>;
  runSyncForWorkspace: (workspace: WorkspaceSummary) => Promise<void>;
}>;

export type SeedWorkspaceLocallyInput = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  workspaceId: string;
  request: TestSeedRequest;
}>;

export type SeedWorkspaceLocallyResult = Readonly<{
  seedResult: TestSeedResult;
  didChangeProgressHistory: boolean;
  didChangeReviewSchedule: boolean;
}>;

function requireSeedTimestamp(label: string, value: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`${label} must be a valid ISO timestamp: ${value}`);
  }

  return timestamp;
}

function validateSeedCardInput(card: TestSeedCardInput, cardIndex: number): void {
  const createdAtTimestamp = requireSeedTimestamp(`Seed card ${cardIndex} createdAt`, card.createdAt);
  let previousTimestamp = createdAtTimestamp;

  for (const [reviewIndex, review] of card.reviews.entries()) {
    const currentTimestamp = requireSeedTimestamp(
      `Seed card ${cardIndex} review ${reviewIndex} reviewedAtClient`,
      review.reviewedAtClient,
    );

    if (currentTimestamp <= previousTimestamp) {
      throw new Error(
        `Seed card ${cardIndex} review ${reviewIndex} reviewedAtClient must be later than the previous mutation timestamp`,
      );
    }

    previousTimestamp = currentTimestamp;
  }
}

export function validateSeedRequest(request: TestSeedRequest): void {
  for (const [cardIndex, card] of request.cards.entries()) {
    validateSeedCardInput(card, cardIndex);
  }
}

function isWorkspaceSeedReady(readiness: WorkspaceSeedReadiness): boolean {
  return readiness.workspaceSettingsLoaded && readiness.hotStateHydrated && readiness.reviewHistoryHydrated;
}

async function runRecoveryGuardedSeedRead<ResultType>(
  createRead: () => Promise<ResultType>,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<ResultType> {
  try {
    indexedDbOpenRecoveryState.throwIfFailed();
    const result = await createRead();
    indexedDbOpenRecoveryState.throwIfFailed();
    return result;
  } catch (error) {
    indexedDbOpenRecoveryState.throwIfFailed();
    indexedDbOpenRecoveryState.markFailed(error);
    indexedDbOpenRecoveryState.throwIfFailed();
    throw error;
  }
}

async function loadWorkspaceSeedReadiness(
  workspaceId: string,
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState,
): Promise<WorkspaceSeedReadiness> {
  const [workspaceSettings, hotStateHydrated, reviewHistoryHydrated] = await Promise.all([
    runRecoveryGuardedSeedRead(() => loadWorkspaceSettings(workspaceId), indexedDbOpenRecoveryState),
    runRecoveryGuardedSeedRead(() => hasHydratedHotState(workspaceId), indexedDbOpenRecoveryState),
    runRecoveryGuardedSeedRead(() => hasHydratedReviewHistory(workspaceId), indexedDbOpenRecoveryState),
  ]);
  indexedDbOpenRecoveryState.throwIfFailed();

  return {
    workspaceSettingsLoaded: workspaceSettings !== null,
    hotStateHydrated,
    reviewHistoryHydrated,
  };
}

export async function ensureWorkspaceSeedReady(input: EnsureWorkspaceSeedReadyInput): Promise<void> {
  input.indexedDbOpenRecoveryState.throwIfFailed();
  const workspaceId = input.workspace.workspaceId;

  await input.waitForWorkspaceSyncToSettle(workspaceId);
  input.indexedDbOpenRecoveryState.throwIfFailed();

  let readiness = await loadWorkspaceSeedReadiness(workspaceId, input.indexedDbOpenRecoveryState);
  if (isWorkspaceSeedReady(readiness)) {
    await input.refreshWorkspaceView(workspaceId);
    input.indexedDbOpenRecoveryState.throwIfFailed();
    return;
  }

  await input.runSyncForWorkspace(input.workspace);
  input.indexedDbOpenRecoveryState.throwIfFailed();
  await input.waitForWorkspaceSyncToSettle(workspaceId);
  input.indexedDbOpenRecoveryState.throwIfFailed();
  await input.refreshWorkspaceView(workspaceId);
  input.indexedDbOpenRecoveryState.throwIfFailed();

  readiness = await loadWorkspaceSeedReadiness(workspaceId, input.indexedDbOpenRecoveryState);
  if (isWorkspaceSeedReady(readiness)) {
    return;
  }

  throw new Error(
    `Workspace bootstrap is not ready for deterministic seed data: `
    + `workspaceId=${workspaceId} `
    + `workspaceSettingsLoaded=${String(readiness.workspaceSettingsLoaded)} `
    + `hotStateHydrated=${String(readiness.hotStateHydrated)} `
    + `reviewHistoryHydrated=${String(readiness.reviewHistoryHydrated)}`,
  );
}

export async function seedWorkspaceLocally(input: SeedWorkspaceLocallyInput): Promise<SeedWorkspaceLocallyResult> {
  input.indexedDbOpenRecoveryState.throwIfFailed();
  validateSeedRequest(input.request);

  const seededCards: Array<TestSeedCardResult> = [];
  let didChangeProgressHistory = false;

  for (const seedCard of input.request.cards) {
    input.indexedDbOpenRecoveryState.throwIfFailed();
    let nextCard = (await createCardLocally(
      {
        workspaceId: input.workspaceId,
        input: seedCard,
        clientUpdatedAt: seedCard.createdAt,
      },
      input.indexedDbOpenRecoveryState,
    )).card;
    input.indexedDbOpenRecoveryState.throwIfFailed();

    for (const review of seedCard.reviews) {
      input.indexedDbOpenRecoveryState.throwIfFailed();
      const reviewResult = await submitReviewLocally(
        {
          workspaceId: input.workspaceId,
          cardId: nextCard.cardId,
          rating: review.rating,
          reviewedAtClient: review.reviewedAtClient,
          reviewedTimeZone: deterministicSeedReviewTimeZone,
        },
        input.indexedDbOpenRecoveryState,
      );
      input.indexedDbOpenRecoveryState.throwIfFailed();
      nextCard = reviewResult.card;
      if (reviewResult.didChangeProgressHistory) {
        didChangeProgressHistory = true;
      }
    }

    seededCards.push({
      cardId: nextCard.cardId,
      frontText: nextCard.frontText,
      createdAt: seedCard.createdAt,
      dueAt: nextCard.dueAt,
      reviewsApplied: seedCard.reviews.length,
    });
  }

  return {
    seedResult: {
      workspaceId: input.workspaceId,
      cards: seededCards,
    },
    didChangeProgressHistory,
    didChangeReviewSchedule: input.request.cards.length > 0,
  };
}
