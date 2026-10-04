import { useEffect, type Dispatch, type SetStateAction } from "react";
import { updateAccountPreferences } from "../../api";
import type { Locale } from "../../i18n";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import { readEntitlementIdentityGeneration } from "../../premium/entitlementStore";
import type { SessionInfo } from "../../types";
import type { SessionLoadState } from "../context/types";
import type { SessionVerificationState } from "./workspaceSessionTypes";

type AppLanguageSaveInput = Readonly<{
  locale: Locale;
  session: SessionInfo | null;
  sessionLoadState: SessionLoadState;
  sessionVerificationState: SessionVerificationState;
  setSession: Dispatch<SetStateAction<SessionInfo | null>>;
  workspaceId: string | null;
  installationId: string | null;
}>;

/**
 * Saves the interface language on screen to the signed-in account or guest whenever it differs from
 * the verified `/me` profile, so Stripe and leaderboard names follow the language the person uses.
 * A failure is only reported: the next language change or verified session tries again.
 */
export function useAppLanguageSave(input: AppLanguageSaveInput): void {
  const { locale, session, sessionLoadState, sessionVerificationState, setSession, workspaceId, installationId } = input;
  const userId = session?.userId ?? null;
  const profileLocale = session?.profile.locale ?? null;

  useEffect(() => {
    if (sessionLoadState !== "ready" || sessionVerificationState !== "verified" || userId === null
      || profileLocale === locale) {
      return;
    }

    const controller = new AbortController();
    const generation = readEntitlementIdentityGeneration();
    const isCurrentIdentity = (): boolean => controller.signal.aborted === false
      && generation === readEntitlementIdentityGeneration();

    updateAccountPreferences({ locale }, { userId, signal: controller.signal }).then(
      (): void => {
        if (isCurrentIdentity() === false) {
          return;
        }

        setSession((currentSession): SessionInfo | null => currentSession === null || currentSession.userId !== userId
          ? currentSession
          : { ...currentSession, profile: { ...currentSession.profile, locale } });
      },
      (error: unknown): void => {
        if (isCurrentIdentity() === false) {
          return;
        }

        captureAppOperationError(error, {
          feature: "settings",
          operation: "account_preferences_update",
          userId,
          workspaceId,
          installationId,
          entityId: null,
        });
      },
    );

    return (): void => {
      controller.abort();
    };
  }, [installationId, locale, profileLocale, sessionLoadState, sessionVerificationState, setSession, userId, workspaceId]);
}
