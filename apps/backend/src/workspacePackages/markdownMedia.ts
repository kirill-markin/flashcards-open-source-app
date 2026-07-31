import { HttpError } from "../shared/errors";
import {
  extractMarkdownNonCodeTextSegmentsUnchecked,
  iterateMarkdownActiveDestinations,
  MarkdownComplexityError,
} from "../shared/markdown";

type MarkdownUrlRewrite = Readonly<{
  startIndex: number;
  endIndex: number;
  replacementUrl: string;
}>;

export type ManagedMediaLifecycleState = "ready" | "pending" | "failed";

export type ManagedMediaLifecycleReference = Readonly<{
  mediaAssetId: string;
  state: ManagedMediaLifecycleState;
  destination: string;
  isImage: boolean;
}>;

export type ManagedMediaLifecycleIssues = Readonly<{
  pendingDestinations: ReadonlyArray<string>;
  failedDestinations: ReadonlyArray<string>;
  unsupportedDestinations: ReadonlyArray<string>;
}>;

export type FcAssetPortablePathResolver = (assetId: string) => string;
export type FcAssetIdResolver = (assetId: string) => string;
export type PortableMediaAssetIdResolver = (portableMediaPath: string) => string;

const fcAssetUrlPattern = /^fcasset:([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const managedMediaLifecycleUrlPattern =
  /^fcasset:([A-Za-z0-9][A-Za-z0-9._-]*)(?:\?state=(pending|failed))?$/;
const managedMediaSchemePrefix = "fcasset:";
const absoluteUrlPattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const localMediaPathWithLeadingDotSegmentsPattern = /^(?:\.\.?[\\/])+media(?:[\\/]|$)/;
const portableMediaPathSegmentPattern = /^[A-Za-z0-9._-]+$/;

const markdownComplexityLimitErrorCode =
  "MARKDOWN_COMPLEXITY_LIMIT_EXCEEDED";

function translateMarkdownComplexityError(error: MarkdownComplexityError): HttpError {
  return new HttpError(
    400,
    error.message,
    markdownComplexityLimitErrorCode,
  );
}

export function isMarkdownComplexityLimitError(error: unknown): error is HttpError {
  return error instanceof HttpError
    && error.code === markdownComplexityLimitErrorCode;
}

function runMarkdownHelper<Result>(operation: () => Result): Result {
  try {
    return operation();
  } catch (error) {
    if (error instanceof MarkdownComplexityError) {
      throw translateMarkdownComplexityError(error);
    }
    throw error;
  }
}

function matchFcAssetId(url: string): string | null {
  const match = fcAssetUrlPattern.exec(url);
  if (match === null) {
    return null;
  }

  return match[1] ?? null;
}

export function parseManagedMediaLifecycleReference(
  destination: string,
): Omit<ManagedMediaLifecycleReference, "isImage"> | null {
  const match = managedMediaLifecycleUrlPattern.exec(destination);
  if (match === null) {
    return null;
  }
  const mediaAssetId = match[1];
  const lifecycleState = match[2];
  if (mediaAssetId === undefined) {
    return null;
  }
  const state: ManagedMediaLifecycleState = lifecycleState === "pending"
    ? "pending"
    : lifecycleState === "failed"
      ? "failed"
      : "ready";
  return {
    mediaAssetId,
    state,
    destination,
  };
}

export function extractMarkdownNonCodeTextSegments(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownNonCodeTextSegmentsUnchecked(markdown));
}

function rewriteMarkdownUrlsUnchecked(
  markdown: string,
  buildRewrite: (url: string) => string | null,
): string {
  const rewrites: Array<MarkdownUrlRewrite> = [];

  for (const linkDestination of iterateMarkdownActiveDestinations(markdown)) {
    if (!linkDestination.hasDestination) {
      continue;
    }
    const replacementUrl = buildRewrite(linkDestination.destination);
    if (replacementUrl === null) {
      continue;
    }

    rewrites.push({
      startIndex: linkDestination.startIndex,
      endIndex: linkDestination.endIndex,
      replacementUrl,
    });
  }

  if (rewrites.length === 0) {
    return markdown;
  }

  let rewrittenMarkdown = "";
  let cursorIndex = 0;
  for (const rewrite of rewrites) {
    rewrittenMarkdown += markdown.slice(cursorIndex, rewrite.startIndex);
    rewrittenMarkdown += rewrite.replacementUrl;
    cursorIndex = rewrite.endIndex;
  }

  return rewrittenMarkdown + markdown.slice(cursorIndex);
}

function rewriteMarkdownUrls(
  markdown: string,
  buildRewrite: (url: string) => string | null,
): string {
  return runMarkdownHelper(() => rewriteMarkdownUrlsUnchecked(markdown, buildRewrite));
}

function assertFcAssetId(value: string, fieldName: string): string {
  if (matchFcAssetId(`fcasset:${value}`) === null) {
    throw new Error(`${fieldName} must contain only portable fcasset id characters.`);
  }

  return value;
}

function validatePortableMediaPathSegment(segment: string, portableMediaPath: string): string {
  if (segment === "") {
    throw new Error(`Portable media path must not contain empty path segments: ${portableMediaPath}`);
  }

  let decodedSegment: string;
  try {
    decodedSegment = decodeURIComponent(segment);
  } catch {
    throw new Error(`Portable media path segment must use valid percent encoding: ${portableMediaPath}`);
  }

  if (decodedSegment === "." || decodedSegment === "..") {
    throw new Error(`Portable media path must not contain traversal segments: ${portableMediaPath}`);
  }

  if (!portableMediaPathSegmentPattern.test(segment)) {
    throw new Error(
      `Portable media path segments must contain only letters, numbers, dots, underscores, and hyphens: ${portableMediaPath}`,
    );
  }

  if (
    decodedSegment.includes("/")
    || decodedSegment.includes("\\")
    || decodedSegment.includes("\0")
  ) {
    throw new Error(`Portable media path segment decodes to an unsafe name: ${portableMediaPath}`);
  }

  return decodedSegment;
}

function getPortableMediaPathDuplicateKey(portableMediaPath: string): string {
  return portableMediaPath
    .split("/")
    .map((segment) => decodeURIComponent(segment).normalize("NFC").toLowerCase())
    .join("/");
}

function isPortableMediaPathCandidate(url: string): boolean {
  if (absoluteUrlPattern.test(url)) {
    return false;
  }

  return (
    url === "media"
    || url.startsWith("media/")
    || url === "/media"
    || url.startsWith("/media/")
    || url.startsWith("/media\\")
    || url.startsWith("media\\")
    || localMediaPathWithLeadingDotSegmentsPattern.test(url)
  );
}

export function validatePortableMediaPath(portableMediaPath: string): string {
  if (portableMediaPath === "") {
    throw new Error("Portable media path must not be empty.");
  }

  if (portableMediaPath.includes("\\")) {
    throw new Error(`Portable media path must use forward slashes: ${portableMediaPath}`);
  }

  if (portableMediaPath.includes("?") || portableMediaPath.includes("#")) {
    throw new Error(`Portable media path must not include query strings or fragments: ${portableMediaPath}`);
  }

  if (portableMediaPath.startsWith("/") || absoluteUrlPattern.test(portableMediaPath)) {
    throw new Error(`Portable media path must be relative: ${portableMediaPath}`);
  }

  if (!portableMediaPath.startsWith("media/")) {
    throw new Error(`Portable media path must be under media/: ${portableMediaPath}`);
  }

  const pathSegments = portableMediaPath.split("/");
  for (const segment of pathSegments) {
    validatePortableMediaPathSegment(segment, portableMediaPath);
  }

  if (pathSegments.length < 2) {
    throw new Error(`Portable media path must include a file name under media/: ${portableMediaPath}`);
  }

  return portableMediaPath;
}

export function validateUniquePortableMediaPaths(
  portableMediaPaths: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const seenDuplicateKeys = new Set<string>();
  const validatedPaths: Array<string> = [];

  for (const portableMediaPath of portableMediaPaths) {
    const validatedPath = validatePortableMediaPath(portableMediaPath);
    const duplicateKey = getPortableMediaPathDuplicateKey(validatedPath);
    if (seenDuplicateKeys.has(duplicateKey)) {
      throw new Error(`Portable media path is duplicated: ${portableMediaPath}`);
    }

    seenDuplicateKeys.add(duplicateKey);
    validatedPaths.push(validatedPath);
  }

  return validatedPaths;
}

function extractMarkdownFcAssetIdsUnchecked(markdown: string): ReadonlyArray<string> {
  const assetIds: Array<string> = [];
  const seenAssetIds = new Set<string>();

  for (const linkDestination of iterateMarkdownActiveDestinations(markdown)) {
    if (!linkDestination.hasDestination) {
      continue;
    }
    const assetId = matchFcAssetId(linkDestination.destination);
    if (assetId === null || seenAssetIds.has(assetId)) {
      continue;
    }

    seenAssetIds.add(assetId);
    assetIds.push(assetId);
  }

  return assetIds;
}

export function extractMarkdownFcAssetIds(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownFcAssetIdsUnchecked(markdown));
}

