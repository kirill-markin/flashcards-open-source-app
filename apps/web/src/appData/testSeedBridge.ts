import type {
  CreateCardInput,
} from "../types";

export type TestSeedReviewInput = Readonly<{
  rating: 0 | 1 | 2 | 3;
  reviewedAtClient: string;
}>;

export type TestSeedCardInput = CreateCardInput & Readonly<{
  createdAt: string;
  reviews: ReadonlyArray<TestSeedReviewInput>;
}>;

export type TestSeedRequest = Readonly<{
  cards: ReadonlyArray<TestSeedCardInput>;
}>;

export type TestSeedCardResult = Readonly<{
  cardId: string;
  frontText: string;
  createdAt: string;
  dueAt: string | null;
  reviewsApplied: number;
}>;

export type TestSeedResult = Readonly<{
  workspaceId: string;
  cards: ReadonlyArray<TestSeedCardResult>;
}>;

export type AppDataTestSeedBridge = Readonly<{
  workspaceId: string;
  workspaceName: string;
  seedLinkedWorkspace: (request: TestSeedRequest) => Promise<TestSeedResult>;
}>;

export type AppDataE2eConfig = Readonly<{
  enableTestSeedBridge: boolean;
}>;

declare global {
  interface Window {
    __FLASHCARDS_E2E__?: AppDataE2eConfig;
    __FLASHCARDS_TEST_SEED_BRIDGE__?: AppDataTestSeedBridge;
  }
}

export function isTestSeedBridgeEnabled(targetWindow: Window): boolean {
  return targetWindow.__FLASHCARDS_E2E__?.enableTestSeedBridge === true;
}
