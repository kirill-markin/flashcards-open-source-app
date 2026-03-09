import { HttpError } from "./errors";
import { transaction } from "./db";

export type SyncDevicePlatform = "ios" | "android" | "web";

type SyncDeviceRow = Readonly<{
  workspace_id: string;
  user_id: string;
  platform: SyncDevicePlatform;
}>;

type DatabaseError = Error & {
  code?: string;
};

export async function ensureSyncDevice(
  workspaceId: string,
  userId: string,
  deviceId: string,
  platform: SyncDevicePlatform,
  appVersion: string | null,
): Promise<void> {
  return transaction(async (executor) => {
    const existing = await executor.query<SyncDeviceRow>(
      [
        "SELECT workspace_id, user_id, platform",
        "FROM sync.devices",
        "WHERE device_id = $1",
        "FOR UPDATE",
      ].join(" "),
      [deviceId],
    );

    const currentDevice = existing.rows[0];
    if (currentDevice !== undefined) {
      if (
        currentDevice.workspace_id !== workspaceId
        || currentDevice.user_id !== userId
        || currentDevice.platform !== platform
      ) {
        throw new HttpError(409, "deviceId is already registered with a different workspace, user, or platform");
      }

      await executor.query(
        "UPDATE sync.devices SET app_version = $1, last_seen_at = now() WHERE device_id = $2",
        [appVersion, deviceId],
      );
      return;
    }

    try {
      await executor.query(
        [
          "INSERT INTO sync.devices",
          "(device_id, workspace_id, user_id, platform, app_version, last_seen_at)",
          "VALUES ($1, $2, $3, $4, $5, now())",
        ].join(" "),
        [deviceId, workspaceId, userId, platform, appVersion],
      );
      return;
    } catch (error) {
      const databaseError = error as DatabaseError;
      if (databaseError.code !== "23505") {
        throw error;
      }
    }

    const concurrentDevice = await executor.query<SyncDeviceRow>(
      [
        "SELECT workspace_id, user_id, platform",
        "FROM sync.devices",
        "WHERE device_id = $1",
        "FOR UPDATE",
      ].join(" "),
      [deviceId],
    );

    const row = concurrentDevice.rows[0];
    if (row === undefined) {
      throw new Error("Sync device insert failed without an existing replacement row");
    }

    if (
      row.workspace_id !== workspaceId
      || row.user_id !== userId
      || row.platform !== platform
    ) {
      throw new HttpError(409, "deviceId is already registered with a different workspace, user, or platform");
    }

    await executor.query(
      "UPDATE sync.devices SET app_version = $1, last_seen_at = now() WHERE device_id = $2",
      [appVersion, deviceId],
    );
  });
}
