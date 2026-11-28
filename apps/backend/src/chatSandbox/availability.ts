import { isStandaloneDeployment } from "../deployment/standalone";

/**
 * The sandbox is the isolated chat-sandbox Lambda, which standalone does not have. Its work never runs
 * in the API process instead, because that process holds the database credentials.
 */
export function isChatSandboxAvailable(): boolean {
  return !isStandaloneDeployment();
}

export const chatSandboxUnavailableReason = "this self-hosted server has no sandbox to convert files or run code";
