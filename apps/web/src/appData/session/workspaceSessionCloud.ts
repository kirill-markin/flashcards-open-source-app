import { getStableInstallationId } from "../../clientIdentity";
import type { LocalBrowserDataCleanupReason } from "../../accountDeletion";
import type { CloudSettings, SessionInfo } from "../../types";

export function buildLinkingReadyCloudSettings(session: SessionInfo): CloudSettings {
  return {
    installationId: getStableInstallationId(),
    cloudState: "linking-ready",
    linkedUserId: session.userId,
    linkedWorkspaceId: null,
    linkedEmail: session.profile.email,
    onboardingCompleted: session.selectedWorkspaceId !== null,
    updatedAt: new Date().toISOString(),
  };
}

export function buildLinkedCloudSettings(session: SessionInfo, workspaceId: string): CloudSettings {
  return {
    installationId: getStableInstallationId(),
    cloudState: "linked",
    linkedUserId: session.userId,
    linkedWorkspaceId: workspaceId,
    linkedEmail: session.profile.email,
    onboardingCompleted: true,
    updatedAt: new Date().toISOString(),
  };
}

export function resolveLocalDataCleanupReasonForVerifiedSession(
  persistedCloudSettings: CloudSettings | null,
  currentSession: SessionInfo,
  wasBrowserReauthRequired: boolean,
): LocalBrowserDataCleanupReason | null {
  if (persistedCloudSettings === null) {
    return wasBrowserReauthRequired ? "reauth_owner_unknown" : null;
  }

  if (persistedCloudSettings.linkedUserId === currentSession.userId) {
    return null;
  }

  if (persistedCloudSettings.linkedUserId === null) {
    return wasBrowserReauthRequired ? "reauth_owner_unknown" : null;
  }

  return "confirmed_account_switch";
}

export function shouldClearLocalDataForVerifiedSession(
  persistedCloudSettings: CloudSettings | null,
  currentSession: SessionInfo,
  wasBrowserReauthRequired: boolean,
): boolean {
  return resolveLocalDataCleanupReasonForVerifiedSession(
    persistedCloudSettings,
    currentSession,
    wasBrowserReauthRequired,
  ) !== null;
}
