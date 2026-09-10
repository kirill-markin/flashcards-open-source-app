// Not the `../workspacePackages` barrel: it pulls the image ingestion graph, which
// resolves `sharp` at load time, into every bundle reaching the public catalog snapshot.
import {
  extractMarkdownLinkDestinationUrls,
  extractMarkdownNonCodeTextSegments,
  isMarkdownComplexityLimitError,
} from "../workspacePackages/markdownMedia";
import {
  containsUnsafePublicPackageMediaReference,
  isUnsafePublicPackageMediaKey,
  isUnsafePublicPackageMediaDestination,
} from "./common";
import { getCatalogCardRequiredPackageMediaKeys } from "./cardMedia";
import { getPublicCatalogMediaDeliveryIssue } from "./publicMediaDelivery";

export type PublicCatalogAuthorEligibilityInput = Readonly<{
  slug: string;
  displayName: string;
  bio: string | null;
  websiteUrl: string | null;
}>;

export type PublicCatalogAuthorEligibilityIssue =
  | Readonly<{
    reason: "unsafe_author_field";
    field: "slug" | "displayName" | "bio" | "websiteUrl";
  }>
  | Readonly<{
    reason: "invalid_author_website_url";
  }>;

export type PublicCatalogPackageEligibilityInput = Readonly<{
  slug: string;
}>;

export type PublicCatalogPackageEligibilityIssue = Readonly<{
  reason: "unsafe_package_field";
  field: "slug";
}>;

export type PublicCatalogEducationalAlignmentInput = Readonly<{
  educationalSubject: string;
  educationalFramework: string | null;
  educationalLevel: string | null;
}>;

export type PublicCatalogEducationalAlignmentIssue = Readonly<{
  reason: "unsafe_alignment_field" | "unpresentable_alignment_field";
  field: "educationalSubject" | "educationalFramework" | "educationalLevel";
}>;

export type PublicCatalogVersionPresentationInput = Readonly<{
  slug: string;
  title: string;
  summary: string;
  description: string;
  languageTags: ReadonlyArray<string>;
  educationalSubject: string | null;
  educationalFramework: string | null;
  educationalLevel: string | null;
  license: string;
  contentWarning: string | null;
  coverPackageMediaKey: string | null;
}>;

export type PublicCatalogVersionCardInput = Readonly<{
  packageCardId: string;
  frontText: string;
  backText: string;
  cardType: string;
  tags: ReadonlyArray<string>;
  mediaAssetKeys: ReadonlyArray<string>;
}>;

export type PublicCatalogVersionMediaAssetInput = Readonly<{
  packageMediaKey: string;
  altText: string | null;
  credit: string | null;
  license: string | null;
  mimeType: string;
  sizeBytes: string | number;
}>;

export type PublicCatalogVersionEligibilityInput = Readonly<{
  package: PublicCatalogPackageEligibilityInput;
  author: PublicCatalogAuthorEligibilityInput;
  version: PublicCatalogVersionPresentationInput;
  cards: ReadonlyArray<PublicCatalogVersionCardInput>;
  mediaAssets: ReadonlyArray<PublicCatalogVersionMediaAssetInput>;
}>;

export type PublicCatalogVersionEligibilityIssue =
  | PublicCatalogPackageEligibilityIssue
  | PublicCatalogAuthorEligibilityIssue
  | Readonly<{
    reason: "unsafe_version_field";
    field: "slug" | "title" | "summary" | "description" | "languageTags"
      | "educationalSubject" | "educationalFramework" | "educationalLevel"
      | "license" | "contentWarning";
  }>
  | Readonly<{
    reason: "unsafe_card_field";
    packageCardId: string;
    field: "frontText" | "backText" | "cardType" | "tags";
  }>
  | Readonly<{
    reason: "card_markdown_too_complex";
    packageCardId: string;
    field: "frontText" | "backText";
  }>
  | Readonly<{
    reason: "unsafe_media_asset_field";
    packageMediaKey: string;
    field: "altText" | "credit" | "license" | "mimeType";
  }>
  | Readonly<{
    reason: "unsafe_media_key";
    packageMediaKey: string;
  }>
  | Readonly<{
    reason: "media_too_large";
    packageMediaKey: string;
    mimeType: string;
    sizeBytes: number;
  }>
  | Readonly<{
    reason: "unsupported_media_type";
    packageMediaKey: string;
    mimeType: string;
    sizeBytes: number;
  }>
  | Readonly<{
    reason: "invalid_media_size";
    packageMediaKey: string;
    sizeBytes: string | number;
  }>
  | Readonly<{
    reason: "unresolved_media_reference";
    packageMediaKey: string;
    referenceSource: "cover" | `card:${string}`;
  }>;

