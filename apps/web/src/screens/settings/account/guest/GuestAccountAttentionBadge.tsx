import type { ReactElement } from "react";
import { useAppData } from "../../../../appData";
import { useI18n } from "../../../../i18n";

export function GuestAccountAttentionBadge(): ReactElement | null {
  const { session } = useAppData();
  const { t } = useI18n();
  if (session?.browserGuestCapabilities?.isGuest !== true) return null;

  return (
    <span className="guest-attention" role="img" aria-label={t("guest.reminder")}>
      <span aria-hidden="true">1</span>
    </span>
  );
}
