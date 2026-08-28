/**
 * Platform bound to a guest session. `ios` and `android` guest sessions own an offline workspace and
 * can be upgraded into an account. `web` is deliberately narrower: it exists only so a signed-out
 * browser can authenticate an analytics batch against an endpoint that always requires a credential.
 * `guestAuth/webPlatform.ts` is the single gate that enforces that, refused by default on every
 * authenticated surface and opted into only by analytics ingest.
 */
export type GuestSessionPlatform = "ios" | "android" | "web";

export type GuestUpgradeMode = "bound" | "merge_required";

export type GuestSessionSnapshot = Readonly<{
  guestToken: string;
  userId: string;
  workspaceId: string;
  platform: GuestSessionPlatform | null;
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
  // Added after the first dropped-entity clients shipped. Replayed
  // auth.guest_upgrade_history rows written before media assets merged do not
  // carry it, so readers must tolerate an absent array.
  mediaAssetIds?: ReadonlyArray<string>;
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
  // The guest identity that was upgraded. The caller needs it after the transaction commits to
  // record the conversion and to link the guest's earlier analytics events to the account.
  guestUserId: string;
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
