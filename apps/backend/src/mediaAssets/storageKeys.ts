export function buildMediaAssetStorageKey(
  workspaceId: string,
  mediaAssetId: string,
  sha256: string,
): string {
  const canonicalWorkspaceId = workspaceId.toLowerCase();
  return [
    "media-assets",
    "workspaces",
    canonicalWorkspaceId,
    "assets",
    mediaAssetId,
    sha256,
  ].join("/");
}
