import { createHash } from "node:crypto";

export function buildMediaBlobStorageKey(sha256: string): string {
  const canonicalSha256 = sha256.toLowerCase();
  return [
    "media",
    "blobs",
    "sha256",
    canonicalSha256.slice(0, 2),
    canonicalSha256.slice(2, 4),
    canonicalSha256,
  ].join("/");
}

export function buildMediaUploadStagingStorageKey(
  workspaceId: string,
  mediaAssetId: string,
  lastOperationId: string,
): string {
  const lastOperationIdSha256 = createHash("sha256").update(lastOperationId).digest("hex");
  return [
    "media",
    "uploads",
    "workspaces",
    workspaceId.toLowerCase(),
    "assets",
    mediaAssetId.toLowerCase(),
    "operations",
    lastOperationIdSha256,
  ].join("/");
}
