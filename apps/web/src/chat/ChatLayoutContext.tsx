import { createContext, useContext, useState, type ReactElement, type ReactNode } from "react";

type ChatLayoutContextValue = Readonly<{
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  chatWidth: number;
  setChatWidth: (width: number) => void;
}>;

const CHAT_OPEN_KEY = "flashcards-chat-open";
const CHAT_WIDTH_KEY = "flashcards-chat-width";

const ChatLayoutContext = createContext<ChatLayoutContextValue | null>(null);

function readStoredBoolean(key: string, fallbackValue: boolean): boolean {
  const storedValue = localStorage.getItem(key);
  if (storedValue === null) {
    return fallbackValue;
  }

  return storedValue === "true";
}

function readStoredNumber(key: string, fallbackValue: number): number {
  const storedValue = localStorage.getItem(key);
  if (storedValue === null) {
    return fallbackValue;
  }

  const parsedValue = Number.parseInt(storedValue, 10);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
}

type Props = Readonly<{
  children: ReactNode;
}>;

export function ChatLayoutProvider(props: Props): ReactElement {
  const { children } = props;
  const [isOpen, setIsOpenState] = useState<boolean>(() => readStoredBoolean(CHAT_OPEN_KEY, false));
  const [chatWidth, setChatWidthState] = useState<number>(() => readStoredNumber(CHAT_WIDTH_KEY, 360));

  function setIsOpen(open: boolean): void {
    setIsOpenState(open);
    localStorage.setItem(CHAT_OPEN_KEY, String(open));
  }

  function setChatWidth(width: number): void {
    const roundedWidth = Math.round(width);
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
