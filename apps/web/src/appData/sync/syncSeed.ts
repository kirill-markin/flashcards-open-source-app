import {
  hasHydratedHotState,
  hasHydratedReviewHistory,
  loadWorkspaceSettings,
} from "../../localDb/workspace";
import type { WorkspaceSummary } from "../../types";
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

export type WorkspaceSeedReadiness = Readonly<{
  workspaceSettingsLoaded: boolean;
  hotStateHydrated: boolean;
  reviewHistoryHydrated: boolean;
}>;

export type EnsureWorkspaceSeedReadyInput = Readonly<{
  workspace: WorkspaceSummary;
  waitForWorkspaceSyncToSettle: (workspaceId: string) => Promise<void>;
  refreshWorkspaceView: (workspaceId: string) => Promise<void>;
  runSyncForWorkspace: (workspace: WorkspaceSummary) => Promise<void>;
}>;

export type SeedWorkspaceLocallyInput = Readonly<{
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

async function loadWorkspaceSeedReadiness(workspaceId: string): Promise<WorkspaceSeedReadiness> {
  const [workspaceSettings, hotStateHydrated, reviewHistoryHydrated] = await Promise.all([
    loadWorkspaceSettings(workspaceId),
    hasHydratedHotState(workspaceId),
    hasHydratedReviewHistory(workspaceId),
  ]);

  return {
    workspaceSettingsLoaded: workspaceSettings !== null,
    hotStateHydrated,
    reviewHistoryHydrated,
  };
}

export async function ensureWorkspaceSeedReady(input: EnsureWorkspaceSeedReadyInput): Promise<void> {
  const workspaceId = input.workspace.workspaceId;

  await input.waitForWorkspaceSyncToSettle(workspaceId);

  let readiness = await loadWorkspaceSeedReadiness(workspaceId);
  if (isWorkspaceSeedReady(readiness)) {
    await input.refreshWorkspaceView(workspaceId);
    return;
  }

  await input.runSyncForWorkspace(input.workspace);
  await input.waitForWorkspaceSyncToSettle(workspaceId);
  await input.refreshWorkspaceView(workspaceId);

  readiness = await loadWorkspaceSeedReadiness(workspaceId);
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
  validateSeedRequest(input.request);

  const seededCards: Array<TestSeedCardResult> = [];
  let didChangeProgressHistory = false;

  for (const seedCard of input.request.cards) {
    let nextCard = (await createCardLocally({
      workspaceId: input.workspaceId,
      input: seedCard,
      clientUpdatedAt: seedCard.createdAt,
    })).card;

    for (const review of seedCard.reviews) {
      const reviewResult = await submitReviewLocally({
        workspaceId: input.workspaceId,
        cardId: nextCard.cardId,
        rating: review.rating,
        reviewedAtClient: review.reviewedAtClient,
      });
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
