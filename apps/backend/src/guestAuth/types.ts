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
}>;

export type GuestUpgradeSelectionType = GuestUpgradeSelection["type"];

export type GuestUpgradeHistoryWrite = Readonly<{
  upgradeId: string;
  sourceGuestUserId: string;
  sourceGuestWorkspaceId: string;
  sourceGuestSessionId: string;
  targetSubjectUserId: string;
  targetUserId: string;
  targetWorkspaceId: string;
  selectionType: GuestUpgradeSelectionType;
  replicaIdMap: ReadonlyMap<string, string>;
}>;

export type GuestUpgradeResolution = Readonly<{
  guestWorkspaceId: string;
  targetUserId: string;
  targetWorkspaceId: string;
}>;
