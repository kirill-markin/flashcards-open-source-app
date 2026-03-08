import { randomUUID } from "node:crypto";
import { HttpError } from "./errors";
import { transaction } from "./db";

export type WebDevice = Readonly<{
  deviceId: string;
}>;

export type SyncDevicePlatform = "ios" | "android" | "web";

type WebDeviceRow = Readonly<{
  device_id: string;
}>;

type SyncDeviceRow = Readonly<{
  workspace_id: string;
  user_id: string;
  platform: SyncDevicePlatform;
}>;

type DatabaseError = Error & {
  code?: string;
};

export async function ensureWebDevice(workspaceId: string, userId: string): Promise<WebDevice> {
  return transaction(async (executor) => {
    const existing = await executor.query<WebDeviceRow>(
      [
        "SELECT device_id",
        "FROM sync.devices",
        "WHERE workspace_id = $1 AND user_id = $2 AND platform = 'web'",
        "ORDER BY created_at ASC",
        "LIMIT 1",
        "FOR UPDATE",
      ].join(" "),
      [workspaceId, userId],
    );

    const currentDevice = existing.rows[0];
    if (currentDevice !== undefined) {
      await executor.query(
        "UPDATE sync.devices SET last_seen_at = now() WHERE device_id = $1",
        [currentDevice.device_id],
      );
      return { deviceId: currentDevice.device_id };
    }

    const deviceId = randomUUID();

    try {
      await executor.query(
        [
          "INSERT INTO sync.devices",
          "(device_id, workspace_id, user_id, platform, app_version)",
          "VALUES ($1, $2, $3, 'web', $4)",
        ].join(" "),
        [deviceId, workspaceId, userId, "web-mvp"],
      );
      return { deviceId };
    } catch (error) {
      const databaseError = error as DatabaseError;
      if (databaseError.code !== "23505") {
        throw error;
      }
    }

    const concurrentDevice = await executor.query<WebDeviceRow>(
      [
        "SELECT device_id",
        "FROM sync.devices",
        "WHERE workspace_id = $1 AND user_id = $2 AND platform = 'web'",
        "ORDER BY created_at ASC",
        "LIMIT 1",
        "FOR UPDATE",
      ].join(" "),
      [workspaceId, userId],
    );

    const row = concurrentDevice.rows[0];
    if (row === undefined) {
      throw new Error("Web device insert failed without an existing replacement row");
    }

    await executor.query(
      "UPDATE sync.devices SET last_seen_at = now() WHERE device_id = $1",
      [row.device_id],
    );

    return { deviceId: row.device_id };
  });
}

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

    await executor.query(
      [
        "INSERT INTO sync.devices",
        "(device_id, workspace_id, user_id, platform, app_version, last_seen_at)",
        "VALUES ($1, $2, $3, $4, $5, now())",
      ].join(" "),
      [deviceId, workspaceId, userId, platform, appVersion],
    );
  });
}
