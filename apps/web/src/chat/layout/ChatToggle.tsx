import type { ReactElement } from "react";
import { useChatLayout } from "./ChatLayoutContext";

export function ChatToggle(): ReactElement {
  const { setIsOpen } = useChatLayout();

  return (
    <button
      type="button"
      className="chat-toggle-floating"
      onClick={() => setIsOpen(true)}
    >
      AI chat
    </button>
  );
}