function extractMarkdownImageFcAssetIdsUnchecked(markdown: string): ReadonlyArray<string> {
  const assetIds: Array<string> = [];
  const seenAssetIds = new Set<string>();

  for (const destination of iterateMarkdownActiveDestinations(markdown)) {
    if (!destination.hasDestination || !destination.isImage) {
      continue;
    }
    const assetId = matchFcAssetId(destination.destination);
    if (assetId === null || seenAssetIds.has(assetId)) {
      continue;
    }

    seenAssetIds.add(assetId);
    assetIds.push(assetId);
  }

  return assetIds;
}

export function extractMarkdownImageFcAssetIds(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownImageFcAssetIdsUnchecked(markdown));
}

function extractMarkdownImageDestinationUrlsUnchecked(markdown: string): ReadonlyArray<string> {
  const destinations: Array<string> = [];
  for (const destination of iterateMarkdownActiveDestinations(markdown)) {
    if (!destination.hasDestination || !destination.isImage) {
      continue;
    }
    destinations.push(destination.destination);
  }
  return destinations;
}

export function extractMarkdownImageDestinationUrls(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownImageDestinationUrlsUnchecked(markdown));
}

function extractMarkdownManagedMediaLifecycleReferencesUnchecked(
  markdown: string,
): ReadonlyArray<ManagedMediaLifecycleReference> {
  const references: Array<ManagedMediaLifecycleReference> = [];
  for (const destination of iterateMarkdownActiveDestinations(markdown)) {
    if (!destination.hasDestination) {
      continue;
    }
    const reference = parseManagedMediaLifecycleReference(destination.destination);
    if (reference === null) {
      continue;
    }
    references.push({
      ...reference,
      isImage: destination.isImage,
    });
  }
  return references;
}

