/** A recorded analytics consent decision. No decision at all is null, never a third choice value. */
export type AnalyticsConsentChoice = "granted" | "declined";

export type AccountPreferences = Readonly<{
  reviewReactionAnimationsEnabled: boolean;
  analyticsConsent: AnalyticsConsentChoice | null;
  /**
   * Whether this person is measured at all, or null where nobody has answered. Null reads as on:
   * the basis is legitimate interest, so only an explicit `false` turns collection off. It is not
   * `analyticsConsent`, which answers the cookie banner alone.
   */
  productAnalyticsEnabled: boolean | null;
}>;

/**
 * One `PATCH /me/preferences` body. A field this type leaves out is a field the request does not
 * write, which is why it cannot be a loaded `AccountPreferences`: null means "no decision recorded"
 * there and the route refuses it rather than reading it as "leave alone", so every caller names the
 * one field it is changing.
 */
export type AccountPreferencesUpdate = Readonly<{
  reviewReactionAnimationsEnabled?: boolean;
  analyticsConsent?: AnalyticsConsentChoice;
  productAnalyticsEnabled?: boolean;
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
