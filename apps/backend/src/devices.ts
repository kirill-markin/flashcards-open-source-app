import { randomUUID } from "node:crypto";
import { transaction } from "./db";

export type WebDevice = Readonly<{
  deviceId: string;
}>;

type WebDeviceRow = Readonly<{
  device_id: string;
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
