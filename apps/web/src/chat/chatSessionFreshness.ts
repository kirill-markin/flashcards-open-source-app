import type { StoredMessage } from "./useChatHistory";

export const CHAT_SESSION_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export function getLatestLocalUserMessageTimestamp(
  messages: ReadonlyArray<StoredMessage>,
): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message.timestamp;
    }
  }

  return null;
}

export function isChatSessionStale(
  messages: ReadonlyArray<StoredMessage>,
  nowMillis: number,
): boolean {
  const latestUserMessageTimestamp = getLatestLocalUserMessageTimestamp(messages);
  if (latestUserMessageTimestamp === null) {
    return false;
  }

  return nowMillis - latestUserMessageTimestamp > CHAT_SESSION_STALE_AFTER_MS;
}
