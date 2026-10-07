import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useCanCustomizeStyle } from "../../premium/styleSettings";
import {
  AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY,
  persistAIChatComposerSuggestionsEnabled,
  readStoredAIChatComposerSuggestionsEnabled,
} from "./aiChatPreferencesStorage";

const aiChatPreferencesChangeEventName = "flashcards-ai-chat-preferences-change";

type AIChatPreferencesContextValue = Readonly<{
  /** Effective value: the stored choice applies only while style settings are customizable. */
  aiChatComposerSuggestionsEnabled: boolean;
  setAIChatComposerSuggestionsEnabled: (nextValue: boolean) => void;
}>;

type AIChatPreferencesProviderProps = Readonly<{
  children: ReactNode;
}>;

type AIChatPreferencesListener = () => void;

const AIChatPreferencesContext = createContext<AIChatPreferencesContextValue | null>(null);

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
  const [storedAIChatComposerSuggestionsEnabled, setAIChatComposerSuggestionsEnabledState] = useState<boolean>(() => (
    readStoredAIChatComposerSuggestionsEnabled()
  ));
  const canCustomizeStyle = useCanCustomizeStyle();

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
        aiChatComposerSuggestionsEnabled: !canCustomizeStyle || storedAIChatComposerSuggestionsEnabled,
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
