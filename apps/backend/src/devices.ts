import { HttpError } from "./errors";
import { transactionWithWorkspaceScope, type DatabaseExecutor } from "./db";

export type SyncDevicePlatform = "ios" | "android" | "web";

type SyncDeviceRow = Readonly<{
  device_id: string;
  platform: SyncDevicePlatform;
}>;

/**
 * Registers or refreshes a sync device without ever transferring ownership to
 * another user. A reused device id must stay on the same platform and user.
 */
export async function ensureSyncDeviceInExecutor(
  executor: DatabaseExecutor,
  workspaceId: string,
  userId: string,
  deviceId: string,
  platform: SyncDevicePlatform,
  appVersion: string | null,
): Promise<void> {
  const insertResult = await executor.query<SyncDeviceRow>(
    [
      "INSERT INTO sync.devices",
      "(device_id, workspace_id, user_id, platform, app_version, last_seen_at)",
      "VALUES ($1, $2, $3, $4, $5, now())",
      "ON CONFLICT (device_id) DO NOTHING",
      "RETURNING device_id, platform",
    ].join(" "),
    [deviceId, workspaceId, userId, platform, appVersion],
  );

  if (insertResult.rows.length === 1) {
    return;
  }

  const updateResult = await executor.query<SyncDeviceRow>(
    [
      "UPDATE sync.devices",
      "SET workspace_id = $2,",
      "app_version = $5,",
      "last_seen_at = now()",
      "WHERE device_id = $1",
      "AND user_id = $3",
      "AND platform = $4",
      "RETURNING device_id, platform",
    ].join(" "),
    [deviceId, workspaceId, userId, platform, appVersion],
  );

  if (updateResult.rows.length === 1) {
    return;
  }

  const visibleDeviceResult = await executor.query<SyncDeviceRow>(
    [
      "SELECT device_id, platform",
      "FROM sync.devices",
      "WHERE device_id = $1",
    ].join(" "),
    [deviceId],
  );

  if (visibleDeviceResult.rows.length === 1) {
    throw new HttpError(
      409,
      "deviceId is already registered with a different platform",
      "SYNC_DEVICE_PLATFORM_MISMATCH",
    );
  }

  throw new HttpError(
    409,
    "deviceId is already owned by another user",
    "SYNC_DEVICE_OWNED_BY_ANOTHER_USER",
  );
}

/**
 * Applies workspace scope and then enforces immutable sync-device ownership for
 * the authenticated user inside that scoped transaction.
 */
export async function ensureSyncDevice(
  workspaceId: string,
  userId: string,
  deviceId: string,
  platform: SyncDevicePlatform,
  appVersion: string | null,
): Promise<void> {
  await transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    await ensureSyncDeviceInExecutor(executor, workspaceId, userId, deviceId, platform, appVersion);
  });
}
