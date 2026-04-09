export const AUTO_CREATED_WORKSPACE_NAME = "Personal";
export const deleteWorkspaceConfirmationText = "delete workspace";
export const resetWorkspaceProgressConfirmationText = "reset all progress for all cards in this workspace";

export type WorkspaceSummary = Readonly<{
  workspaceId: string;
  name: string;
  createdAt: string;
  isSelected: boolean;
}>;

export type WorkspaceSummaryPage = Readonly<{
  workspaces: ReadonlyArray<WorkspaceSummary>;
  nextCursor: string | null;
}>;

export type WorkspaceDeletePreview = Readonly<{
  workspaceId: string;
  workspaceName: string;
  activeCardCount: number;
  confirmationText: string;
  isLastAccessibleWorkspace: boolean;
}>;

export type DeleteWorkspaceResult = Readonly<{
  ok: true;
  deletedWorkspaceId: string;
  deletedCardsCount: number;
  workspace: WorkspaceSummary;
}>;

export type WorkspaceResetProgressPreview = Readonly<{
  workspaceId: string;
  workspaceName: string;
  cardsToResetCount: number;
  confirmationText: string;
}>;

export type ResetWorkspaceProgressResult = Readonly<{
  ok: true;
  workspaceId: string;
  cardsResetCount: number;
}>;
