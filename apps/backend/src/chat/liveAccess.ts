import { HttpError } from "../errors";
import { getChatRunSnapshot } from "./runs";

export const CHAT_LIVE_NOT_FOUND_CODE = "CHAT_LIVE_NOT_FOUND";

/**
 * Rejects live attaches that no longer map to a run visible inside the
 * caller's current workspace scope.
 */
export async function assertChatLiveRunAccess(
  userId: string,
  workspaceId: string,
  sessionId: string,
  runId: string,
): Promise<void> {
  const run = await getChatRunSnapshot(userId, workspaceId, runId);
  if (run === null || run.sessionId !== sessionId) {
    throw new HttpError(404, "Chat live stream not found.", CHAT_LIVE_NOT_FOUND_CODE);
  }
}
