import type { chatAttachmentUnsupportedTypeCode } from "./attachmentPolicy";

/**
 * Stable code of a stored chat terminal error. Clients show their own translation for a code they know
 * and the stored English text otherwise, so a code's meaning never changes once shipped.
 */
export type ChatTerminalErrorCode =
  | "CHAT_RUN_DEADLINE_REACHED"
  | "CHAT_RUN_INTERRUPTED"
  | "CHAT_RUNTIME_ERROR"
  | "CHAT_PROVIDER_ERROR"
  | "CHAT_PROVIDER_AUTH_FAILED"
  | "CHAT_PROVIDER_RATE_LIMITED"
  | "CHAT_PROVIDER_UNAVAILABLE"
  | "CHAT_PROVIDER_ABORTED"
  | "CHAT_CONTEXT_LENGTH_EXCEEDED"
  | typeof chatAttachmentUnsupportedTypeCode
  | "AI_CONSENT_REQUIRED"
  | "OPENAI_API_KEY_INVALID";

/** A null code marks text no client can translate, such as OpenAI's own words on an own-key run. */
export type ChatTerminalError = Readonly<{
  code: ChatTerminalErrorCode | null;
  message: string;
}>;

export const CHAT_RUN_INTERRUPTED_ERROR: ChatTerminalError = {
  code: "CHAT_RUN_INTERRUPTED",
  message: "The AI response was interrupted before it finished. Please try again.",
};
