import type { ReactNode } from "react";
import type { PersistedOutboxRecord } from "../syncStorage";
import type {
  Card,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  ReviewFilter,
  ReviewEvent,
  SessionInfo,
  UpdateCardInput,
  UpdateDeckInput,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
} from "../types";

export type SessionLoadState = "loading" | "ready" | "redirecting" | "selecting_workspace" | "error";
type ResourceLoadStatus = "idle" | "loading" | "ready" | "error";

export type ResourceState<Item> = Readonly<{
  status: ResourceLoadStatus;
  items: ReadonlyArray<Item>;
  errorMessage: string;
  hasLoaded: boolean;
}>;

export type AppDataContextValue = Readonly<{
  sessionLoadState: SessionLoadState;
  sessionErrorMessage: string;
  session: SessionInfo | null;
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  isChoosingWorkspace: boolean;
  workspaceSettings: WorkspaceSchedulerSettings | null;
  selectedReviewFilter: ReviewFilter;
  selectedReviewFilterTitle: string;
  cardsState: ResourceState<Card>;
  decksState: ResourceState<Deck>;
  reviewQueueState: ResourceState<Card>;
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
  reviewQueue: ReadonlyArray<Card>;
  reviewTimeline: ReadonlyArray<Card>;
  errorMessage: string;
  setErrorMessage: (message: string) => void;
  initialize: () => Promise<void>;
  chooseWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  ensureCardsLoaded: () => Promise<void>;
  ensureDecksLoaded: () => Promise<void>;
  ensureReviewQueueLoaded: () => Promise<void>;
  refreshCards: () => Promise<void>;
  refreshDecks: () => Promise<void>;
  refreshReviewQueue: () => Promise<void>;
  getCardById: (cardId: string) => Promise<Card>;
  getDeckById: (deckId: string) => Promise<Deck>;
  createCardItem: (input: CreateCardInput) => Promise<Card>;
  createDeckItem: (input: CreateDeckInput) => Promise<Deck>;
  updateCardItem: (cardId: string, input: UpdateCardInput) => Promise<Card>;
  updateDeckItem: (deckId: string, input: UpdateDeckInput) => Promise<Deck>;
  deleteCardItem: (cardId: string) => Promise<Card>;
  deleteDeckItem: (deckId: string) => Promise<Deck>;
  selectReviewFilter: (reviewFilter: ReviewFilter) => void;
  openReview: (reviewFilter: ReviewFilter) => void;
  submitReviewItem: (cardId: string, rating: 0 | 1 | 2 | 3) => Promise<Card>;
}>;

export type MutableSnapshot = {
  cards: Array<Card>;
  decks: Array<Deck>;
  reviewEvents: Array<ReviewEvent>;
  workspaceSettings: WorkspaceSchedulerSettings | null;
  outbox: Array<PersistedOutboxRecord>;
  lastAppliedChangeId: number;
};

export type Props = Readonly<{
  children: ReactNode;
}>;
