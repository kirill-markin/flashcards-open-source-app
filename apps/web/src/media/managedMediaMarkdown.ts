import {
  parse as parseMicromark,
  postprocess as postprocessMicromark,
  preprocess as preprocessMicromark,
} from "micromark";
import { decodeString } from "micromark-util-decode-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const MANAGED_MEDIA_URL_PREFIX = "fcasset:";
const managedMediaMarkdownProcessor = unified().use(remarkParse).use(remarkGfm);

export type ManagedImageMarkdownInput = Readonly<{
  mediaAssetId: string;
  altText: string;
}>;

export type ManagedMediaReferenceState = "ready" | "pending" | "failed";

export type ManagedMediaUrlReference = Readonly<{
  mediaAssetId: string;
  state: ManagedMediaReferenceState;
}>;

export type ManagedMediaMarkdownReference = Readonly<{
  mediaAssetId: string;
  state: ManagedMediaReferenceState;
  altText: string;
  decodedDestination: string;
  destination: string;
  destinationEndIndex: number;
  destinationOwnerEndIndex: number;
  destinationOwnerMarkdown: string;
  destinationOwnerStartIndex: number;
  destinationStartIndex: number;
  markdown: string;
  isDestinationReplacementSafe: boolean;
  startIndex: number;
  endIndex: number;
}>;

type MarkdownSourceSpan = Readonly<{
  endIndex: number;
  startIndex: number;
}>;

type ManagedMediaDefinition = Readonly<{
  decodedDestination: string;
  destinationSpan: MarkdownSourceSpan;
  endIndex: number;
  identifier: string;
  markdown: string;
  startIndex: number;
}>;

