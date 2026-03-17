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
 * Backend-executed AI chat writes must show up through the normal sync flow,
 * but they must not impersonate a real device or an external agent
 * connection. The backend derives a deterministic actor per
 * workspace/platform/chat-actor tuple and keeps it registered in sync.devices.
 */
export async function ensureAIChatSyncDevice(
  workspaceId: string,
  userId: string,
  devicePlatform: "ios" | "web",
): Promise<string> {
  const deviceId = toUuidFromSeed(`ai-chat:${workspaceId}:${devicePlatform}:chat`);
  await ensureSyncDevice(workspaceId, userId, deviceId, devicePlatform, `ai-chat:${devicePlatform}:chat`);
  return deviceId;
}
