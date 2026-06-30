type MarkdownUrlRewrite = Readonly<{
  startIndex: number;
  endIndex: number;
  replacementUrl: string;
}>;

type MarkdownLinkDestination = Readonly<{
  startIndex: number;
  endIndex: number;
  linkEndIndex: number;
  destination: string;
}>;

type MarkdownFence = Readonly<{
  marker: "`" | "~";
  length: number;
  lineEndIndex: number;
}>;

export type FcAssetPortablePathResolver = (assetId: string) => string;
export type PortableMediaAssetIdResolver = (portableMediaPath: string) => string;

const fcAssetUrlPattern = /^fcasset:([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const absoluteUrlPattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const portableMediaPathSegmentPattern = /^[A-Za-z0-9._-]+$/;

function matchFcAssetId(url: string): string | null {
  const match = fcAssetUrlPattern.exec(url);
  if (match === null) {
    return null;
  }

  return match[1] ?? null;
}

function isLineStart(markdown: string, index: number): boolean {
  return index === 0 || markdown[index - 1] === "\n";
}

function getLineEndIndex(markdown: string, index: number): number {
  const newlineIndex = markdown.indexOf("\n", index);
  return newlineIndex === -1 ? markdown.length : newlineIndex;
}

function getNextLineStartIndex(markdown: string, lineEndIndex: number): number {
  return lineEndIndex >= markdown.length ? markdown.length : lineEndIndex + 1;
}

function countRepeatedCharacter(markdown: string, index: number, marker: "`" | "~"): number {
  let cursorIndex = index;
  while (markdown[cursorIndex] === marker) {
    cursorIndex += 1;
  }

  return cursorIndex - index;
}

function parseFenceAtLineStart(markdown: string, index: number): MarkdownFence | null {
  if (!isLineStart(markdown, index)) {
    return null;
  }

  let cursorIndex = index;
  let leadingSpaces = 0;
  while (markdown[cursorIndex] === " " && leadingSpaces < 4) {
    cursorIndex += 1;
    leadingSpaces += 1;
  }

  if (leadingSpaces > 3) {
    return null;
  }

  const marker = markdown[cursorIndex];
  if (marker !== "`" && marker !== "~") {
    return null;
  }

  const markerLength = countRepeatedCharacter(markdown, cursorIndex, marker);
  if (markerLength < 3) {
    return null;
  }

  return {
    marker,
    length: markerLength,
    lineEndIndex: getLineEndIndex(markdown, index),
  };
}

function findFencedCodeBlockEndIndex(markdown: string, openingFence: MarkdownFence): number {
  let cursorIndex = getNextLineStartIndex(markdown, openingFence.lineEndIndex);

  while (cursorIndex < markdown.length) {
    const closingFence = parseFenceAtLineStart(markdown, cursorIndex);
    if (
      closingFence !== null
      && closingFence.marker === openingFence.marker
      && closingFence.length >= openingFence.length
    ) {
      return getNextLineStartIndex(markdown, closingFence.lineEndIndex);
    }

    cursorIndex = getNextLineStartIndex(markdown, getLineEndIndex(markdown, cursorIndex));
  }

  return markdown.length;
}

function findInlineCodeSpanEndIndex(markdown: string, index: number): number {
  const markerLength = countRepeatedCharacter(markdown, index, "`");
  const closingMarker = "`".repeat(markerLength);
  const closingIndex = markdown.indexOf(closingMarker, index + markerLength);
  if (closingIndex === -1) {
    return index + markerLength;
  }

  return closingIndex + markerLength;
}

function findClosingBracketIndex(markdown: string, index: number): number | null {
  let cursorIndex = index;

  while (cursorIndex < markdown.length) {
    const character = markdown[cursorIndex];
    if (character === "\\") {
      cursorIndex += 2;
      continue;
    }

    if (character === "\n") {
      return null;
    }

    if (character === "]") {
      return cursorIndex;
    }

    cursorIndex += 1;
  }

  return null;
}

function skipHorizontalWhitespace(markdown: string, index: number): number {
  let cursorIndex = index;
  while (markdown[cursorIndex] === " " || markdown[cursorIndex] === "\t") {
    cursorIndex += 1;
  }

  return cursorIndex;
}

function findClosingTitleQuoteIndex(markdown: string, index: number, quote: "\"" | "'"): number | null {
  let cursorIndex = index;

  while (cursorIndex < markdown.length) {
    const character = markdown[cursorIndex];
    if (character === "\\") {
      cursorIndex += 2;
      continue;
    }

    if (character === "\n") {
      return null;
    }

    if (character === quote) {
      return cursorIndex;
    }

    cursorIndex += 1;
  }

  return null;
}

function parseBareDestinationEndIndex(markdown: string, index: number): number {
  let cursorIndex = index;

  while (cursorIndex < markdown.length) {
    const character = markdown[cursorIndex];
    if (
      character === ")"
      || character === " "
      || character === "\t"
      || character === "\n"
    ) {
      return cursorIndex;
    }

    cursorIndex += 1;
  }

  return cursorIndex;
}

function parseAngledDestinationEndIndex(markdown: string, index: number): number | null {
  let cursorIndex = index;

  while (cursorIndex < markdown.length) {
    const character = markdown[cursorIndex];
    if (character === "\n") {
      return null;
    }

    if (character === ">") {
      return cursorIndex;
    }

    cursorIndex += 1;
  }

  return null;
}

function parseMarkdownLinkDestinationAtIndex(markdown: string, index: number): MarkdownLinkDestination | null {
  const labelOpenIndex = markdown[index] === "!" ? index + 1 : index;
  if (markdown[labelOpenIndex] !== "[") {
    return null;
  }

  const labelCloseIndex = findClosingBracketIndex(markdown, labelOpenIndex + 1);
  if (labelCloseIndex === null || markdown[labelCloseIndex + 1] !== "(") {
    return null;
  }

  let cursorIndex = skipHorizontalWhitespace(markdown, labelCloseIndex + 2);
  let destinationStartIndex = cursorIndex;
  let destinationEndIndex: number | null;

  if (markdown[cursorIndex] === "<") {
    destinationStartIndex = cursorIndex + 1;
    destinationEndIndex = parseAngledDestinationEndIndex(markdown, destinationStartIndex);
    if (destinationEndIndex === null) {
      return null;
    }

    cursorIndex = destinationEndIndex + 1;
  } else {
    destinationEndIndex = parseBareDestinationEndIndex(markdown, cursorIndex);
    cursorIndex = destinationEndIndex;
  }

  if (destinationStartIndex === destinationEndIndex) {
    return null;
  }

  cursorIndex = skipHorizontalWhitespace(markdown, cursorIndex);
  const titleQuote = markdown[cursorIndex];
  if (titleQuote === "\"" || titleQuote === "'") {
    const closingQuoteIndex = findClosingTitleQuoteIndex(markdown, cursorIndex + 1, titleQuote);
    if (closingQuoteIndex === null) {
      return null;
    }

    cursorIndex = skipHorizontalWhitespace(markdown, closingQuoteIndex + 1);
  }

  if (markdown[cursorIndex] !== ")") {
    return null;
  }

  return {
    startIndex: destinationStartIndex,
    endIndex: destinationEndIndex,
    linkEndIndex: cursorIndex + 1,
    destination: markdown.slice(destinationStartIndex, destinationEndIndex),
  };
}

function listMarkdownLinkDestinations(markdown: string): ReadonlyArray<MarkdownLinkDestination> {
  const destinations: Array<MarkdownLinkDestination> = [];
  let cursorIndex = 0;

  while (cursorIndex < markdown.length) {
    const openingFence = parseFenceAtLineStart(markdown, cursorIndex);
    if (openingFence !== null) {
      cursorIndex = findFencedCodeBlockEndIndex(markdown, openingFence);
      continue;
    }

    const character = markdown[cursorIndex];
    if (character === "`") {
      cursorIndex = findInlineCodeSpanEndIndex(markdown, cursorIndex);
      continue;
    }

    if (character === "[" || (character === "!" && markdown[cursorIndex + 1] === "[")) {
      const destination = parseMarkdownLinkDestinationAtIndex(markdown, cursorIndex);
      if (destination !== null) {
        destinations.push(destination);
        cursorIndex = destination.linkEndIndex;
        continue;
      }
    }

    cursorIndex += 1;
  }

  return destinations;
}

function rewriteMarkdownUrls(
  markdown: string,
  buildRewrite: (url: string) => string | null,
): string {
  const rewrites: Array<MarkdownUrlRewrite> = [];

  for (const linkDestination of listMarkdownLinkDestinations(markdown)) {
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
  return url === "media" || url.startsWith("media/");
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

export function extractMarkdownFcAssetIds(markdown: string): ReadonlyArray<string> {
  const assetIds: Array<string> = [];
  const seenAssetIds = new Set<string>();

  for (const linkDestination of listMarkdownLinkDestinations(markdown)) {
    const assetId = matchFcAssetId(linkDestination.destination);
    if (assetId === null || seenAssetIds.has(assetId)) {
      continue;
    }

    seenAssetIds.add(assetId);
    assetIds.push(assetId);
  }

  return assetIds;
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
