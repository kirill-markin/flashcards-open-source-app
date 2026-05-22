import { loadCloudSettings } from "../../localDb/cloudSettings";
import type { CloudSettings } from "../../types";

export function requireCloudInstallationId(cloudSettings: CloudSettings | null): string {
  if (cloudSettings === null) {
    throw new Error("Cloud settings are not loaded");
  }

  if (cloudSettings.installationId.trim() === "") {
    throw new Error("Cloud settings installationId is not loaded");
  }

  return cloudSettings.installationId;
}

export async function loadRequiredCloudInstallationId(): Promise<string> {
  return requireCloudInstallationId(await loadCloudSettings());
}
