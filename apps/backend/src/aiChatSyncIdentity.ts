import { ensureSystemWorkspaceReplica, type SyncClientPlatform } from "./syncIdentity";

/**
 * Backend-executed AI chat writes must show up through the normal sync flow,
 * but they must not impersonate a client installation or external agent
 * connection. The backend derives one deterministic workspace replica per
 * workspace plus platform AI actor.
 */
export async function ensureAIChatSyncReplica(
  workspaceId: string,
  userId: string,
  devicePlatform: SyncClientPlatform,
): Promise<string> {
  return ensureSystemWorkspaceReplica({
    workspaceId,
    userId,
    actorKind: "ai_chat",
    actorKey: `${devicePlatform}:chat`,
    platform: devicePlatform,
    appVersion: `ai-chat:${devicePlatform}:chat`,
  });
}
