import { createHash } from "node:crypto";

/**
 * Deterministic workspace replica identity for non-client (system) actors.
 *
 * This mirrors the backend derivation in
 * apps/backend/src/sync/identity/replica.ts exactly, including the
 * version/variant nibble layout. Both packages MUST produce the same
 * replica id for the same `(workspaceId, actorKind, actorKey)` because the
 * unique index `idx_workspace_replicas_workspace_actor_kind_key` keys system
 * replicas on `(workspace_id, actor_kind, actor_key)`; a divergent id would
 * collide with that index when the backend later re-ensures the same actor.
 *
 * The auth Lambda is intentionally dependency-light and cannot import the
 * backend package, so this small helper is duplicated here. The duplication is
 * guarded by the bootstrap schema contract test and is the target of the
 * planned shared workspace-bootstrap module.
 */

type SystemWorkspaceReplicaActorKind =
  | "workspace_seed"
  | "workspace_reset"
  | "agent_connection"
  | "ai_chat";

function toUuidFromSeed(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex");
  const baseHex = digest.slice(0, 32).split("");

  baseHex[12] = "5";
  baseHex[16] = ((parseInt(baseHex[16], 16) & 0x3) | 0x8).toString(16);

  return [
    baseHex.slice(0, 8).join(""),
    baseHex.slice(8, 12).join(""),
    baseHex.slice(12, 16).join(""),
    baseHex.slice(16, 20).join(""),
    baseHex.slice(20, 32).join(""),
  ].join("-");
}

export function buildSystemWorkspaceReplicaId(
  workspaceId: string,
  actorKind: SystemWorkspaceReplicaActorKind,
  actorKey: string,
): string {
  return toUuidFromSeed(`${workspaceId}:${actorKind}:${actorKey}`);
}