export function extractMarkdownManagedMediaLifecycleReferences(
  markdown: string,
): ReadonlyArray<ManagedMediaLifecycleReference> {
  return runMarkdownHelper(() => (
    extractMarkdownManagedMediaLifecycleReferencesUnchecked(markdown)
  ));
}

function extractMarkdownManagedMediaLifecycleIssuesUnchecked(
  markdown: string,
): ManagedMediaLifecycleIssues {
  const pendingDestinations: Array<string> = [];
  const failedDestinations: Array<string> = [];
  const unsupportedDestinations: Array<string> = [];
  for (const destination of iterateMarkdownActiveDestinations(markdown)) {
    if (!destination.hasDestination) {
      continue;
    }
    const reference = parseManagedMediaLifecycleReference(destination.destination);
    if (reference?.state === "pending") {
      pendingDestinations.push(reference.destination);
      continue;
    }
    if (reference?.state === "failed") {
      failedDestinations.push(reference.destination);
      continue;
    }
    if (
      reference === null
      && destination.destination.slice(0, managedMediaSchemePrefix.length).toLowerCase()
        === managedMediaSchemePrefix
    ) {
      unsupportedDestinations.push(destination.destination);
    }
  }
  return {
    pendingDestinations,
    failedDestinations,
    unsupportedDestinations,
  };
}

export function extractMarkdownManagedMediaLifecycleIssues(
  markdown: string,
): ManagedMediaLifecycleIssues {
  return runMarkdownHelper(() => (
    extractMarkdownManagedMediaLifecycleIssuesUnchecked(markdown)
  ));
}

function extractMarkdownLinkDestinationUrlsUnchecked(markdown: string): ReadonlyArray<string> {
  const destinations: Array<string> = [];
  for (const linkDestination of iterateMarkdownActiveDestinations(markdown)) {
    if (!linkDestination.hasDestination) {
      continue;
    }
    destinations.push(linkDestination.destination);
  }

  return destinations;
}

export function extractMarkdownLinkDestinationUrls(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownLinkDestinationUrlsUnchecked(markdown));
}

export function rewriteMarkdownImageDestinationUrl(
  markdown: string,
  currentUrl: string,
  replacementUrl: string,
): string {
  return runMarkdownHelper(() => {
    const rewrites: Array<MarkdownUrlRewrite> = [];
    for (const destination of iterateMarkdownActiveDestinations(markdown)) {
      if (
        !destination.hasDestination
        || !destination.isImage
        || destination.destination !== currentUrl
      ) {
        continue;
      }
      rewrites.push({
        startIndex: destination.startIndex,
        endIndex: destination.endIndex,
        replacementUrl,
      });
    }

    let rewrittenMarkdown = "";
    let cursorIndex = 0;
    for (const rewrite of rewrites) {
      rewrittenMarkdown += markdown.slice(cursorIndex, rewrite.startIndex);
      rewrittenMarkdown += rewrite.replacementUrl;
      cursorIndex = rewrite.endIndex;
    }
    return rewrites.length === 0
      ? markdown
      : rewrittenMarkdown + markdown.slice(cursorIndex);
  });
}

