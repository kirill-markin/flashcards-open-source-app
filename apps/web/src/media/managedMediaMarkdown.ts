const MANAGED_MEDIA_URL_PREFIX = "fcasset:";

export type ManagedImageMarkdownInput = Readonly<{
  mediaAssetId: string;
  altText: string;
}>;

function requireMediaAssetId(mediaAssetId: string): string {
  const trimmedMediaAssetId = mediaAssetId.trim();
  if (trimmedMediaAssetId === "") {
    throw new Error("Managed media Markdown requires a mediaAssetId");
  }

  return trimmedMediaAssetId;
}

function escapeMarkdownImageAltText(altText: string): string {
  return altText.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

export function buildManagedImageMarkdown(input: ManagedImageMarkdownInput): string {
  const mediaAssetId = requireMediaAssetId(input.mediaAssetId);
  return `![${escapeMarkdownImageAltText(input.altText)}](${MANAGED_MEDIA_URL_PREFIX}${mediaAssetId})`;
}
