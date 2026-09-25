import { isOwnOpenAIKeyActive } from "../preferences/ownOpenAIKeyStorage";

// Both codes answer only a request that carried the person's key, so they are the person's to fix
// in their OpenAI account rather than failures of this app.
export const OPENAI_API_KEY_INVALID_CODE = "OPENAI_API_KEY_INVALID";
export const OWN_OPENAI_KEY_PROVIDER_ERROR_CODE = "OWN_OPENAI_KEY_PROVIDER_ERROR";

export function isOwnOpenAIKeyError(code: string | null): boolean {
  return code === OPENAI_API_KEY_INVALID_CODE || code === OWN_OPENAI_KEY_PROVIDER_ERROR_CODE;
}

/** Puts the own-key prefix above the error text, which stays exactly as it came back. */
export function formatOwnOpenAIKeyErrorMessage(prefix: string, errorText: string): string {
  return `${prefix}\n\n${errorText}`;
}

/**
 * A failed chat run does not say which key it ran on, so the prefix follows the switch as it is when
 * the failure is shown.
 */
export function formatChatRunFailureMessage(ownOpenAIKeyErrorPrefix: string, errorText: string): string {
  return isOwnOpenAIKeyActive()
    ? formatOwnOpenAIKeyErrorMessage(ownOpenAIKeyErrorPrefix, errorText)
    : errorText;
}
