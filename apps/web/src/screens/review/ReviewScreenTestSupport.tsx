import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { AppDataContextValue } from "../../appData/types";
import { clearLoadingSnapshotFallbackStorage } from "../shared/loadingSnapshots";
import type {
  Card,
  Deck,
  DecksListSnapshot,
  ReviewProgressBadgeState,
  ReviewQueueSnapshot,
  ReviewTimelinePage,
  WorkspaceTagsSummary,
} from "../../types";

const {
  loadDecksListSnapshotMock,
  loadReviewQueueChunkMock,
  loadReviewQueueSnapshotMock,
  loadReviewTimelinePageMock,
  loadWorkspaceTagsSummaryMock,
  useAppDataMock,
  useReviewProgressBadgeMock,
} = vi.hoisted(() => ({
  loadDecksListSnapshotMock: vi.fn(),
  loadReviewQueueChunkMock: vi.fn(),
  loadReviewQueueSnapshotMock: vi.fn(),
  loadReviewTimelinePageMock: vi.fn(),
  loadWorkspaceTagsSummaryMock: vi.fn(),
  useAppDataMock: vi.fn(),
  useReviewProgressBadgeMock: vi.fn(),
}));

vi.mock("../../appData", () => ({
  useAppData: useAppDataMock,
  useReviewProgressBadge: useReviewProgressBadgeMock,
}));

vi.mock("../../localDb/decks", () => ({
  loadDecksListSnapshot: loadDecksListSnapshotMock,
}));

vi.mock("../../localDb/reviews", () => ({
  loadReviewQueueChunk: loadReviewQueueChunkMock,
  loadReviewQueueSnapshot: loadReviewQueueSnapshotMock,
  loadReviewTimelinePage: loadReviewTimelinePageMock,
}));

vi.mock("../../localDb/workspace", () => ({
  loadWorkspaceTagsSummary: loadWorkspaceTagsSummaryMock,
}));

import { ReviewScreen } from "./ReviewScreen";

type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};

type ReviewScreenAppData = Mutable<AppDataContextValue>;

export type ReviewScreenTestState = {
  appData: ReviewScreenAppData;
  cards: Array<Card>;
  decks: Array<Deck>;
  reviewProgressBadge: ReviewProgressBadgeState;
  reviewQueue: Array<Card>;
  reviewTimeline: Array<Card>;
};

type ReviewScreenTestHarness = Readonly<{
  dispatchDocumentKeydown: (key: string) => Promise<void>;
  getContainer: () => HTMLDivElement;
  getState: () => ReviewScreenTestState;
  openReviewFilterMenu: () => Promise<void>;
  renderReviewScreen: () => Promise<void>;
  rerenderReviewScreen: () => Promise<void>;
  revealAnswer: () => Promise<void>;
}>;

function createWorkspaceSettings(): NonNullable<AppDataContextValue["workspaceSettings"]> {
  return {
    algorithm: "fsrs-6",
    desiredRetention: 0.9,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    maximumIntervalDays: 36500,
    enableFuzz: true,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByReplicaId: "device-1",
    lastOperationId: "settings-operation-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
  };
}

function throwNotUsed(functionName: string): never {
  throw new Error(`${functionName} was not expected in this test`);
}

