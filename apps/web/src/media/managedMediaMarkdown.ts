const MANAGED_MEDIA_URL_PREFIX = "fcasset:";

export type ManagedImageMarkdownInput = Readonly<{
  mediaAssetId: string;
  altText: string;
}>;

export type ManagedMediaMarkdownReference = Readonly<{
  mediaAssetId: string;
  altText: string;
  markdown: string;
  startIndex: number;
  endIndex: number;
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

function unescapeMarkdownImageAltText(altText: string): string {
  return altText.replace(/\\([\\\]])/g, "$1");
}

export function parseManagedMediaAssetId(url: string | null | undefined): string | null {
  if (url === null || url === undefined) {
    return null;
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.toLowerCase().startsWith(MANAGED_MEDIA_URL_PREFIX) === false) {
    return null;
  }

  const rawReference = trimmedUrl.slice(MANAGED_MEDIA_URL_PREFIX.length).replace(/^\/+/, "");
  const mediaAssetId = rawReference.split(/[?#]/, 1)[0]?.trim() ?? "";
  return mediaAssetId === "" ? null : mediaAssetId;
}

export function parseManagedImageMarkdownReferences(text: string): ReadonlyArray<ManagedMediaMarkdownReference> {
  const references: Array<ManagedMediaMarkdownReference> = [];
  const pattern = /!\[((?:\\.|[^\]\\])*)\]\((fcasset:[^)]+)\)/gi;

  for (const match of text.matchAll(pattern)) {
    const markdown = match[0];
    const rawAltText = match[1];
    const mediaUrl = match[2];
    if (match.index === undefined || rawAltText === undefined || mediaUrl === undefined) {
      throw new Error("Managed media Markdown parser returned an incomplete image match");
    }

    const mediaAssetId = parseManagedMediaAssetId(mediaUrl);
    if (mediaAssetId === null) {
      continue;
    }

    references.push({
      mediaAssetId,
      altText: unescapeMarkdownImageAltText(rawAltText),
      markdown,
      startIndex: match.index,
      endIndex: match.index + markdown.length,
    });
  }

  return references;
}

export function buildManagedImageMarkdown(input: ManagedImageMarkdownInput): string {
  const mediaAssetId = requireMediaAssetId(input.mediaAssetId);
  return `![${escapeMarkdownImageAltText(input.altText)}](${MANAGED_MEDIA_URL_PREFIX}${mediaAssetId})`;
}
