/**
 * What the public catalog may deliver, and where the delivered object lives.
 *
 * The predicate and the object key belong together: the reconcile in
 * `distribution/public/mediaPublication.ts` publishes exactly the blobs this
 * predicate accepts, so a reader may only point at the CDN for an asset the
 * same predicate accepts. The builders live in this dependency-free module
 * rather than beside the reconcile so the read paths can address a published
 * object without importing the S3-dependent publication graph into the catalog
 * barrels.
 */

export const maximumPublicCatalogMediaDownloadBytes = 4_500_000;

/** Must stay in sync with the write grant in `infra/aws/lib/catalog-dump.ts`. */
export const catalogMediaObjectKeyPrefix = "catalog/media/";

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

const catalogMediaSha256Pattern = /^[0-9a-f]{64}$/u;

/**
 * A blob digest decides an object key, and therefore a public URL path segment,
 * so every builder call site holds the value to a plain digest first instead of
 * naming an object from whatever the row carried.
 */
export function isCatalogMediaSha256(value: string): boolean {
  return catalogMediaSha256Pattern.test(value);
}

/** Content-addressed key one public catalog media blob is published under. */
export function buildCatalogMediaObjectKey(sha256: string): string {
  return `${catalogMediaObjectKeyPrefix}${sha256.toLowerCase()}`;
}

/** Absolute CDN URL of one published public catalog media blob. */
export function buildCatalogMediaCdnUrl(cdnBaseUrl: string, sha256: string): string {
  const normalizedCdnBaseUrl = cdnBaseUrl.endsWith("/")
    ? cdnBaseUrl.slice(0, -1)
    : cdnBaseUrl;
  return `${normalizedCdnBaseUrl}/${buildCatalogMediaObjectKey(sha256)}`;
}
