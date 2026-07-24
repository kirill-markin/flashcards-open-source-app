import { ensureSystemWorkspaceReplica, type SyncClientPlatform } from "./replica";

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
  signal: AbortSignal | null,
): Promise<string> {
  signal?.throwIfAborted();
  return ensureSystemWorkspaceReplica({
    workspaceId,
    userId,
    actorKind: "ai_chat",
    actorKey: `${devicePlatform}:chat`,
    platform: devicePlatform,
    appVersion: `ai-chat:${devicePlatform}:chat`,
    signal,
  });
}