function extractMarkdownPortableMediaPathsUnchecked(markdown: string): ReadonlyArray<string> {
  const portableMediaPaths: Array<string> = [];
  const seenPortableMediaPaths = new Set<string>();

  for (const linkDestination of iterateMarkdownActiveDestinations(markdown)) {
    if (!linkDestination.hasDestination) {
      continue;
    }
    if (!isPortableMediaPathCandidate(linkDestination.destination)) {
      continue;
    }

    const portableMediaPath = validatePortableMediaPath(linkDestination.destination);
    if (seenPortableMediaPaths.has(portableMediaPath)) {
      continue;
    }

    seenPortableMediaPaths.add(portableMediaPath);
    portableMediaPaths.push(portableMediaPath);
  }

  return portableMediaPaths;
}

export function extractMarkdownPortableMediaPaths(markdown: string): ReadonlyArray<string> {
  return runMarkdownHelper(() => extractMarkdownPortableMediaPathsUnchecked(markdown));
}

export function rewriteMarkdownFcAssetUrlsToPortablePaths(
  markdown: string,
  resolvePortablePath: FcAssetPortablePathResolver,
): string {
  const portablePathByAssetId = new Map<string, string>();
  const assetIdByDuplicateKey = new Map<string, string>();

  return rewriteMarkdownUrls(markdown, (url) => {
    const assetId = matchFcAssetId(url);
    if (assetId === null) {
      return null;
    }

    const portablePath = validatePortableMediaPath(resolvePortablePath(assetId));
    const previousPortablePath = portablePathByAssetId.get(assetId);
    if (previousPortablePath !== undefined && previousPortablePath !== portablePath) {
      throw new Error(`fcasset id resolved to multiple portable media paths: ${assetId}`);
    }

    portablePathByAssetId.set(assetId, portablePath);
    const duplicateKey = getPortableMediaPathDuplicateKey(portablePath);
    const existingAssetId = assetIdByDuplicateKey.get(duplicateKey);
    if (existingAssetId !== undefined && existingAssetId !== assetId) {
      throw new Error(`Portable media path is shared by multiple fcasset ids: ${portablePath}`);
    }

    assetIdByDuplicateKey.set(duplicateKey, assetId);
    return portablePath;
  });
}

export function rewriteMarkdownFcAssetUrlsToPortablePathsFromMap(
  markdown: string,
  portablePathsByAssetId: ReadonlyMap<string, string>,
): string {
  return rewriteMarkdownFcAssetUrlsToPortablePaths(markdown, (assetId) => {
    const portablePath = portablePathsByAssetId.get(assetId);
    if (portablePath === undefined) {
      throw new Error(`Missing portable media path for fcasset id: ${assetId}`);
    }

    return portablePath;
  });
}

export function rewriteMarkdownFcAssetUrlsToSharedPortablePathsFromMap(
  markdown: string,
  portablePathsByAssetId: ReadonlyMap<string, string>,
): string {
  return rewriteMarkdownFcAssetUrlsToSharedPortablePaths(markdown, (assetId) => {
    const portablePath = portablePathsByAssetId.get(assetId);
    if (portablePath === undefined) {
      throw new Error(`Missing portable media path for fcasset id: ${assetId}`);
    }

    return portablePath;
  });
}

export function rewriteMarkdownFcAssetUrlsToSharedPortablePaths(
  markdown: string,
  resolvePortablePath: FcAssetPortablePathResolver,
): string {
  return rewriteMarkdownUrls(markdown, (url) => {
    const assetId = matchFcAssetId(url);
    if (assetId === null) {
      return null;
    }

    return validatePortableMediaPath(resolvePortablePath(assetId));
  });
}

export function rewriteMarkdownFcAssetUrlsToFcAssets(
  markdown: string,
  resolveAssetId: FcAssetIdResolver,
): string {
  return rewriteMarkdownUrls(markdown, (url) => {
    const assetId = matchFcAssetId(url);
    if (assetId === null) {
      return null;
    }

    return `fcasset:${assertFcAssetId(resolveAssetId(assetId), "Resolved fcasset id")}`;
  });
}

export function rewriteMarkdownPortableMediaUrlsToFcAssets(
  markdown: string,
  resolveAssetId: PortableMediaAssetIdResolver,
): string {
  return rewriteMarkdownUrls(markdown, (url) => {
    if (!isPortableMediaPathCandidate(url)) {
      return null;
    }

    const portableMediaPath = validatePortableMediaPath(url);
    const assetId = assertFcAssetId(resolveAssetId(portableMediaPath), "Resolved fcasset id");
    return `fcasset:${assetId}`;
  });
}

export function rewriteMarkdownPortableMediaUrlsToFcAssetsFromMap(
  markdown: string,
  assetIdsByPortablePath: ReadonlyMap<string, string>,
): string {
  return rewriteMarkdownPortableMediaUrlsToFcAssets(markdown, (portableMediaPath) => {
    const assetId = assetIdsByPortablePath.get(portableMediaPath);
    if (assetId === undefined) {
      throw new Error(`Missing fcasset id for portable media path: ${portableMediaPath}`);
    }

    return assetId;
  });
}
