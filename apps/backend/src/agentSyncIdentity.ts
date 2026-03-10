import { createHash } from "node:crypto";
import { ensureSyncDevice } from "./devices";

function toUuidFromSeed(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex");
  const baseHex = digest.slice(0, 32).split("");

  baseHex[12] = "5";
  baseHex[16] = ((parseInt(baseHex[16], 16) & 0x3) | 0x8).toString(16);

  return [
    baseHex.slice(0, 8).join(""),
    baseHex.slice(8, 12).join(""),
    baseHex.slice(12, 16).join(""),
    baseHex.slice(16, 20).join(""),
    baseHex.slice(20, 32).join(""),
  ].join("-");
}

/**
 * External AI-agent writes must still emit sync-aware metadata so first-party
 * clients observe them through the normal pull flow. The agent itself never
 * sees device ids; the backend deterministically derives one per
 * workspace/connection pair and keeps it registered in sync.devices.
 */
export async function ensureAgentSyncDevice(
  workspaceId: string,
  userId: string,
  connectionId: string,
): Promise<string> {
  const deviceId = toUuidFromSeed(`agent:${workspaceId}:${connectionId}`);
  await ensureSyncDevice(workspaceId, userId, deviceId, "web", `agent:${connectionId}`);
  return deviceId;
}
