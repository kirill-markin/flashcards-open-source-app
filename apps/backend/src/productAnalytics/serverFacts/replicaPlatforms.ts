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
  // The installation behind this replica declared itself automation
  // (db/migrations/0141_sync_installation_automation_marker.sql). It is carried beside the platform
  // rather than folded into it, because the two answer different questions: a null platform still
  // stores an event with no device on it, while automation stores no event at all.
  isAutomation: boolean;
}>;

// The same facts as one replica row selects them, alongside the id they belong to. is_automation is
// the joined sync.installations marker, never a column of sync.workspace_replicas.
export type WorkspaceReplicaPlatformRow = Readonly<{
  replica_id: string;
  actor_kind: string;
  platform: string;
  is_automation: boolean;
}>;

// What one replica decides for every event attributed to it: the platform to file it under, and
// whether it may be reported at all.
export type WorkspaceReplicaAttribution = Readonly<{
  platform: ProductAnalyticsPlatform | null;
  isAutomation: boolean;
}>;

/**
 * The analytics platform one replica acted under, or null where none can be justified.
 *
 * Shared by the server-derived producers that resolve a replica - ./reviewAnswers.ts and
 * ./contentCreations.ts - so that one replica cannot be read two ways, and by the writers that
 * already hold the facts they ensured the replica with, so that a platform named up front and one
 * read back later cannot disagree. The one reader that bypasses it is ./reviewAnswers.ts for an
 * ai_chat replica: a chat review takes its platform from its chat run rather than from the replica,
 * so the same ai_chat replica can give a device on review_answered and still gives null on
 * card_created and deck_created.
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
function toWorkspaceReplicaPlatform(
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

/**
 * Everything one replica decides, from the facts a caller already holds.
 *
 * An automation installation is reported as automation whatever its platform resolves to: the
 * platform is still derived, and is still the answer for the events of every other replica, but for
 * this one it never reaches an event because the producers drop those facts before they emit.
 */
export function toWorkspaceReplicaAttribution(
  replica: WorkspaceReplicaPlatformFacts,
): WorkspaceReplicaAttribution {
  return {
    platform: toWorkspaceReplicaPlatform(replica),
    isAutomation: replica.isAutomation,
  };
}

export function toWorkspaceReplicaRowAttribution(
  row: WorkspaceReplicaPlatformRow,
): WorkspaceReplicaAttribution {
  return toWorkspaceReplicaAttribution({
    actorKind: row.actor_kind,
    platform: row.platform,
    isAutomation: row.is_automation,
  });
}
