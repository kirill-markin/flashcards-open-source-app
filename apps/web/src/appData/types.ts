import type { ReactNode } from "react";
import type {
  Card,
  CloudSettings,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  ReviewFilter,
  SessionInfo,
  UpdateCardInput,
  UpdateDeckInput,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
} from "../types";

export type SessionLoadState = "loading" | "ready" | "redirecting" | "selecting_workspace" | "error" | "deleted";

export type AppDataContextValue = Readonly<{
  sessionLoadState: SessionLoadState;
  sessionErrorMessage: string;
  session: SessionInfo | null;
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  isChoosingWorkspace: boolean;
  workspaceSettings: WorkspaceSchedulerSettings | null;
  cloudSettings: CloudSettings | null;
  localReadVersion: number;
  localCardCount: number;
  isSyncing: boolean;
  selectedReviewFilter: ReviewFilter;
  errorMessage: string;
  setErrorMessage: (message: string) => void;
  initialize: () => Promise<void>;
  chooseWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  refreshLocalData: () => Promise<void>;
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

export type Props = Readonly<{
  children: ReactNode;
}>;
