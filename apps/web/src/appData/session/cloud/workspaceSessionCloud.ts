import { getStableInstallationId } from "../../../clientIdentity";
import type { LocalBrowserDataCleanupReason } from "../../../accountDeletion";
import type { CloudSettings, SessionInfo } from "../../../types";
import { projectSessionToLocalOwner } from "../../../api/transport/sessionIdentity";

export function buildLinkingReadyCloudSettings(
  session: SessionInfo,
  persistedCloudSettings: CloudSettings | null,
): CloudSettings {
  const localSession = projectSessionToLocalOwner(session, persistedCloudSettings?.linkedUserId ?? null);
  const sameOwnerSettings = persistedCloudSettings?.linkedUserId === localSession.userId
    ? persistedCloudSettings
    : null;
  return {
    installationId: sameOwnerSettings?.installationId ?? getStableInstallationId(),
    cloudState: "linking-ready",
    linkedUserId: localSession.userId,
    linkedWorkspaceId: sameOwnerSettings?.linkedWorkspaceId ?? null,
    linkedEmail: session.profile.email,
    onboardingCompleted: session.selectedWorkspaceId !== null,
    updatedAt: new Date().toISOString(),
  };
}

export function buildLinkedCloudSettings(
  session: SessionInfo,
  workspaceId: string,
  persistedCloudSettings: CloudSettings | null,
): CloudSettings {
  const localSession = projectSessionToLocalOwner(session, persistedCloudSettings?.linkedUserId ?? null);
  return {
    installationId: persistedCloudSettings?.linkedUserId === localSession.userId
      ? persistedCloudSettings.installationId
      : getStableInstallationId(),
    cloudState: "linked",
    linkedUserId: localSession.userId,
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

  const localSession = projectSessionToLocalOwner(currentSession, persistedCloudSettings.linkedUserId);
  if (persistedCloudSettings.linkedUserId === localSession.userId) {
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