export function isPublicCatalogTextSafe(value: string | null): boolean {
  return value === null || containsUnsafePublicPackageMediaReference(value) === false;
}

export function isPublicCatalogTextArraySafe(values: ReadonlyArray<string>): boolean {
  return values.every((value) => isPublicCatalogTextSafe(value));
}

/**
 * Format characters that survive `String.prototype.trim()`.
 *
 * The marketing website prints the three educational alignment values verbatim into a visible deck
 * page row and into the schema.org `educationalAlignment` target name, and decides presence on a
 * trimmed comparison, so a value made only of these renders an empty row instead of being dropped.
 * The set is exactly the one `0130_backfill_catalog_educational_alignment.sql` screened its values
 * against, but the API is strictly stricter than that backfill: 0130 checked padding with
 * `pg_catalog.btrim`, which strips spaces alone, and tested for no control character or line and
 * paragraph separator at all, so a value ending in a tab passed there and is refused here. The
 * eight are U+00AD SOFT HYPHEN, U+200B ZERO WIDTH SPACE, U+200C ZERO WIDTH NON-JOINER, U+200D ZERO
 * WIDTH JOINER, U+200E LEFT-TO-RIGHT MARK, U+200F RIGHT-TO-LEFT MARK, U+2060 WORD JOINER and
 * U+FEFF ZERO WIDTH NO-BREAK SPACE.
 */
const publicCatalogInvisibleCharacterPattern = /[\u00AD\u200B-\u200F\u2060\uFEFF]/u;

/**
 * Characters that break a line or a layout wherever the value is printed.
 *
 * Trimming catches padding at the ends only, so an interior newline, tab, U+2028 LINE SEPARATOR or
 * U+2029 PARAGRAPH SEPARATOR would reach the visible deck row and the schema.org
 * `educationalAlignment` target name verbatim. `\p{Cc}` is the C0 range U+0000-U+001F plus
 * U+007F-U+009F, which covers DEL and the C1 controls as well. Interior single spaces stay valid:
 * a multi-word value such as `College Board Advanced Placement` is the normal case, not an
 * accident. Every one of the 169 distinct alignment values in the published catalog is already
 * clean by this rule, so refusing them cannot leave an existing deck unfixable.
 */
const publicCatalogControlCharacterPattern = /[\p{Cc}\u2028\u2029]/u;

/**
 * Alignment values are stored in each deck's own audience language and are never trimmed, case
 * normalized or otherwise tidied, so padding is rejected here rather than silently repaired.
 */
function isPublicCatalogEducationalAlignmentValuePresentable(value: string | null): boolean {
  return value === null || (
    value !== ""
    && value === value.trim()
    && publicCatalogInvisibleCharacterPattern.test(value) === false
    && publicCatalogControlCharacterPattern.test(value) === false
  );
}

export function getPublicCatalogEducationalAlignmentIssue(
  alignment: PublicCatalogEducationalAlignmentInput,
): PublicCatalogEducationalAlignmentIssue | null {
  const alignmentFields = [
    ["educationalSubject", alignment.educationalSubject],
    ["educationalFramework", alignment.educationalFramework],
    ["educationalLevel", alignment.educationalLevel],
  ] as const;
  for (const [field, value] of alignmentFields) {
    if (isPublicCatalogEducationalAlignmentValuePresentable(value) === false) {
      return { reason: "unpresentable_alignment_field", field };
    }
    if (isPublicCatalogTextSafe(value) === false) {
      return { reason: "unsafe_alignment_field", field };
    }
  }

  return null;
}

export function isPublicCatalogCardMarkdownSafe(markdown: string): boolean {
  return extractMarkdownLinkDestinationUrls(markdown).every((destination) => (
    isUnsafePublicPackageMediaDestination(destination) === false
  )) && extractMarkdownNonCodeTextSegments(markdown).every((segment) => (
    containsUnsafePublicPackageMediaReference(segment) === false
  ));
}