function createAppData(state: ReviewScreenTestState): ReviewScreenAppData {
  const appData: ReviewScreenAppData = {
    sessionLoadState: "ready",
    sessionVerificationState: "verified",
    isSessionVerified: true,
    sessionErrorMessage: "",
    session: null,
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Primary",
      createdAt: "2026-03-10T00:00:00.000Z",
      isSelected: true,
    },
    availableWorkspaces: [],
    isChoosingWorkspace: false,
    workspaceSettings: createWorkspaceSettings(),
    cloudSettings: null,
    localReadVersion: 0,
    localCardCount: 0,
    isSyncing: false,
    selectedReviewFilter: { kind: "allCards" },
    errorMessage: "",
    setErrorMessage: vi.fn(),
    runSync: vi.fn(async (): Promise<void> => undefined),
    initialize: vi.fn(async (): Promise<void> => undefined),
    chooseWorkspace: vi.fn(async (_workspaceId: string): Promise<void> => undefined),
    createWorkspace: vi.fn(async (_name: string): Promise<void> => undefined),
    renameWorkspace: vi.fn(async (_workspaceId: string, _name: string): Promise<void> => undefined),
    deleteWorkspace: vi.fn(async (_workspaceId: string, _confirmationText: string): Promise<void> => undefined),
    refreshLocalData: vi.fn(async (): Promise<void> => undefined),
    getCardById: vi.fn(async (_cardId: string): Promise<Card> => throwNotUsed("getCardById")),
    getDeckById: vi.fn(async (_deckId: string): Promise<Deck> => throwNotUsed("getDeckById")),
    createCardItem: vi.fn(async (_input): Promise<Card> => throwNotUsed("createCardItem")),
    createDeckItem: vi.fn(async (_input): Promise<Deck> => throwNotUsed("createDeckItem")),
    updateCardItem: vi.fn(async (_cardId: string, _input): Promise<Card> => throwNotUsed("updateCardItem")),
    updateDeckItem: vi.fn(async (_deckId: string, _input): Promise<Deck> => throwNotUsed("updateDeckItem")),
    deleteCardItem: vi.fn(async (_cardId: string): Promise<Card> => throwNotUsed("deleteCardItem")),
    deleteDeckItem: vi.fn(async (_deckId: string): Promise<Deck> => throwNotUsed("deleteDeckItem")),
    selectReviewFilter: vi.fn(),
    openReview: vi.fn(),
    submitReviewItem: vi.fn(async (_cardId: string, _rating: 0 | 1 | 2 | 3): Promise<Card> => throwNotUsed("submitReviewItem")),
  };

  Object.defineProperty(appData, "localCardCount", {
    configurable: true,
    enumerable: true,
    get: (): number => state.cards.length,
  });

  return appData;
}

function createDefaultReviewScreenTestState(): ReviewScreenTestState {
  const state = {
    appData: null as unknown as ReviewScreenAppData,
    cards: [],
    decks: [],
    reviewProgressBadge: {
      streakDays: 0,
      hasReviewedToday: false,
      isInteractive: true,
    },
    reviewQueue: [],
    reviewTimeline: [],
  };

  state.appData = createAppData(state);
  return state;
}

function createAllCardsStats(state: ReviewScreenTestState): DecksListSnapshot["allCardsStats"] {
  return {
    totalCards: state.cards.length,
    dueCards: state.reviewQueue.length,
    newCards: state.cards.filter((card) => card.reps === 0 && card.lapses === 0).length,
    reviewedCards: state.cards.filter((card) => card.reps > 0 || card.lapses > 0).length,
  };
}

function createReviewQueueSnapshot(state: ReviewScreenTestState): ReviewQueueSnapshot {
  return {
    resolvedReviewFilter: state.appData.selectedReviewFilter,
    cards: state.reviewQueue,
    nextCursor: null,
    reviewCounts: {
      dueCount: state.reviewQueue.length,
      totalCount: state.reviewQueue.length,
    },
  };
}

function createReviewTimelinePage(state: ReviewScreenTestState): ReviewTimelinePage {
  return {
    cards: state.reviewTimeline,
    hasMoreCards: false,
  };
}

function createDecksSnapshot(state: ReviewScreenTestState): DecksListSnapshot {
  return {
    deckSummaries: state.decks.map((deck) => ({
      deckId: deck.deckId,
      name: deck.name,
      filterDefinition: deck.filterDefinition,
      createdAt: deck.createdAt,
      totalCards: 0,
      dueCards: 0,
      newCards: 0,
      reviewedCards: 0,
    })),
    allCardsStats: createAllCardsStats(state),
  };
}

