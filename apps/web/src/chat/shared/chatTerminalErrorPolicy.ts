import type { TranslationKey, TranslationValues } from "../../i18n";
import { OPENAI_API_KEY_INVALID_CODE } from "./chatOwnOpenAIKeyErrorPolicy";
import { CHAT_ATTACHMENT_UNSUPPORTED_TYPE_CODE } from "./chatSizePolicy";

const chatTerminalErrorKeys: ReadonlyMap<string, TranslationKey> = new Map<string, TranslationKey>([
  ["CHAT_RUN_DEADLINE_REACHED", "chatPanel.errors.runDeadlineReached"],
  ["CHAT_RUN_INTERRUPTED", "chatPanel.errors.runInterrupted"],
  ["CHAT_RUNTIME_ERROR", "chatPanel.errors.runtimeError"],
  ["CHAT_PROVIDER_ERROR", "chatPanel.errors.providerError"],
  ["CHAT_PROVIDER_AUTH_FAILED", "chatPanel.errors.providerAuthFailed"],
  ["CHAT_PROVIDER_RATE_LIMITED", "chatPanel.errors.providerRateLimited"],
  ["CHAT_PROVIDER_UNAVAILABLE", "chatPanel.errors.providerUnavailable"],
  ["CHAT_PROVIDER_ABORTED", "chatPanel.errors.providerAborted"],
  ["CHAT_CONTEXT_LENGTH_EXCEEDED", "chatPanel.errors.contextLengthExceeded"],
  [CHAT_ATTACHMENT_UNSUPPORTED_TYPE_CODE, "chatPanel.alerts.attachmentUnsupported"],
  ["AI_CONSENT_REQUIRED", "chatPanel.errors.aiConsentRequired"],
  [OPENAI_API_KEY_INVALID_CODE, "chatPanel.errors.openAIKeyInvalid"],
]);

/** The stored English text stays for uncoded messages and for codes newer than this client. */
export function localizeChatTerminalError(
  errorCode: string | null,
  storedText: string,
  t: (key: TranslationKey, values?: TranslationValues) => string,
): string {
  const key = errorCode === null ? undefined : chatTerminalErrorKeys.get(errorCode);
  return key === undefined ? storedText : t(key);
}
