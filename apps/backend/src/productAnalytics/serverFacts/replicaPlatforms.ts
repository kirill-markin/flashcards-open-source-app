import type { ProductAnalyticsPlatform } from "../catalog";

// The facts the platform of one server-derived event is decided from, always carried together.
// platform on its own decides nothing: sync.workspace_replicas constrains it to ios, android, web
// and system, and several actor kinds store a value in it that describes no device at all, so
// actorKind is what makes the column readable and is named alongside it rather than assumed. Naming
// both here is what holds that rule for every producer at once: the derivation below cannot be
// reached with a platform alone.
export type WorkspaceReplicaPlatformFacts = Readonly<{
  actorKind: string;
  platform: string;
}>;

// The same two facts as one replica row selects them, alongside the id they belong to.
export type WorkspaceReplicaPlatformRow = Readonly<{
  replica_id: string;
  actor_kind: string;
  platform: string;
}>;

/**
 * The analytics platform one replica acted under, or null where none can be justified.
 *
 * Shared by the server-derived producers that resolve a replica - ./reviewAnswers.ts and
 * ./contentCreations.ts - so that one replica cannot be read two ways, and by the writers that
 * already hold the facts they ensured the replica with, so that a platform named up front and one
 * read back later cannot disagree.
 *
 * Only a client_installation replica is a device a person used. The other actor kinds
 * (db/migrations/0035_sync_installations_and_workspace_replicas.sql) each store something in
 * platform that would be a lie here: an agent_connection replica stores 'web' for the machine API
 * that is no browser, an ai_chat replica stores a hardcoded 'web' that describes no device, and
 * workspace_seed and workspace_reset store 'system'.
 *
 * An agent_connection replica is the machine API client itself, and no stored platform column holds
 * `agent` (./serverEvents.ts), so actorKind is the only thing that can resolve it.
 *
 * The remaining check is the one the column's own constraint leaves open: 'system' never reaches a
 * client_installation row, but reading platform as an analytics platform without confirming its
 * value is what would let a later widening of that constraint file rows under something this catalog
 * never meant.
 */
export function toWorkspaceReplicaPlatform(
  replica: WorkspaceReplicaPlatformFacts,
): ProductAnalyticsPlatform | null {
  if (replica.actorKind === "agent_connection") {
    return "agent";
  }

  if (replica.actorKind !== "client_installation") {
    return null;
  }

  if (replica.platform === "ios" || replica.platform === "android" || replica.platform === "web") {
    return replica.platform;
  }

  return null;
}

export function toWorkspaceReplicaRowPlatform(
  row: WorkspaceReplicaPlatformRow,
): ProductAnalyticsPlatform | null {
  return toWorkspaceReplicaPlatform({ actorKind: row.actor_kind, platform: row.platform });
}
