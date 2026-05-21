import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";

export const TEST_MODE_STORAGE_KEY = "flashcards-test-mode-enabled";

const testModeChangeEventName = "flashcards-test-mode-change";

type TestModeContextValue = Readonly<{
  isTestModeEnabled: boolean;
  setTestModeEnabled: (nextValue: boolean) => void;
  toggleTestMode: () => boolean;
}>;

type TestModeProviderProps = Readonly<{
  children: ReactNode;
}>;

type TestModeListener = () => void;

const TestModeContext = createContext<TestModeContextValue | null>(null);

function getBrowserStorage(): Storage {
  const storageValue = window.localStorage;
  if (
    typeof storageValue?.getItem !== "function"
    || typeof storageValue.setItem !== "function"
    || typeof storageValue.removeItem !== "function"
  ) {
    throw new Error("Browser localStorage is required for Web test mode.");
  }

  return storageValue;
}

export function readStoredTestModeEnabled(): boolean {
  const storage = getBrowserStorage();
  const storedValue = storage.getItem(TEST_MODE_STORAGE_KEY);
  if (storedValue === null) {
    return false;
  }

  if (storedValue === "true") {
    return true;
  }

  if (storedValue === "false") {
    return false;
  }

  storage.removeItem(TEST_MODE_STORAGE_KEY);
  return false;
}

function persistTestModeEnabled(nextValue: boolean): void {
  getBrowserStorage().setItem(TEST_MODE_STORAGE_KEY, String(nextValue));
}

function dispatchTestModeChange(): void {
  window.dispatchEvent(new Event(testModeChangeEventName));
}

function subscribeToTestMode(listener: TestModeListener): () => void {
  const handleStorage = (event: StorageEvent): void => {
    if (event.key === TEST_MODE_STORAGE_KEY || event.key === null) {
      listener();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(testModeChangeEventName, listener);

  return (): void => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(testModeChangeEventName, listener);
  };
}

export function TestModeProvider(props: TestModeProviderProps): ReactElement {
  const { children } = props;
  const [isTestModeEnabled, setIsTestModeEnabled] = useState<boolean>(() => readStoredTestModeEnabled());

  useEffect(() => subscribeToTestMode(() => {
    setIsTestModeEnabled(readStoredTestModeEnabled());
  }), []);

  function setTestModeEnabled(nextValue: boolean): void {
    persistTestModeEnabled(nextValue);
    setIsTestModeEnabled(nextValue);
    dispatchTestModeChange();
  }

  function toggleTestMode(): boolean {
    const nextValue = isTestModeEnabled === false;
    setTestModeEnabled(nextValue);
    return nextValue;
  }

  return (
    <TestModeContext.Provider
      value={{
        isTestModeEnabled,
        setTestModeEnabled,
        toggleTestMode,
      }}
    >
      {children}
    </TestModeContext.Provider>
  );
}

export function useTestMode(): TestModeContextValue {
  const contextValue = useContext(TestModeContext);
  if (contextValue === null) {
    throw new Error("useTestMode must be used within TestModeProvider");
  }

  return contextValue;
}
