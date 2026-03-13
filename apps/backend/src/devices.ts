import { HttpError } from "./errors";
import { queryWithWorkspaceScope } from "./db";

export type SyncDevicePlatform = "ios" | "android" | "web";

type SyncDeviceUpsertRow = Readonly<{
  device_id: string;
}>;

export async function ensureSyncDevice(
  workspaceId: string,
  userId: string,
  deviceId: string,
  platform: SyncDevicePlatform,
  appVersion: string | null,
): Promise<void> {
  const result = await queryWithWorkspaceScope<SyncDeviceUpsertRow>(
    { userId, workspaceId },
    [
      "INSERT INTO sync.devices",
      "(device_id, workspace_id, user_id, platform, app_version, last_seen_at)",
      "VALUES ($1, $2, $3, $4, $5, now())",
      "ON CONFLICT (device_id) DO UPDATE",
      "SET workspace_id = EXCLUDED.workspace_id,",
      "user_id = EXCLUDED.user_id,",
      "app_version = EXCLUDED.app_version,",
      "last_seen_at = now()",
      "WHERE sync.devices.platform = EXCLUDED.platform",
      "RETURNING device_id",
    ].join(" "),
    [deviceId, workspaceId, userId, platform, appVersion],
  );

  if (result.rows.length !== 1) {
    throw new HttpError(409, "deviceId is already registered with a different platform");
  }
}
