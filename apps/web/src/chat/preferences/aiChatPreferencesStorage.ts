/**
 * Kept free of imports: session recovery reads the key at module load, and importing the
 * preferences context from there would close a cycle through premium and appData.
 */
export const AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY = "flashcards-ai-chat-composer-suggestions-enabled";

function getBrowserStorage(): Storage {
  const storageValue = window.localStorage;
  if (
    typeof storageValue?.getItem !== "function"
    || typeof storageValue.setItem !== "function"
    || typeof storageValue.removeItem !== "function"
  ) {
    throw new Error("Browser localStorage is required for Web AI chat preferences.");
  }

  return storageValue;
}

export function readStoredAIChatComposerSuggestionsEnabled(): boolean {
  const storage = getBrowserStorage();
  const storedValue = storage.getItem(AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY);
  if (storedValue === null) {
    return true;
  }

  if (storedValue === "true") {
    return true;
  }

  if (storedValue === "false") {
    return false;
  }

  storage.removeItem(AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY);
  return true;
}

export function persistAIChatComposerSuggestionsEnabled(nextValue: boolean): void {
  getBrowserStorage().setItem(AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY, String(nextValue));
}
