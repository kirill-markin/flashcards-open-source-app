import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

type ChatLayoutContextValue = Readonly<{
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  chatWidth: number;
  setChatWidth: (width: number) => void;
}>;

const CHAT_OPEN_KEY = "flashcards-chat-open";
const CHAT_WIDTH_KEY = "flashcards-chat-width";
const MOBILE_CHAT_BREAKPOINT_QUERY = "(max-width: 768px)";
const DEFAULT_CHAT_WIDTH = 560;
const MIN_CHAT_WIDTH = 320;
const MAX_CHAT_WIDTH = 600;

const ChatLayoutContext = createContext<ChatLayoutContextValue | null>(null);

function readInitialChatOpen(): boolean {
  const storedValue = localStorage.getItem(CHAT_OPEN_KEY);
  if (storedValue === null) {
    return !window.matchMedia(MOBILE_CHAT_BREAKPOINT_QUERY).matches;
  }

  return storedValue === "true";
}

function readStoredNumber(key: string, fallbackValue: number): number {
  const storedValue = localStorage.getItem(key);
  if (storedValue === null) {
    return fallbackValue;
  }

  const parsedValue = Number.parseInt(storedValue, 10);
  if (!Number.isFinite(parsedValue)) {
    return fallbackValue;
  }

  return Math.max(MIN_CHAT_WIDTH, Math.min(parsedValue, MAX_CHAT_WIDTH));
}

type Props = Readonly<{
  children: ReactNode;
}>;

export function ChatLayoutProvider(props: Props): ReactElement {
  const { children } = props;
  const [isOpen, setIsOpenState] = useState<boolean>(readInitialChatOpen);
  const [chatWidth, setChatWidthState] = useState<number>(() => readStoredNumber(CHAT_WIDTH_KEY, DEFAULT_CHAT_WIDTH));
  const hasExplicitOpenPreferenceRef = useRef<boolean>(localStorage.getItem(CHAT_OPEN_KEY) !== null);

  useEffect(() => {
    if (hasExplicitOpenPreferenceRef.current) {
      return;
    }

    const mediaQueryList = window.matchMedia(MOBILE_CHAT_BREAKPOINT_QUERY);
    const handleMediaQueryChange = (event: MediaQueryListEvent): void => {
      if (!hasExplicitOpenPreferenceRef.current) {
        setIsOpenState(!event.matches);
      }
    };

    mediaQueryList.addEventListener("change", handleMediaQueryChange);
    return () => mediaQueryList.removeEventListener("change", handleMediaQueryChange);
  }, []);

  function setIsOpen(open: boolean): void {
    hasExplicitOpenPreferenceRef.current = true;
    setIsOpenState(open);
    localStorage.setItem(CHAT_OPEN_KEY, String(open));
  }

  function setChatWidth(width: number): void {
    const roundedWidth = Math.max(MIN_CHAT_WIDTH, Math.min(Math.round(width), MAX_CHAT_WIDTH));
    setChatWidthState(roundedWidth);
    localStorage.setItem(CHAT_WIDTH_KEY, String(roundedWidth));
  }

  return (
    <ChatLayoutContext.Provider value={{ isOpen, setIsOpen, chatWidth, setChatWidth }}>
      {children}
    </ChatLayoutContext.Provider>
  );
}

export function useChatLayout(): ChatLayoutContextValue {
  const context = useContext(ChatLayoutContext);
  if (context === null) {
    throw new Error("useChatLayout must be used within ChatLayoutProvider");
  }

  return context;
}

export function useOptionalChatLayout(): ChatLayoutContextValue | null {
  return useContext(ChatLayoutContext);
}
