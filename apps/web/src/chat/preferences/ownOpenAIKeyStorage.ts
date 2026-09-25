import { useSyncExternalStore } from "react";

/**
 * The person's own OpenAI key lives only in this browser and leaves it only as the
 * `x-openai-api-key` header on `POST /chat` and `POST /chat/transcriptions`. The switch and the key
 * are stored separately, so turning the switch off keeps the key for the next time it is turned on.
 * Both keys carry the `flashcards-` prefix, so logout and account deletion wipe them.
 */
const OWN_OPENAI_KEY_ENABLED_STORAGE_KEY = "flashcards-own-openai-key-enabled";
const OWN_OPENAI_KEY_STORAGE_KEY = "flashcards-own-openai-key";

const ownOpenAIKeyChangeEventName = "flashcards-own-openai-key-change";

// A header value must be Latin-1, or `new Headers(...)` throws a `TypeError` that can quote the
// value itself; printable ASCII covers every real OpenAI key.
const sendableOwnOpenAIKeyPattern = /^[\x20-\x7E]{1,512}$/;

export const OWN_OPENAI_KEY_HEADER_NAME = "x-openai-api-key";

type OwnOpenAIKeySetting = Readonly<{
  isEnabled: boolean;
  apiKey: string;
  setIsEnabled: (nextValue: boolean) => void;
  setApiKey: (nextValue: string) => void;
}>;

type OwnOpenAIKeyListener = () => void;

function getBrowserStorage(): Storage {
  const storageValue = window.localStorage;
  if (
    typeof storageValue?.getItem !== "function"
    || typeof storageValue.setItem !== "function"
    || typeof storageValue.removeItem !== "function"
  ) {
    throw new Error("Browser localStorage is required for the Web own OpenAI key setting.");
  }

  return storageValue;
}

function readStoredOwnOpenAIKeyEnabled(): boolean {
  return getBrowserStorage().getItem(OWN_OPENAI_KEY_ENABLED_STORAGE_KEY) === "true";
}

function readStoredOwnOpenAIKey(): string {
  return getBrowserStorage().getItem(OWN_OPENAI_KEY_STORAGE_KEY) ?? "";
}

/** A trimmed, non-empty key that cannot be sent as a header value. */
export function isOwnOpenAIKeyUnsendable(apiKey: string): boolean {
  const trimmedApiKey = apiKey.trim();
  return trimmedApiKey !== "" && sendableOwnOpenAIKeyPattern.test(trimmedApiKey) === false;
}

/**
 * The key to send with an AI request, or `null` while the switch is off, the field is empty, or the
 * key cannot be sent as a header, which the settings screen shows next to the field.
 */
export function readActiveOwnOpenAIKey(): string | null {
  if (readStoredOwnOpenAIKeyEnabled() === false) {
    return null;
  }

  const apiKey = readStoredOwnOpenAIKey().trim();
  return sendableOwnOpenAIKeyPattern.test(apiKey) ? apiKey : null;
}

export function isOwnOpenAIKeyActive(): boolean {
  return readActiveOwnOpenAIKey() !== null;
}

function persistOwnOpenAIKeyEnabled(nextValue: boolean): void {
  getBrowserStorage().setItem(OWN_OPENAI_KEY_ENABLED_STORAGE_KEY, String(nextValue));
}

function persistOwnOpenAIKey(nextValue: string): void {
  if (nextValue === "") {
    getBrowserStorage().removeItem(OWN_OPENAI_KEY_STORAGE_KEY);
    return;
  }

  getBrowserStorage().setItem(OWN_OPENAI_KEY_STORAGE_KEY, nextValue);
}

function dispatchOwnOpenAIKeyChange(): void {
  window.dispatchEvent(new Event(ownOpenAIKeyChangeEventName));
}

function subscribeToOwnOpenAIKey(listener: OwnOpenAIKeyListener): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (
      event.key === OWN_OPENAI_KEY_ENABLED_STORAGE_KEY
      || event.key === OWN_OPENAI_KEY_STORAGE_KEY
      || event.key === null
    ) {
      listener();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(ownOpenAIKeyChangeEventName, listener);

  return (): void => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(ownOpenAIKeyChangeEventName, listener);
  };
}

export function useOwnOpenAIKeySetting(): OwnOpenAIKeySetting {
  const isEnabled = useSyncExternalStore(subscribeToOwnOpenAIKey, readStoredOwnOpenAIKeyEnabled);
  const apiKey = useSyncExternalStore(subscribeToOwnOpenAIKey, readStoredOwnOpenAIKey);

  function setIsEnabled(nextValue: boolean): void {
    persistOwnOpenAIKeyEnabled(nextValue);
    dispatchOwnOpenAIKeyChange();
  }

  function setApiKey(nextValue: string): void {
    persistOwnOpenAIKey(nextValue);
    dispatchOwnOpenAIKeyChange();
  }

  return {
    isEnabled,
    apiKey,
    setIsEnabled,
    setApiKey,
  };
}

export function useIsOwnOpenAIKeyActive(): boolean {
  return useSyncExternalStore(subscribeToOwnOpenAIKey, isOwnOpenAIKeyActive);
}
