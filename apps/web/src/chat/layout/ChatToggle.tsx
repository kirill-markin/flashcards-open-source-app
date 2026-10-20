import type { ReactElement } from "react";
import { useI18n } from "../../i18n";
import { useChatLayout } from "./ChatLayoutContext";

export function ChatToggle(): ReactElement {
  const { setIsOpen } = useChatLayout();
  const { t } = useI18n();

  return (
    <button
      type="button"
      className="chat-toggle-floating"
      onClick={() => setIsOpen(true)}
    >
      {t("navigation.aiChat")}
    </button>
  );
}
