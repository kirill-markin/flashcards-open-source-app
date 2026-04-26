export type GuestUpgradeMode = "bound" | "merge_required";

export type GuestSessionSnapshot = Readonly<{
  guestToken: string;
  userId: string;
  workspaceId: string;
}>;

export type GuestUpgradePreparation = Readonly<{
  mode: GuestUpgradeMode;
}>;

export type GuestUpgradeSelection =
  | Readonly<{
    type: "existing";
    workspaceId: string;
  }>
  | Readonly<{
    type: "create_new";
  }>;

export type GuestUpgradeCompleteCapabilities = Readonly<{
  guestWorkspaceSyncedAndOutboxDrained: boolean;
  requiresGuestWorkspaceSyncedAndOutboxDrained: boolean;
  supportsDroppedEntities: boolean;
}>;

export type GuestUpgradeDroppedEntities = Readonly<{
  cardIds: ReadonlyArray<string>;
  deckIds: ReadonlyArray<string>;
  reviewEventIds: ReadonlyArray<string>;
}>;

export type GuestUpgradeCompletion = Readonly<{
  workspace: Readonly<{
    workspaceId: string;
    name: string;
    createdAt: string;
    isSelected: true;
  }>;
  outcome: "fresh_completion" | "idempotent_replay";
  guestSessionId: string;
  targetSubjectUserId: string;
  targetUserId: string;
  targetWorkspaceId: string;
  droppedEntities?: GuestUpgradeDroppedEntities;
}>;

export type GuestUpgradeSelectionType = GuestUpgradeSelection["type"];

export type GuestUpgradeHistoryWrite = Readonly<{
  upgradeId: string;
  sourceGuestUserId: string;
  sourceGuestWorkspaceId: string;
  sourceGuestSessionId: string;
  sourceGuestSessionSecretHash: string;
  targetSubjectUserId: string;
  targetUserId: string;
  targetWorkspaceId: string;
  selectionType: GuestUpgradeSelectionType;
  droppedEntities?: GuestUpgradeDroppedEntities;
  replicaIdMap: ReadonlyMap<string, string>;
}>;

export type GuestUpgradeResolution = Readonly<{
  guestWorkspaceId: string;
  targetUserId: string;
  targetWorkspaceId: string;
}>;