export function isPublicCatalogAuthorWebsiteUrlValid(websiteUrl: string | null): boolean {
  if (websiteUrl === null) {
    return true;
  }

  if (
    websiteUrl.trim() !== websiteUrl
    || /^https?:\/\//iu.test(websiteUrl) === false
    || /%(?![0-9A-Fa-f]{2})/u.test(websiteUrl)
  ) {
    return false;
  }

  const authorityStart = websiteUrl.indexOf("://") + 3;
  const suffixOffset = websiteUrl.slice(authorityStart).search(/[/?#]/u);
  const authorityEnd = suffixOffset === -1
    ? websiteUrl.length
    : authorityStart + suffixOffset;
  const authority = websiteUrl.slice(authorityStart, authorityEnd);
  const suffix = websiteUrl.slice(authorityEnd);
  if (authority === "" || authority.includes("@") || authority.endsWith(":")) {
    return false;
  }

  const hasAuthorityBrackets = /[\[\]]/u.test(authority);
  const isIpv6Authority = /^\[[^\]]+\](?::[0-9]+)?$/u.test(authority);
  if (
    /[\[\]]/u.test(suffix)
    || (hasAuthorityBrackets && isIpv6Authority === false)
  ) {
    return false;
  }

  const uriWithoutIpv6Brackets = isIpv6Authority
    ? `${websiteUrl.slice(0, authorityStart)}${authority.replace(/[\[\]]/gu, "")}${suffix}`
    : websiteUrl;
  if (
    /^[A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]+$/u.test(uriWithoutIpv6Brackets) === false
  ) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(websiteUrl);
  } catch {
    return false;
  }

  return (url.protocol === "http:" || url.protocol === "https:")
    && url.username === ""
    && url.password === "";
}

export function getPublicCatalogPackageEligibilityIssue(
  catalogPackage: PublicCatalogPackageEligibilityInput,
): PublicCatalogPackageEligibilityIssue | null {
  return isPublicCatalogTextSafe(catalogPackage.slug)
    ? null
    : { reason: "unsafe_package_field", field: "slug" };
}

export function getPublicCatalogAuthorEligibilityIssue(
  author: PublicCatalogAuthorEligibilityInput,
): PublicCatalogAuthorEligibilityIssue | null {
  const textFields = [
    ["slug", author.slug],
    ["displayName", author.displayName],
    ["bio", author.bio],
    ["websiteUrl", author.websiteUrl],
  ] as const;
  for (const [field, value] of textFields) {
    if (isPublicCatalogTextSafe(value) === false) {
      return { reason: "unsafe_author_field", field };
    }
  }

  if (isPublicCatalogAuthorWebsiteUrlValid(author.websiteUrl) === false) {
    return { reason: "invalid_author_website_url" };
  }

  return null;
}

function getPublicCatalogVersionPresentationIssue(
  version: PublicCatalogVersionPresentationInput,
): PublicCatalogVersionEligibilityIssue | null {
  const textFields = [
    ["slug", version.slug],
    ["title", version.title],
    ["summary", version.summary],
    ["description", version.description],
    ["educationalSubject", version.educationalSubject],
    ["educationalFramework", version.educationalFramework],
    ["educationalLevel", version.educationalLevel],
    ["license", version.license],
    ["contentWarning", version.contentWarning],
  ] as const;
  for (const [field, value] of textFields) {
    if (isPublicCatalogTextSafe(value) === false) {
      return { reason: "unsafe_version_field", field };
    }
  }

  if (isPublicCatalogTextArraySafe(version.languageTags) === false) {
    return { reason: "unsafe_version_field", field: "languageTags" };
  }

  return null;
}

function getPublicCatalogVersionMediaAssetIssue(
  mediaAsset: PublicCatalogVersionMediaAssetInput,
): PublicCatalogVersionEligibilityIssue | null {
  if (isUnsafePublicPackageMediaKey(mediaAsset.packageMediaKey)) {
    return {
      reason: "unsafe_media_key",
      packageMediaKey: mediaAsset.packageMediaKey,
    };
  }

  const textFields = [
    ["altText", mediaAsset.altText],
    ["credit", mediaAsset.credit],
    ["license", mediaAsset.license],
    ["mimeType", mediaAsset.mimeType],
  ] as const;
  for (const [field, value] of textFields) {
    if (isPublicCatalogTextSafe(value) === false) {
      return {
        reason: "unsafe_media_asset_field",
        packageMediaKey: mediaAsset.packageMediaKey,
        field,
      };
    }
  }

  const sizeBytes = typeof mediaAsset.sizeBytes === "number"
    ? mediaAsset.sizeBytes
    : Number(mediaAsset.sizeBytes);
  if (Number.isSafeInteger(sizeBytes) === false || sizeBytes < 0) {
    return {
      reason: "invalid_media_size",
      packageMediaKey: mediaAsset.packageMediaKey,
      sizeBytes: mediaAsset.sizeBytes,
    };
  }

  const deliveryIssue = getPublicCatalogMediaDeliveryIssue({
    mimeType: mediaAsset.mimeType,
    sizeBytes,
  });
  if (deliveryIssue?.reason === "too_large") {
    return {
      reason: "media_too_large",
      packageMediaKey: mediaAsset.packageMediaKey,
      mimeType: mediaAsset.mimeType,
      sizeBytes,
    };
  }
  if (deliveryIssue?.reason === "unsupported_mime_type") {
    return {
      reason: "unsupported_media_type",
      packageMediaKey: mediaAsset.packageMediaKey,
      mimeType: mediaAsset.mimeType,
      sizeBytes,
    };
  }

  return null;
}

