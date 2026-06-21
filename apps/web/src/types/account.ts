export type AccountPreferences = Readonly<{
  reviewReactionAnimationsEnabled: boolean;
}>;

export type AccountPreferencesEnvelope = Readonly<{
  preferences: AccountPreferences;
}>;

export type SessionInfo = Readonly<{
  userId: string;
  selectedWorkspaceId: string | null;
  authTransport: string;
  csrfToken: string | null;
  preferences: AccountPreferences;
  profile: Readonly<{
    email: string | null;
    locale: string;
    createdAt: string;
  }>;
}>;

export type CloudAccountState = "disconnected" | "linking-ready" | "linked";

export type WorkspaceSummary = Readonly<{
  workspaceId: string;
  name: string;
  createdAt: string;
  isSelected: boolean;
}>;

export type WorkspaceDeletePreview = Readonly<{
  workspaceId: string;
  workspaceName: string;
  activeCardCount: number;
  confirmationText: string;
  isLastAccessibleWorkspace: boolean;
}>;

export type DeleteWorkspaceResponse = Readonly<{
  ok: true;
  deletedWorkspaceId: string;
  deletedCardsCount: number;
  workspace: WorkspaceSummary;
}>;

export const resetWorkspaceProgressConfirmationText: string = "reset all progress for all cards in this workspace";

export type WorkspaceResetProgressPreview = Readonly<{
  workspaceId: string;
  workspaceName: string;
  cardsToResetCount: number;
  confirmationText: string;
}>;

export type ResetWorkspaceProgressResponse = Readonly<{
  ok: true;
  workspaceId: string;
  cardsResetCount: number;
}>;

/** Mirrors the iOS local workspace payload used by local AI tools. */
export type Workspace = Readonly<{
  workspaceId: string;
  name: string;
  createdAt: string;
}>;

/** Mirrors the iOS local user settings payload used by local AI tools. */
export type UserSettings = Readonly<{
  userId: string;
  workspaceId: string;
  email: string | null;
  locale: string;
  createdAt: string;
}>;

/** Mirrors the iOS local cloud-settings payload used by local AI tools. */
export type CloudSettings = Readonly<{
  installationId: string;
  cloudState: CloudAccountState;
  linkedUserId: string | null;
  linkedWorkspaceId: string | null;
  linkedEmail: string | null;
  onboardingCompleted: boolean;
  updatedAt: string;
}>;

/** Mirrors the iOS local home snapshot payload used by local AI tools. */
export type HomeSnapshot = Readonly<{
  deckCount: number;
  totalCards: number;
  dueCount: number;
  newCount: number;
  reviewedCount: number;
}>;
