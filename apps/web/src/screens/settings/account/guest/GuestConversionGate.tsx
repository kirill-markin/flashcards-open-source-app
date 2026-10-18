import { useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { AppDataProvider, useAppData } from "../../../../appData";
import { GuestCachedCardsRecovery } from "../../../../appData/session/guest/GuestCachedCardsRecovery";
import { readPendingGuestConversion, subscribeToBrowserGuestChanges } from "../../../../appData/session/guest/browserGuestStorage";
import { useI18n } from "../../../../i18n";
import { GuestConversionScreen } from "./GuestConversionScreen";

export function GuestConversionGate(props: Readonly<{ children: ReactNode; returnUrl: string }>): ReactElement {
  const { sessionLoadState, cloudSettings, sessionErrorMessage, sessionTechnicalError, initialize } = useAppData();
  const { t } = useI18n();
  const phase = useSyncExternalStore(subscribeToBrowserGuestChanges, () => readPendingGuestConversion()?.phase ?? null);
  if ((phase !== null && phase !== "draining") || sessionLoadState === "guest_conversion") {
    return <GuestConversionScreen returnUrl={props.returnUrl} />;
  }
  if (sessionLoadState === "guest_recovery" && cloudSettings?.linkedUserId !== null && cloudSettings?.linkedUserId !== undefined
    && cloudSettings.linkedWorkspaceId !== null) {
    return <GuestCachedCardsRecovery userId={cloudSettings.linkedUserId} workspaceId={cloudSettings.linkedWorkspaceId}
      errorMessage={sessionTechnicalError === null ? sessionErrorMessage : t("appError.technicalError.message")} retry={initialize} />;
  }
  return <>{props.children}</>;
}

export function PublicGuestAppDataProvider(props: Readonly<{ children: ReactNode }>): ReactElement {
  return <AppDataProvider>
    <GuestConversionGate returnUrl={window.location.href}>{props.children}</GuestConversionGate>
  </AppDataProvider>;
}