function getPublicCatalogVersionCardIssue(
  card: PublicCatalogVersionCardInput,
): PublicCatalogVersionEligibilityIssue | null {
  try {
    if (isPublicCatalogCardMarkdownSafe(card.frontText) === false) {
      return { reason: "unsafe_card_field", packageCardId: card.packageCardId, field: "frontText" };
    }
  } catch (error) {
    if (isMarkdownComplexityLimitError(error)) {
      return {
        reason: "card_markdown_too_complex",
        packageCardId: card.packageCardId,
        field: "frontText",
      };
    }
    throw error;
  }
  try {
    if (isPublicCatalogCardMarkdownSafe(card.backText) === false) {
      return { reason: "unsafe_card_field", packageCardId: card.packageCardId, field: "backText" };
    }
  } catch (error) {
    if (isMarkdownComplexityLimitError(error)) {
      return {
        reason: "card_markdown_too_complex",
        packageCardId: card.packageCardId,
        field: "backText",
      };
    }
    throw error;
  }
  if (isPublicCatalogTextSafe(card.cardType) === false) {
    return { reason: "unsafe_card_field", packageCardId: card.packageCardId, field: "cardType" };
  }
  if (isPublicCatalogTextArraySafe(card.tags) === false) {
    return { reason: "unsafe_card_field", packageCardId: card.packageCardId, field: "tags" };
  }

  return null;
}

export function getPublicCatalogVersionEligibilityIssue(
  input: PublicCatalogVersionEligibilityInput,
): PublicCatalogVersionEligibilityIssue | null {
  const packageIssue = getPublicCatalogPackageEligibilityIssue(input.package);
  if (packageIssue !== null) {
    return packageIssue;
  }

  const authorIssue = getPublicCatalogAuthorEligibilityIssue(input.author);
  if (authorIssue !== null) {
    return authorIssue;
  }

  const versionIssue = getPublicCatalogVersionPresentationIssue(input.version);
  if (versionIssue !== null) {
    return versionIssue;
  }

  const availablePackageMediaKeys = new Set<string>();
  for (const mediaAsset of input.mediaAssets) {
    const mediaAssetIssue = getPublicCatalogVersionMediaAssetIssue(mediaAsset);
    if (mediaAssetIssue !== null) {
      return mediaAssetIssue;
    }
    availablePackageMediaKeys.add(mediaAsset.packageMediaKey);
  }

  if (input.version.coverPackageMediaKey !== null) {
    if (isUnsafePublicPackageMediaKey(input.version.coverPackageMediaKey)) {
      return {
        reason: "unsafe_media_key",
        packageMediaKey: input.version.coverPackageMediaKey,
      };
    }
    if (availablePackageMediaKeys.has(input.version.coverPackageMediaKey) === false) {
      return {
        reason: "unresolved_media_reference",
        packageMediaKey: input.version.coverPackageMediaKey,
        referenceSource: "cover",
      };
    }
  }

  for (const card of input.cards) {
    const cardIssue = getPublicCatalogVersionCardIssue(card);
    if (cardIssue !== null) {
      return cardIssue;
    }

    for (const packageMediaKey of getCatalogCardRequiredPackageMediaKeys(card)) {
      if (isUnsafePublicPackageMediaKey(packageMediaKey)) {
        return { reason: "unsafe_media_key", packageMediaKey };
      }
      if (availablePackageMediaKeys.has(packageMediaKey) === false) {
        return {
          reason: "unresolved_media_reference",
          packageMediaKey,
          referenceSource: `card:${card.packageCardId}`,
        };
      }
    }
  }

  return null;
}