type MarkdownDestinationSource = Readonly<{
  destinationSpan: MarkdownSourceSpan;
  ownerSpan: MarkdownSourceSpan;
  ownerType: "definition" | "resource";
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

function parseManagedMediaReferenceState(rawQuery: string | null): ManagedMediaReferenceState {
  if (rawQuery === null) {
    return "ready";
  }

  const stateValues = new URLSearchParams(rawQuery).getAll("state");
  if (stateValues.length !== 1) {
    return "ready";
  }

  const state = stateValues[0];
  return state === "pending" || state === "failed" ? state : "ready";
}

export function parseManagedMediaUrlReference(
  url: string | null | undefined,
): ManagedMediaUrlReference | null {
  if (url === null || url === undefined) {
    return null;
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.toLowerCase().startsWith(MANAGED_MEDIA_URL_PREFIX) === false) {
    return null;
  }

  const rawReference = trimmedUrl.slice(MANAGED_MEDIA_URL_PREFIX.length).replace(/^\/+/, "");
  const queryStartIndex = rawReference.indexOf("?");
  const fragmentStartIndex = rawReference.indexOf("#");
  const referenceEndIndex = Math.min(
    queryStartIndex === -1 ? rawReference.length : queryStartIndex,
    fragmentStartIndex === -1 ? rawReference.length : fragmentStartIndex,
  );
  const mediaAssetId = rawReference.slice(0, referenceEndIndex).trim();
  if (mediaAssetId === "") {
    return null;
  }

  const queryEndIndex = fragmentStartIndex === -1 ? rawReference.length : fragmentStartIndex;
  const rawQuery = queryStartIndex !== -1 && queryStartIndex < queryEndIndex
    ? rawReference.slice(queryStartIndex + 1, queryEndIndex)
    : null;

  return {
    mediaAssetId,
    state: parseManagedMediaReferenceState(rawQuery),
  };
}

export function parseManagedMediaAssetId(url: string | null | undefined): string | null {
  return parseManagedMediaUrlReference(url)?.mediaAssetId ?? null;
}

function requireMarkdownSourceSpan(
  position: Readonly<{
    end: Readonly<{ offset?: number }>;
    start: Readonly<{ offset?: number }>;
  }> | undefined,
  nodeType: string,
): MarkdownSourceSpan {
  const startIndex = position?.start.offset;
  const endIndex = position?.end.offset;
  if (startIndex === undefined || endIndex === undefined) {
    throw new Error(`Managed media Markdown parser returned a ${nodeType} without source offsets`);
  }

  return {
    endIndex,
    startIndex,
  };
}

function readMarkdownDestinationSources(text: string): ReadonlyArray<MarkdownDestinationSource> {
  const sources: Array<MarkdownDestinationSource> = [];
  let definitionOwnerSpan: MarkdownSourceSpan | null = null;
  let definitionDestinationSpan: MarkdownSourceSpan | null = null;
  let resourceOwnerSpan: MarkdownSourceSpan | null = null;
  let resourceDestinationSpan: MarkdownSourceSpan | null = null;
  const chunks = preprocessMicromark()(text, undefined, true);
  const events = postprocessMicromark(
    parseMicromark().document().write(chunks),
  );

  for (const [eventType, token] of events) {
    if (eventType === "enter" && token.type === "definition") {
      definitionOwnerSpan = {
        startIndex: token.start.offset,
        endIndex: token.end.offset,
      };
      definitionDestinationSpan = null;
      continue;
    }
    if (eventType === "enter" && token.type === "definitionDestinationString") {
      definitionDestinationSpan = {
        startIndex: token.start.offset,
        endIndex: token.end.offset,
      };
      continue;
    }
    if (eventType === "exit" && token.type === "definition") {
      if (definitionOwnerSpan !== null && definitionDestinationSpan !== null) {
        sources.push({
          destinationSpan: definitionDestinationSpan,
          ownerSpan: definitionOwnerSpan,
          ownerType: "definition",
        });
      }
      definitionOwnerSpan = null;
      definitionDestinationSpan = null;
      continue;
    }
    if (eventType === "enter" && token.type === "resource") {
      resourceOwnerSpan = {
        startIndex: token.start.offset,
        endIndex: token.end.offset,
      };
      resourceDestinationSpan = null;
      continue;
    }
    if (eventType === "enter" && token.type === "resourceDestinationString") {
      resourceDestinationSpan = {
        startIndex: token.start.offset,
        endIndex: token.end.offset,
      };
      continue;
    }
    if (eventType === "exit" && token.type === "resource") {
      if (resourceOwnerSpan !== null && resourceDestinationSpan !== null) {
        sources.push({
          destinationSpan: resourceDestinationSpan,
          ownerSpan: resourceOwnerSpan,
          ownerType: "resource",
        });
      }
      resourceOwnerSpan = null;
      resourceDestinationSpan = null;
    }
  }

  return sources;
}

function readInlineImageDestinationSpan(
  nodeSpan: MarkdownSourceSpan,
  destinationSources: ReadonlyArray<MarkdownDestinationSource>,
): MarkdownSourceSpan | null {
  const matchingSources = destinationSources.filter((source) => (
    source.ownerType === "resource"
    && source.ownerSpan.startIndex > nodeSpan.startIndex
    && source.ownerSpan.endIndex === nodeSpan.endIndex
  ));
  return matchingSources.length === 1
    ? matchingSources[0]?.destinationSpan ?? null
    : null;
}

function readDefinitionDestinationSpan(
  nodeSpan: MarkdownSourceSpan,
  destinationSources: ReadonlyArray<MarkdownDestinationSource>,
): MarkdownSourceSpan | null {
  const matchingSources = destinationSources.filter((source) => (
    source.ownerType === "definition"
    && source.ownerSpan.startIndex === nodeSpan.startIndex
    && source.ownerSpan.endIndex === nodeSpan.endIndex
  ));
  return matchingSources.length === 1
    ? matchingSources[0]?.destinationSpan ?? null
    : null;
}

function readRawDestination(
  text: string,
  destinationSpan: MarkdownSourceSpan | null,
  decodedDestination: string,
): string | null {
  if (destinationSpan === null) {
    return null;
  }

  const destination = text.slice(destinationSpan.startIndex, destinationSpan.endIndex);
  if (decodeString(destination) !== decodedDestination) {
    return null;
  }

  return destination;
}

export function parseManagedImageMarkdownReferences(text: string): ReadonlyArray<ManagedMediaMarkdownReference> {
  const references: Array<ManagedMediaMarkdownReference> = [];
  const tree = managedMediaMarkdownProcessor.parse(text);
  const definitionsByIdentifier = new Map<string, Array<ManagedMediaDefinition>>();
  const imageReferenceIdentifiers = new Set<string>();
  const referenceCountsByIdentifier = new Map<string, number>();
  const destinationSources = readMarkdownDestinationSources(text);

  visit(tree, "image", (node) => {
    const mediaReference = parseManagedMediaUrlReference(node.url);
    if (mediaReference === null) {
      return;
    }

    const nodeSpan = requireMarkdownSourceSpan(node.position, "image");
    const destinationSpan = readInlineImageDestinationSpan(nodeSpan, destinationSources);
    if (destinationSpan === null) {
      return;
    }
    const destination = readRawDestination(
      text,
      destinationSpan,
      node.url,
    );
    if (destination === null) {
      return;
    }

    references.push({
      mediaAssetId: mediaReference.mediaAssetId,
      state: mediaReference.state,
      altText: node.alt ?? "",
      decodedDestination: node.url,
      destination,
      destinationEndIndex: destinationSpan.endIndex,
      destinationOwnerEndIndex: nodeSpan.endIndex,
      destinationOwnerMarkdown: text.slice(nodeSpan.startIndex, nodeSpan.endIndex),
      destinationOwnerStartIndex: nodeSpan.startIndex,
      destinationStartIndex: destinationSpan.startIndex,
      markdown: text.slice(nodeSpan.startIndex, nodeSpan.endIndex),
      isDestinationReplacementSafe: true,
      startIndex: nodeSpan.startIndex,
      endIndex: nodeSpan.endIndex,
    });
  });

  visit(tree, "imageReference", (node) => {
    imageReferenceIdentifiers.add(node.identifier);
    referenceCountsByIdentifier.set(
      node.identifier,
      (referenceCountsByIdentifier.get(node.identifier) ?? 0) + 1,
    );
  });
  visit(tree, "linkReference", (node) => {
    referenceCountsByIdentifier.set(
      node.identifier,
      (referenceCountsByIdentifier.get(node.identifier) ?? 0) + 1,
    );
  });

  visit(tree, "definition", (node) => {
    if (imageReferenceIdentifiers.has(node.identifier) === false) {
      return;
    }

    const nodeSpan = requireMarkdownSourceSpan(node.position, "definition");
    const destinationSpan = readDefinitionDestinationSpan(nodeSpan, destinationSources);
    const destination = readRawDestination(
      text,
      destinationSpan,
      node.url,
    );
    if (destinationSpan === null || destination === null) {
      return;
    }

    const definition: ManagedMediaDefinition = {
      decodedDestination: node.url,
      destinationSpan,
      endIndex: nodeSpan.endIndex,
      identifier: node.identifier,
      markdown: text.slice(nodeSpan.startIndex, nodeSpan.endIndex),
      startIndex: nodeSpan.startIndex,
    };
    const definitions = definitionsByIdentifier.get(node.identifier);
    if (definitions === undefined) {
      definitionsByIdentifier.set(node.identifier, [definition]);
    } else {
      definitions.push(definition);
    }
  });

  visit(tree, "imageReference", (node) => {
    const definitions = definitionsByIdentifier.get(node.identifier);
    const definition = definitions?.[0];
    if (definition === undefined) {
      return;
    }

    const mediaReference = parseManagedMediaUrlReference(definition.decodedDestination);
    if (mediaReference === null) {
      return;
    }

    const nodeSpan = requireMarkdownSourceSpan(node.position, "image reference");
    references.push({
      mediaAssetId: mediaReference.mediaAssetId,
      state: mediaReference.state,
      altText: node.alt ?? "",
      decodedDestination: definition.decodedDestination,
      destination: text.slice(
        definition.destinationSpan.startIndex,
        definition.destinationSpan.endIndex,
      ),
      destinationEndIndex: definition.destinationSpan.endIndex,
      destinationOwnerEndIndex: definition.endIndex,
      destinationOwnerMarkdown: definition.markdown,
      destinationOwnerStartIndex: definition.startIndex,
      destinationStartIndex: definition.destinationSpan.startIndex,
      markdown: text.slice(nodeSpan.startIndex, nodeSpan.endIndex),
      isDestinationReplacementSafe: definitions?.length === 1
        && referenceCountsByIdentifier.get(node.identifier) === 1,
      startIndex: nodeSpan.startIndex,
      endIndex: nodeSpan.endIndex,
    });
  });

  return references.sort((left, right) => left.startIndex - right.startIndex);
}

export function extractManagedMediaAssetIdsFromMarkdown(text: string): ReadonlyArray<string> {
  const mediaAssetIds = new Set<string>();
  const pattern = /\bfcasset:[^\s)\]"'<>]+/gi;

  for (const match of text.matchAll(pattern)) {
    const mediaUrl = match[0];
    const mediaAssetId = parseManagedMediaAssetId(mediaUrl);
    if (mediaAssetId !== null) {
      mediaAssetIds.add(mediaAssetId);
    }
  }

  return [...mediaAssetIds];
}

export function buildManagedImageMarkdown(input: ManagedImageMarkdownInput): string {
  const mediaAssetId = requireMediaAssetId(input.mediaAssetId);
  return `![${escapeMarkdownImageAltText(input.altText)}](${MANAGED_MEDIA_URL_PREFIX}${mediaAssetId})`;
}
