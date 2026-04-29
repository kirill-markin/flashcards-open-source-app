import { useEffect, useState, type KeyboardEvent } from "react";
import type { ChatComposerAction } from "./sessionController/runState";

const MOBILE_CHAT_BREAKPOINT_QUERY = "(max-width: 768px)";

type UseChatComposerKeyboardParams = Readonly<{
  composerAction: ChatComposerAction;
  sendPendingMessage: () => Promise<void>;
  stopMessage: () => Promise<void>;
}>;

export type ChatComposerKeyboard = Readonly<{
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  isMobileChatLayout: boolean;
}>;

function matchesMobileChatBreakpoint(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(MOBILE_CHAT_BREAKPOINT_QUERY).matches;
}

export function useChatComposerKeyboard(params: UseChatComposerKeyboardParams): ChatComposerKeyboard {
  const {
    composerAction,
    sendPendingMessage,
    stopMessage,
  } = params;
  const [isMobileChatLayout, setIsMobileChatLayout] = useState<boolean>(matchesMobileChatBreakpoint);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia(MOBILE_CHAT_BREAKPOINT_QUERY);
    const handleChange = (event: MediaQueryListEvent): void => {
      setIsMobileChatLayout(event.matches);
    };

    setIsMobileChatLayout(mediaQueryList.matches);
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter") {
      return;
    }

    if (isMobileChatLayout || event.shiftKey || event.repeat) {
      return;
    }

    event.preventDefault();

    if (composerAction === "stop") {
      void stopMessage();
      return;
    }

    void sendPendingMessage();
  }

  return {
    handleKeyDown,
    isMobileChatLayout,
  };
}
