import { ensureSystemWorkspaceReplica } from "../sync/identity/replica";

/**
 * External AI-agent writes must still emit sync-aware metadata so first-party
 * clients observe them through the normal pull flow. The backend owns the
 * replica id and derives one deterministic workspace actor per connection.
 */
export async function ensureAgentSyncReplica(
  workspaceId: string,
  userId: string,
  connectionId: string,
): Promise<string> {
  return ensureSystemWorkspaceReplica({
    workspaceId,
    userId,
    actorKind: "agent_connection",
    actorKey: connectionId,
    platform: "web",
    appVersion: `agent:${connectionId}`,
  });
}