function createTagsSummary(state: ReviewScreenTestState): WorkspaceTagsSummary {
  const counts = new Map<string, number>();
  for (const card of state.cards) {
    for (const tag of card.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return {
    tags: [...counts.entries()].map(([tag, cardsCount]) => ({ tag, cardsCount })),
    totalCards: state.cards.length,
  };
}

export function createCard(overrides?: Partial<Card>): Card {
  return {
    cardId: "card-1",
    frontText: "Front",
    backText: "Back",
    tags: [],
    effortLevel: "fast",
    dueAt: null,
    createdAt: "2026-03-10T09:00:00.000Z",
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByReplicaId: "device-1",
    lastOperationId: "operation-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

export function createDeck(overrides?: Partial<Deck>): Deck {
  return {
    deckId: "deck-1",
    workspaceId: "workspace-1",
    name: "Grammar",
    filterDefinition: {
      version: 2,
      effortLevels: ["fast"],
      tags: ["grammar"],
    },
    createdAt: "2026-03-10T09:00:00.000Z",
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByReplicaId: "device-1",
    lastOperationId: "deck-operation-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

export function createDecks(names: ReadonlyArray<string>): Array<Deck> {
  return names.map((name, index) => createDeck({
    deckId: `deck-${index + 1}`,
    name,
    updatedAt: `2026-03-10T${String(index).padStart(2, "0")}:00:00.000Z`,
  }));
}

export function clickElement(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

export async function clickElementAsync(element: Element): Promise<void> {
  await act(async () => {
    clickElement(element);
  });
}

export function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function setTextFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (field instanceof HTMLInputElement) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(field, value);
  } else {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    descriptor?.set?.call(field, value);
  }

  field.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function setTextFieldValueAsync(field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    setTextFieldValue(field, value);
  });
}

export function dispatchKeydown(element: Document | HTMLElement, key: string): void {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

function clearWindowLocalStorage(): void {
  clearLoadingSnapshotFallbackStorage();
  const storage = window.localStorage;
  if (typeof storage.clear === "function") {
    storage.clear();
    return;
  }

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key !== null) {
      storage.removeItem(key);
    }
  }
}

const reviewStylesheet = readFileSync(resolve(process.cwd(), "src/styles/features/review.css"), "utf8");

export function reviewStylesContain(...fragments: ReadonlyArray<string>): boolean {
  return fragments.every((fragment) => reviewStylesheet.includes(fragment));
}

export function setupReviewScreenTest(): ReviewScreenTestHarness {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;
  let state = createDefaultReviewScreenTestState();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    clearWindowLocalStorage();

    state = createDefaultReviewScreenTestState();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    useAppDataMock.mockReset();
    loadDecksListSnapshotMock.mockReset();
    loadReviewQueueChunkMock.mockReset();
    loadReviewQueueSnapshotMock.mockReset();
    loadReviewTimelinePageMock.mockReset();
    loadWorkspaceTagsSummaryMock.mockReset();
    useReviewProgressBadgeMock.mockReset();

    useAppDataMock.mockImplementation(() => state.appData);
    useReviewProgressBadgeMock.mockImplementation(() => state.reviewProgressBadge);
    loadDecksListSnapshotMock.mockImplementation(async (): Promise<DecksListSnapshot> => createDecksSnapshot(state));
    loadReviewQueueChunkMock.mockResolvedValue({
      cards: [],
      nextCursor: null,
    });
    loadReviewQueueSnapshotMock.mockImplementation(async (): Promise<ReviewQueueSnapshot> => createReviewQueueSnapshot(state));
    loadReviewTimelinePageMock.mockImplementation(async (): Promise<ReviewTimelinePage> => createReviewTimelinePage(state));
    loadWorkspaceTagsSummaryMock.mockImplementation(async (): Promise<WorkspaceTagsSummary> => createTagsSummary(state));
  });

  afterEach(() => {
    const currentRoot = root;
    if (currentRoot !== null) {
      act(() => currentRoot.unmount());
    }
    clearWindowLocalStorage();
    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
  });

  function getContainer(): HTMLDivElement {
    if (container === null) {
      throw new Error("ReviewScreen test container is not ready");
    }

    return container;
  }

  async function renderReviewScreen(): Promise<void> {
    const currentRoot = root;
    if (currentRoot === null) {
      throw new Error("ReviewScreen test root is not ready");
    }

    await act(async () => {
      currentRoot.render(
        <I18nProvider>
          <MemoryRouter>
            <ReviewScreen />
          </MemoryRouter>
        </I18nProvider>,
      );
    });
  }

  async function openReviewFilterMenu(): Promise<void> {
    const trigger = getContainer().querySelector(".review-filter-trigger");
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error("Review filter trigger was not found");
    }

    await act(async () => {
      clickElement(trigger);
    });
  }

  async function revealAnswer(): Promise<void> {
    const revealButton = getContainer().querySelector(".review-reveal-btn");
    if (!(revealButton instanceof HTMLButtonElement)) {
      throw new Error("Reveal answer button was not found");
    }

    await act(async () => {
      clickElement(revealButton);
    });
  }

  async function dispatchDocumentKeydown(key: string): Promise<void> {
    await act(async () => {
      dispatchKeydown(document, key);
    });
  }

  return {
    dispatchDocumentKeydown,
    getContainer,
    getState: (): ReviewScreenTestState => state,
    openReviewFilterMenu,
    renderReviewScreen,
    rerenderReviewScreen: renderReviewScreen,
    revealAnswer,
  };
}

export {
  loadDecksListSnapshotMock,
  loadReviewQueueChunkMock,
  loadReviewQueueSnapshotMock,
  loadReviewTimelinePageMock,
  loadWorkspaceTagsSummaryMock,
  useAppDataMock,
  useReviewProgressBadgeMock,
};
