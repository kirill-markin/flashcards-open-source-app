/** A recorded analytics consent decision. No decision at all is null, never a third choice value. */
export type AnalyticsConsentChoice = "granted" | "declined";

export const defaultAccentColor = "#C44B2D";

export type AccountPreferences = Readonly<{
  accentColor: string;
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
 * Who asked for an analytics preference write. `user_action` is the person answering on this
 * browser; `reconciliation` is this browser carrying over an answer it read somewhere earlier,
 * which nothing in the request can order against the stored one.
 */
export type AnalyticsPreferenceWriteOrigin = "user_action" | "reconciliation";

/**
 * One `PATCH /me/preferences` body. A field this type leaves out is a field the request does not
 * write, which is why it cannot be a loaded `AccountPreferences`: null means "no decision recorded"
 * there and the route refuses it rather than reading it as "leave alone", so every caller names the
 * one field it is changing.
 */
export type AccountPreferencesUpdate = Readonly<{
  accentColor?: string;
  reviewReactionAnimationsEnabled?: boolean;
  analyticsConsent?: AnalyticsConsentChoice;
  productAnalyticsEnabled?: boolean;
  /**
   * Who asked for the value beside it, one field per decision because one body can carry a person's
   * press on one and a reconciled answer on the other. Omitted is `user_action` on the route, which
   * is what every control a person presses wants, so only a reconciliation carrying an answer it
   * read earlier has to name it: the route refuses to overwrite a stored `declined` with a
   * `reconciliation` `granted`, and a stored `false` with a `reconciliation` `true`, because the two
   * answers cannot be ordered.
   */
  analyticsConsentOrigin?: AnalyticsPreferenceWriteOrigin;
  productAnalyticsEnabledOrigin?: AnalyticsPreferenceWriteOrigin;
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

export type Workspace = Readonly<{
  workspaceId: string;
  name: string;
  createdAt: string;
}>;

export type UserSettings = Readonly<{
  userId: string;
  workspaceId: string;
  email: string | null;
  locale: string;
  createdAt: string;
}>;

export type CloudSettings = Readonly<{
  installationId: string;
  cloudState: CloudAccountState;
  linkedUserId: string | null;
  linkedWorkspaceId: string | null;
  linkedEmail: string | null;
  onboardingCompleted: boolean;
  updatedAt: string;
}>;

export type HomeSnapshot = Readonly<{
  deckCount: number;
  totalCards: number;
  dueCount: number;
  newCount: number;
  reviewedCount: number;
}>;
