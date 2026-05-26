export const AI_CHAT_MAXIMUM_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const AI_CHAT_MAXIMUM_START_RUN_REQUEST_BYTES = 5 * 1024 * 1024;
export const USER_VISIBLE_ATTACHMENT_LIMIT_MB = 5;
export const CHAT_REQUEST_TOO_LARGE_CODE = "CHAT_REQUEST_TOO_LARGE";

export function base64DataByteCount(base64Data: string): number {
  const normalizedBase64Data = base64Data.trim();
  if (normalizedBase64Data.length === 0) {
    return 0;
  }

  const paddingCharacters = normalizedBase64Data.endsWith("==")
    ? 2
    : normalizedBase64Data.endsWith("=")
      ? 1
      : 0;
  return Math.floor((normalizedBase64Data.length * 3) / 4) - paddingCharacters;
}

export function isAiChatRequestTooLargeError(params: Readonly<{
  statusCode: number | null;
  code: string | null;
}>): boolean {
  if (params.statusCode === 413) {
    return true;
  }

  return params.code === CHAT_REQUEST_TOO_LARGE_CODE;
}
