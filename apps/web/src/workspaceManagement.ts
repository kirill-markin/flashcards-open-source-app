import type { CloudSettings } from "./types";

export const workspaceManagementLockedBannerMessage: string = "Workspace changes are available only after you create an account.";

export function isWorkspaceManagementLocked(
  isSessionVerified: boolean,
  cloudSettings: CloudSettings | null,
): boolean {
  return isSessionVerified === false || cloudSettings?.cloudState !== "linked";
}
