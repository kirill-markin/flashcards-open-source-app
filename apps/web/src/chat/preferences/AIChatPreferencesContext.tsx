import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";

export const AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY = "flashcards-ai-chat-composer-suggestions-enabled";

const aiChatPreferencesChangeEventName = "flashcards-ai-chat-preferences-change";

type AIChatPreferencesContextValue = Readonly<{
  aiChatComposerSuggestionsEnabled: boolean;
  setAIChatComposerSuggestionsEnabled: (nextValue: boolean) => void;
}>;

type AIChatPreferencesProviderProps = Readonly<{
  children: ReactNode;
}>;

type AIChatPreferencesListener = () => void;

const AIChatPreferencesContext = createContext<AIChatPreferencesContextValue | null>(null);

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

function persistAIChatComposerSuggestionsEnabled(nextValue: boolean): void {
  getBrowserStorage().setItem(AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY, String(nextValue));
}

function dispatchAIChatPreferencesChange(): void {
  window.dispatchEvent(new Event(aiChatPreferencesChangeEventName));
}

function subscribeToAIChatPreferences(listener: AIChatPreferencesListener): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key === AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY || event.key === null) {
      listener();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(aiChatPreferencesChangeEventName, listener);

  return (): void => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(aiChatPreferencesChangeEventName, listener);
  };
}

export function AIChatPreferencesProvider(props: AIChatPreferencesProviderProps): ReactElement {
  const { children } = props;
  const [aiChatComposerSuggestionsEnabled, setAIChatComposerSuggestionsEnabledState] = useState<boolean>(() => (
    readStoredAIChatComposerSuggestionsEnabled()
  ));

  useEffect(() => subscribeToAIChatPreferences(() => {
    setAIChatComposerSuggestionsEnabledState(readStoredAIChatComposerSuggestionsEnabled());
  }), []);

  function setAIChatComposerSuggestionsEnabled(nextValue: boolean): void {
    persistAIChatComposerSuggestionsEnabled(nextValue);
    setAIChatComposerSuggestionsEnabledState(nextValue);
    dispatchAIChatPreferencesChange();
  }

  return (
    <AIChatPreferencesContext.Provider
      value={{
        aiChatComposerSuggestionsEnabled,
        setAIChatComposerSuggestionsEnabled,
      }}
    >
      {children}
    </AIChatPreferencesContext.Provider>
  );
}

export function useAIChatPreferences(): AIChatPreferencesContextValue {
  const contextValue = useContext(AIChatPreferencesContext);
  if (contextValue === null) {
    throw new Error("useAIChatPreferences must be used within AIChatPreferencesProvider");
  }

  return contextValue;
}
