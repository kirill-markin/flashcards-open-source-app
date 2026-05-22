import { getStableInstallationId } from "../../clientIdentity";
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

export function shouldClearLocalDataForVerifiedSession(
  persistedCloudSettings: CloudSettings | null,
  currentSession: SessionInfo,
  wasBrowserReauthRequired: boolean,
): boolean {
  if (persistedCloudSettings === null) {
    return wasBrowserReauthRequired;
  }

  if (persistedCloudSettings.linkedUserId === currentSession.userId) {
    return false;
  }

  if (persistedCloudSettings.linkedUserId === null) {
    return wasBrowserReauthRequired;
  }

  return true;
}
