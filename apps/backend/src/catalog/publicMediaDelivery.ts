export const maximumPublicCatalogMediaDownloadBytes = 4_500_000;

export const publicCatalogMediaDownloadMimeTypes = [
  "application/pdf",
  "audio/mpeg",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PublicCatalogMediaDeliveryInput = Readonly<{
  mimeType: string;
  sizeBytes: number;
}>;

export type PublicCatalogMediaDeliveryIssue =
  | Readonly<{ reason: "too_large" }>
  | Readonly<{ reason: "unsupported_mime_type" }>;

export function getPublicCatalogMediaDeliveryIssue(
  input: PublicCatalogMediaDeliveryInput,
): PublicCatalogMediaDeliveryIssue | null {
  if (input.sizeBytes > maximumPublicCatalogMediaDownloadBytes) {
    return { reason: "too_large" };
  }

  if (publicCatalogMediaDownloadMimeTypes.some((mimeType) => mimeType === input.mimeType) === false) {
    return { reason: "unsupported_mime_type" };
  }

  return null;
}

export function isPublicCatalogMediaDeliverable(
  input: PublicCatalogMediaDeliveryInput,
): boolean {
  return getPublicCatalogMediaDeliveryIssue(input) === null;
}
