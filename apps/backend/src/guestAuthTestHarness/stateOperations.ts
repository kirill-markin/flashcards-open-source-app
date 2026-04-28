import type {
  GuestUpgradeHistoryState,
  MutableState,
} from "./models";

export function parseGuestUpgradeDroppedEntitiesState(
  serializedDroppedEntities: string | null,
): GuestUpgradeHistoryState["dropped_entities"] {
  if (serializedDroppedEntities === null) {
    return null;
  }

  const parsed = JSON.parse(serializedDroppedEntities) as GuestUpgradeHistoryState["dropped_entities"];
  return parsed;
}

export function countWorkspaceMembers(state: MutableState, workspaceId: string): number {
  return [...state.workspaceMemberships]
    .filter((membership) => membership.endsWith(`:${workspaceId}`))
    .length;
}

export function findSyncConflictWorkspaceId(
  state: MutableState,
  entityType: string,
  entityId: string,
): string | null {
  if (entityType === "card") {
    return state.cards.find((card) => card.card_id === entityId)?.workspace_id ?? null;
  }

  if (entityType === "deck") {
    return state.decks.find((deck) => deck.deck_id === entityId)?.workspace_id ?? null;
  }

  if (entityType === "review_event") {
    return state.reviewEvents.find((reviewEvent) => reviewEvent.review_event_id === entityId)?.workspace_id ?? null;
  }

  throw new Error(`Unexpected sync conflict entity type: ${entityType}`);
}

export function deleteWorkspaceFromState(state: MutableState, workspaceId: string): void {
  state.workspaces.delete(workspaceId);
  state.workspaceReplicas = state.workspaceReplicas.filter((replica) => replica.workspace_id !== workspaceId);
  state.workspaceMemberships = new Set(
    [...state.workspaceMemberships].filter((value) => !value.endsWith(`:${workspaceId}`)),
  );
  state.workspaceMembershipRoles = new Map(
    [...state.workspaceMembershipRoles].filter(([key]) => !key.endsWith(`:${workspaceId}`)),
  );
  state.cards = state.cards.filter((card) => card.workspace_id !== workspaceId);
  state.decks = state.decks.filter((deck) => deck.workspace_id !== workspaceId);
  state.reviewEvents = state.reviewEvents.filter((reviewEvent) => reviewEvent.workspace_id !== workspaceId);
}
