import { decodeString } from "micromark-util-decode-string";
import {
  parseManagedImageMarkdownReferences,
  type ManagedMediaMarkdownReference,
  type ManagedMediaReferenceState,
} from "../../../media/managedMediaMarkdown";
import type { Card } from "../../../types";
import type { CardFormState } from "./CardForm";

type LifecycleTransition = Readonly<{
  isPreviousReferenceUnique: boolean;
  nextDestination: string;
  previousReferenceKey: string;
  staleReference: GeneratedMediaLifecycleConflictReference;
}>;

export type GeneratedMediaLifecycleTextReplacement = Readonly<{
  endIndex: number;
  markdown: string;
  startIndex: number;
}>;

export type GeneratedMediaLifecycleTextReplacements = Readonly<{
  backText: ReadonlyArray<GeneratedMediaLifecycleTextReplacement>;
  frontText: ReadonlyArray<GeneratedMediaLifecycleTextReplacement>;
}>;

type GeneratedMediaLifecycleConflictReference = Readonly<{
  mediaAssetId: string;
  state: Exclude<ManagedMediaReferenceState, "ready">;
}>;

type TextLifecycleChanges = Readonly<{
  candidateReferences: ReadonlyArray<GeneratedMediaLifecycleConflictReference>;
  transitions: ReadonlyArray<LifecycleTransition>;
}>;

type DraftLifecycleApplication = Readonly<{
  candidateReferences: ReadonlyArray<GeneratedMediaLifecycleConflictReference>;
  replacements: ReadonlyArray<GeneratedMediaLifecycleTextReplacement>;
  text: string;
}>;

type LifecycleReplacementCandidate = Readonly<{
  replacement: GeneratedMediaLifecycleTextReplacement;
  sourceMarkdown: string;
}>;

export type GeneratedMediaLifecycleConflict = Readonly<{
  references: ReadonlyArray<GeneratedMediaLifecycleConflictReference>;
}>;

export type GeneratedMediaLifecycleReconciliationResult =
  | Readonly<{
    conflict: GeneratedMediaLifecycleConflict;
    textReplacements: GeneratedMediaLifecycleTextReplacements;
    status: "resolved";
    formState: CardFormState;
  }>
  | Readonly<{
    status: "unresolved";
    conflict: GeneratedMediaLifecycleConflict;
    textReplacements: GeneratedMediaLifecycleTextReplacements;
    formState: CardFormState;
  }>;

function readMarkdownShape(reference: ManagedMediaMarkdownReference): string | null {
  const destinationOwnerRelativeStartIndex = (
    reference.destinationStartIndex - reference.destinationOwnerStartIndex
  );
  const destinationOwnerRelativeEndIndex = (
    reference.destinationEndIndex - reference.destinationOwnerStartIndex
  );
  if (
    destinationOwnerRelativeStartIndex < 0
    || destinationOwnerRelativeEndIndex < destinationOwnerRelativeStartIndex
    || destinationOwnerRelativeEndIndex > reference.destinationOwnerMarkdown.length
  ) {
    return null;
  }

  const destinationOwnerShape = [
    reference.destinationOwnerMarkdown.slice(0, destinationOwnerRelativeStartIndex),
    "<managed-media-destination>",
    reference.destinationOwnerMarkdown.slice(destinationOwnerRelativeEndIndex),
  ].join("");
  if (
    reference.destinationOwnerStartIndex === reference.startIndex
    && reference.destinationOwnerEndIndex === reference.endIndex
  ) {
    return destinationOwnerShape;
  }

  return JSON.stringify([reference.markdown, destinationOwnerShape]);
}

function decodeRawQueryComponent(component: string): string | null {
  try {
    return decodeURIComponent(component.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

type DecodedMarkdownCharacter = Readonly<{
  character: string;
  rawEndIndex: number;
  rawStartIndex: number;
}>;

const markdownEscapeOrReferencePattern = /\\[!-/:-@[-`{-~]|&(?:#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;

function appendDecodedMarkdownToken(
  characters: Array<DecodedMarkdownCharacter>,
  rawToken: string,
  rawStartIndex: number,
): void {
  const decodedToken = decodeString(rawToken);
  if (decodedToken === rawToken) {
    for (let index = 0; index < rawToken.length; index += 1) {
      const character = rawToken[index];
      if (character === undefined) {
        throw new Error(`Managed media lifecycle reconciliation failed: raw Markdown token character was missing at index=${index}`);
      }
      characters.push({
        character,
        rawEndIndex: rawStartIndex + index + 1,
        rawStartIndex: rawStartIndex + index,
      });
    }
    return;
  }

  for (let index = 0; index < decodedToken.length; index += 1) {
    const character = decodedToken[index];
    if (character === undefined) {
      throw new Error(`Managed media lifecycle reconciliation failed: decoded Markdown token character was missing at index=${index}`);
    }
    characters.push({
      character,
      rawEndIndex: rawStartIndex + rawToken.length,
      rawStartIndex,
    });
  }
}

function decodeMarkdownDestination(
  destination: string,
): ReadonlyArray<DecodedMarkdownCharacter> {
  const characters: Array<DecodedMarkdownCharacter> = [];
  let rawIndex = 0;
  markdownEscapeOrReferencePattern.lastIndex = 0;

  for (const match of destination.matchAll(markdownEscapeOrReferencePattern)) {
    const matchIndex = match.index;
    if (matchIndex === undefined) {
      throw new Error("Managed media lifecycle reconciliation failed: Markdown token match had no source index");
    }
    appendDecodedMarkdownToken(
      characters,
      destination.slice(rawIndex, matchIndex),
      rawIndex,
    );
    appendDecodedMarkdownToken(
      characters,
      match[0],
      matchIndex,
    );
    rawIndex = matchIndex + match[0].length;
  }

  appendDecodedMarkdownToken(
    characters,
    destination.slice(rawIndex),
    rawIndex,
  );
  return characters;
}

function decodedCharactersToString(
  characters: ReadonlyArray<DecodedMarkdownCharacter>,
): string {
  return characters.map((character) => character.character).join("");
}

function readComparableDestination(
  reference: ManagedMediaMarkdownReference,
): string | null {
  const destinationCharacters = decodeMarkdownDestination(reference.destination);
  const decodedDestination = decodedCharactersToString(destinationCharacters);
  if (decodedDestination !== reference.decodedDestination) {
    return null;
  }

  const fragmentStartIndex = decodedDestination.indexOf("#");
  const queryStartIndex = decodedDestination.indexOf("?");
  const queryEndIndex = fragmentStartIndex === -1
    ? decodedDestination.length
    : fragmentStartIndex;
  const hasQuery = queryStartIndex !== -1 && queryStartIndex < queryEndIndex;
  if (hasQuery === false) {
    return reference.state === "ready" ? reference.destination : null;
  }

  const queryCharacters = destinationCharacters.slice(queryStartIndex + 1, queryEndIndex);
  const querySegments: Array<Readonly<{
    characters: ReadonlyArray<DecodedMarkdownCharacter>;
    endIndex: number;
    startIndex: number;
  }>> = [];
  let segmentStartIndex = 0;
  for (let index = 0; index <= queryCharacters.length; index += 1) {
    const character = queryCharacters[index]?.character;
    if (index !== queryCharacters.length && character !== "&") {
      continue;
    }
    querySegments.push({
      characters: queryCharacters.slice(segmentStartIndex, index),
      startIndex: segmentStartIndex,
      endIndex: index,
    });
    segmentStartIndex = index + 1;
  }

  const stateSegments: Array<Readonly<{
    index: number;
    state: ManagedMediaReferenceState;
  }>> = [];

  for (let index = 0; index < querySegments.length; index += 1) {
    const segment = querySegments[index];
    if (segment === undefined) {
      throw new Error(`Managed media lifecycle reconciliation failed: query segment was missing at index=${index}`);
    }

    const decodedSegment = decodedCharactersToString(segment.characters);
    const equalsIndex = decodedSegment.indexOf("=");
    const rawKey = equalsIndex === -1 ? decodedSegment : decodedSegment.slice(0, equalsIndex);
    const decodedKey = decodeRawQueryComponent(rawKey);
    if (decodedKey === null) {
      return null;
    }
    if (decodedKey !== "state") {
      continue;
    }

    const rawValue = equalsIndex === -1 ? "" : decodedSegment.slice(equalsIndex + 1);
    const decodedValue = decodeRawQueryComponent(rawValue);
    if (decodedValue === null) {
      return null;
    }
    stateSegments.push({
      index,
      state: decodedValue === "pending" || decodedValue === "failed"
        ? decodedValue
        : "ready",
    });
  }

  if (stateSegments.length === 0) {
    return reference.state === "ready" ? reference.destination : null;
  }
  if (stateSegments.length !== 1) {
    return reference.state === "ready" ? reference.destination : null;
  }

  const parsedStateSegment = stateSegments[0];
  if (parsedStateSegment === undefined || parsedStateSegment.state !== reference.state) {
    return null;
  }
  const stateSegmentIndex = parsedStateSegment.index;
  const stateSegment = stateSegmentIndex === undefined
    ? undefined
    : querySegments[stateSegmentIndex];
  if (stateSegment === undefined) {
    return null;
  }

  let removalStartIndex: number;
  let removalEndIndex: number;
  if (querySegments.length === 1) {
    const queryMarker = destinationCharacters[queryStartIndex];
    const lastStateCharacter = stateSegment.characters.at(-1);
    if (queryMarker === undefined || lastStateCharacter === undefined) {
      return null;
    }
    removalStartIndex = queryMarker.rawStartIndex;
    removalEndIndex = lastStateCharacter.rawEndIndex;
  } else if (stateSegmentIndex < querySegments.length - 1) {
    const firstStateCharacter = stateSegment.characters[0];
    const followingSeparator = queryCharacters[stateSegment.endIndex];
    if (firstStateCharacter === undefined || followingSeparator === undefined) {
      return null;
    }
    removalStartIndex = firstStateCharacter.rawStartIndex;
    removalEndIndex = followingSeparator.rawEndIndex;
  } else {
    const precedingSeparator = queryCharacters[stateSegment.startIndex - 1];
    const lastStateCharacter = stateSegment.characters.at(-1);
    if (precedingSeparator === undefined || lastStateCharacter === undefined) {
      return null;
    }
    removalStartIndex = precedingSeparator.rawStartIndex;
    removalEndIndex = lastStateCharacter.rawEndIndex;
  }

  return `${reference.destination.slice(0, removalStartIndex)}${reference.destination.slice(removalEndIndex)}`;
}

function readLifecycleIdentity(reference: ManagedMediaMarkdownReference): string | null {
  const markdownShape = readMarkdownShape(reference);
  const comparableDestination = readComparableDestination(reference);
  if (markdownShape === null || comparableDestination === null) {
    return null;
  }

  return JSON.stringify([markdownShape, comparableDestination]);
}

function readStaleReference(
  reference: ManagedMediaMarkdownReference,
): GeneratedMediaLifecycleConflictReference | null {
  if (reference.state === "ready") {
    return null;
  }

  return {
    mediaAssetId: reference.mediaAssetId,
    state: reference.state,
  };
}

function conflictReferenceKey(
  reference: GeneratedMediaLifecycleConflictReference,
): string {
  return JSON.stringify([reference.mediaAssetId, reference.state]);
}

function readReferenceSourceKey(
  reference: ManagedMediaMarkdownReference,
): string {
  return JSON.stringify([
    reference.markdown,
    reference.destinationOwnerMarkdown,
    reference.destinationStartIndex - reference.destinationOwnerStartIndex,
    reference.destinationEndIndex - reference.destinationOwnerStartIndex,
  ]);
}

function groupReferencesByLifecycleIdentity(
  references: ReadonlyArray<ManagedMediaMarkdownReference>,
): ReadonlyMap<string, ReadonlyArray<ManagedMediaMarkdownReference>> {
  const groups = new Map<string, Array<ManagedMediaMarkdownReference>>();

  for (const reference of references) {
    const identity = readLifecycleIdentity(reference);
    if (identity === null) {
      continue;
    }

    const group = groups.get(identity);
    if (group === undefined) {
      groups.set(identity, [reference]);
    } else {
      group.push(reference);
    }
  }

  return groups;
}

function removeUnchangedReferences(
  previousReferences: ReadonlyArray<ManagedMediaMarkdownReference>,
  nextReferences: ReadonlyArray<ManagedMediaMarkdownReference>,
): Readonly<{
  nextReferences: ReadonlyArray<ManagedMediaMarkdownReference>;
  previousReferences: ReadonlyArray<ManagedMediaMarkdownReference>;
}> {
  const remainingNextReferenceCounts = new Map<string, number>();
  for (const reference of nextReferences) {
    const referenceKey = readReferenceSourceKey(reference);
    remainingNextReferenceCounts.set(
      referenceKey,
      (remainingNextReferenceCounts.get(referenceKey) ?? 0) + 1,
    );
  }

  const remainingPreviousReferences = previousReferences.filter((reference) => {
    const referenceKey = readReferenceSourceKey(reference);
    const count = remainingNextReferenceCounts.get(referenceKey) ?? 0;
    if (count === 0) {
      return true;
    }

    remainingNextReferenceCounts.set(referenceKey, count - 1);
    return false;
  });

  const remainingPreviousReferenceCounts = new Map<string, number>();
  for (const reference of previousReferences) {
    const referenceKey = readReferenceSourceKey(reference);
    remainingPreviousReferenceCounts.set(
      referenceKey,
      (remainingPreviousReferenceCounts.get(referenceKey) ?? 0) + 1,
    );
  }

  const remainingNextReferences = nextReferences.filter((reference) => {
    const referenceKey = readReferenceSourceKey(reference);
    const count = remainingPreviousReferenceCounts.get(referenceKey) ?? 0;
    if (count === 0) {
      return true;
    }

    remainingPreviousReferenceCounts.set(referenceKey, count - 1);
    return false;
  });

  return {
    previousReferences: remainingPreviousReferences,
    nextReferences: remainingNextReferences,
  };
}

function readLifecycleTransitions(
  previousReferences: ReadonlyArray<ManagedMediaMarkdownReference>,
  nextReferences: ReadonlyArray<ManagedMediaMarkdownReference>,
): ReadonlyArray<LifecycleTransition> {
  const previousGroups = groupReferencesByLifecycleIdentity(previousReferences);
  const nextGroups = groupReferencesByLifecycleIdentity(nextReferences);
  const previousReferenceCounts = new Map<string, number>();
  for (const reference of previousReferences) {
    const referenceKey = readReferenceSourceKey(reference);
    previousReferenceCounts.set(
      referenceKey,
      (previousReferenceCounts.get(referenceKey) ?? 0) + 1,
    );
  }

  const transitions: Array<LifecycleTransition> = [];
  for (const [identity, previousGroup] of previousGroups) {
    const unmatched = removeUnchangedReferences(
      previousGroup,
      nextGroups.get(identity) ?? [],
    );
    if (
      unmatched.previousReferences.length !== 1
      || unmatched.nextReferences.length !== 1
    ) {
      continue;
    }

    const previousReference = unmatched.previousReferences[0];
    const nextReference = unmatched.nextReferences[0];
    if (
      previousReference === undefined
      || nextReference === undefined
      || previousReference.state === nextReference.state
    ) {
      continue;
    }

    const staleReference = readStaleReference(previousReference);
    if (staleReference === null) {
      continue;
    }

    const previousReferenceKey = readReferenceSourceKey(previousReference);
    transitions.push({
      isPreviousReferenceUnique: previousReferenceCounts.get(previousReferenceKey) === 1
        && previousReference.isDestinationReplacementSafe,
      previousReferenceKey,
      nextDestination: nextReference.destination,
      staleReference,
    });
  }

  return transitions;
}

function countReferenceSourceKeys(
  references: ReadonlyArray<ManagedMediaMarkdownReference>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const reference of references) {
    const referenceKey = readReferenceSourceKey(reference);
    counts.set(referenceKey, (counts.get(referenceKey) ?? 0) + 1);
  }
  return counts;
}

function readUnresolvedReferences(
  previousReferences: ReadonlyArray<ManagedMediaMarkdownReference>,
  nextReferences: ReadonlyArray<ManagedMediaMarkdownReference>,
  transitions: ReadonlyArray<LifecycleTransition>,
): ReadonlyArray<GeneratedMediaLifecycleConflictReference> {
  const nextReferenceCounts = countReferenceSourceKeys(nextReferences);
  const transitionCounts = new Map<string, number>();
  for (const transition of transitions) {
    transitionCounts.set(
      transition.previousReferenceKey,
      (transitionCounts.get(transition.previousReferenceKey) ?? 0) + 1,
    );
  }

  const unresolvedReferences = new Map<string, GeneratedMediaLifecycleConflictReference>();
  const previousReferenceCounts = countReferenceSourceKeys(previousReferences);
  const visitedReferenceKeys = new Set<string>();
  for (const reference of previousReferences) {
    const referenceKey = readReferenceSourceKey(reference);
    if (visitedReferenceKeys.has(referenceKey)) {
      continue;
    }
    visitedReferenceKeys.add(referenceKey);

    const staleReference = readStaleReference(reference);
    if (staleReference === null) {
      continue;
    }

    const removedCount = (
      previousReferenceCounts.get(referenceKey) ?? 0
    ) - (nextReferenceCounts.get(referenceKey) ?? 0);
    const transitionCount = transitionCounts.get(referenceKey) ?? 0;
    if (removedCount > transitionCount) {
      unresolvedReferences.set(
        conflictReferenceKey(staleReference),
        staleReference,
      );
    }
  }

  return [...unresolvedReferences.values()];
}

function readLifecycleChanges(
  previousText: string,
  nextText: string,
): TextLifecycleChanges {
  if (previousText === nextText) {
    return {
      candidateReferences: [],
      transitions: [],
    };
  }

  const previousReferences = parseManagedImageMarkdownReferences(previousText);
  const nextReferences = parseManagedImageMarkdownReferences(nextText);
  const transitions = readLifecycleTransitions(previousReferences, nextReferences);
  const candidateReferences = new Map<string, GeneratedMediaLifecycleConflictReference>();
  for (const transition of transitions) {
    candidateReferences.set(
      conflictReferenceKey(transition.staleReference),
      transition.staleReference,
    );
  }
  for (const unresolvedReference of readUnresolvedReferences(
    previousReferences,
    nextReferences,
    transitions,
  )) {
    candidateReferences.set(
      conflictReferenceKey(unresolvedReference),
      unresolvedReference,
    );
  }

  return {
    candidateReferences: [...candidateReferences.values()],
    transitions,
  };
}

function applyLifecycleTransitions(
  text: string,
  changes: TextLifecycleChanges,
): DraftLifecycleApplication {
  const references = parseManagedImageMarkdownReferences(text);
  const transitionByPreviousReferenceKey = new Map<string, LifecycleTransition | null>();
  for (const transition of changes.transitions) {
    if (transition.isPreviousReferenceUnique === false) {
      continue;
    }
    if (transitionByPreviousReferenceKey.has(transition.previousReferenceKey)) {
      transitionByPreviousReferenceKey.set(transition.previousReferenceKey, null);
      continue;
    }
    transitionByPreviousReferenceKey.set(
      transition.previousReferenceKey,
      transition,
    );
  }

  const matchByPreviousReferenceKey = new Map<string, Readonly<{
    reference: ManagedMediaMarkdownReference;
    transition: LifecycleTransition;
  }> | null>();
  for (const reference of references) {
    const previousReferenceKey = readReferenceSourceKey(reference);
    const transition = transitionByPreviousReferenceKey.get(previousReferenceKey);
    if (transition === undefined || transition === null) {
      continue;
    }
    if (matchByPreviousReferenceKey.has(previousReferenceKey)) {
      matchByPreviousReferenceKey.set(previousReferenceKey, null);
      continue;
    }

    matchByPreviousReferenceKey.set(previousReferenceKey, {
      reference,
      transition,
    });
  }

  const replacementCandidates: Array<LifecycleReplacementCandidate> = [];
  for (const match of matchByPreviousReferenceKey.values()) {
    if (match === null || match.reference.isDestinationReplacementSafe === false) {
      continue;
    }
    replacementCandidates.push({
      replacement: {
        startIndex: match.reference.destinationStartIndex,
        endIndex: match.reference.destinationEndIndex,
        markdown: match.transition.nextDestination,
      },
      sourceMarkdown: match.reference.destination,
    });
  }

  const orderedCandidates = replacementCandidates
    .filter((candidate) => (
      candidate.replacement.startIndex >= 0
      && candidate.replacement.endIndex > candidate.replacement.startIndex
      && candidate.replacement.endIndex <= text.length
      && text.slice(
        candidate.replacement.startIndex,
        candidate.replacement.endIndex,
      ) === candidate.sourceMarkdown
    ))
    .sort((left, right) => (
      left.replacement.startIndex - right.replacement.startIndex
      || left.replacement.endIndex - right.replacement.endIndex
    ));
  const replacements: Array<GeneratedMediaLifecycleTextReplacement> = [];
  let groupStartIndex = 0;
  while (groupStartIndex < orderedCandidates.length) {
    const firstCandidate = orderedCandidates[groupStartIndex];
    if (firstCandidate === undefined) {
      throw new Error(`Managed media lifecycle reconciliation failed: replacement candidate was missing at index=${groupStartIndex}`);
    }

    let groupEndIndex = groupStartIndex + 1;
    let maximumSourceEndIndex = firstCandidate.replacement.endIndex;
    while (groupEndIndex < orderedCandidates.length) {
      const candidate = orderedCandidates[groupEndIndex];
      if (
        candidate === undefined
        || candidate.replacement.startIndex >= maximumSourceEndIndex
      ) {
        break;
      }
      maximumSourceEndIndex = Math.max(
        maximumSourceEndIndex,
        candidate.replacement.endIndex,
      );
      groupEndIndex += 1;
    }

    if (groupEndIndex === groupStartIndex + 1) {
      replacements.push(firstCandidate.replacement);
    }
    groupStartIndex = groupEndIndex;
  }

  let nextText = text;
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index];
    if (replacement === undefined) {
      throw new Error(`Managed media lifecycle reconciliation failed: replacement was missing at index=${index}`);
    }
    nextText = `${nextText.slice(0, replacement.startIndex)}${replacement.markdown}${nextText.slice(replacement.endIndex)}`;
  }
  return {
    candidateReferences: changes.candidateReferences,
    replacements,
    text: nextText,
  };
}

function readTextReplacements(
  previousText: string,
  nextText: string,
): ReadonlyArray<GeneratedMediaLifecycleTextReplacement> {
  if (previousText === nextText) {
    return [];
  }

  const previousCharacters = Array.from(previousText);
  const nextCharacters = Array.from(nextText);
  const maximumPrefixLength = Math.min(
    previousCharacters.length,
    nextCharacters.length,
  );
  let commonPrefixCharacterCount = 0;
  let previousPrefixLength = 0;
  let nextPrefixLength = 0;
  while (
    commonPrefixCharacterCount < maximumPrefixLength
    && previousCharacters[commonPrefixCharacterCount]
      === nextCharacters[commonPrefixCharacterCount]
  ) {
    const previousCharacter = previousCharacters[commonPrefixCharacterCount];
    const nextCharacter = nextCharacters[commonPrefixCharacterCount];
    if (previousCharacter === undefined || nextCharacter === undefined) {
      throw new Error("Managed media lifecycle reconciliation failed: common prefix character was missing");
    }
    previousPrefixLength += previousCharacter.length;
    nextPrefixLength += nextCharacter.length;
    commonPrefixCharacterCount += 1;
  }

  let commonSuffixCharacterCount = 0;
  let previousSuffixLength = 0;
  let nextSuffixLength = 0;
  while (
    commonSuffixCharacterCount
      < previousCharacters.length - commonPrefixCharacterCount
    && commonSuffixCharacterCount
      < nextCharacters.length - commonPrefixCharacterCount
  ) {
    const previousCharacter = previousCharacters[
      previousCharacters.length - commonSuffixCharacterCount - 1
    ];
    const nextCharacter = nextCharacters[
      nextCharacters.length - commonSuffixCharacterCount - 1
    ];
    if (previousCharacter === undefined || nextCharacter === undefined) {
      throw new Error("Managed media lifecycle reconciliation failed: common suffix character was missing");
    }
    if (previousCharacter !== nextCharacter) {
      break;
    }
    previousSuffixLength += previousCharacter.length;
    nextSuffixLength += nextCharacter.length;
    commonSuffixCharacterCount += 1;
  }

  const replacement: GeneratedMediaLifecycleTextReplacement = {
    startIndex: previousPrefixLength,
    endIndex: previousText.length - previousSuffixLength,
    markdown: nextText.slice(
      nextPrefixLength,
      nextText.length - nextSuffixLength,
    ),
  };
  const reconciledText = `${previousText.slice(0, replacement.startIndex)}${replacement.markdown}${previousText.slice(replacement.endIndex)}`;
  if (reconciledText !== nextText) {
    throw new Error("Managed media lifecycle reconciliation failed: text replacements did not reproduce the refreshed field");
  }

  return [replacement];
}

function reconcileTextField(
  previousText: string,
  nextText: string,
  draftText: string,
  changes: TextLifecycleChanges,
): DraftLifecycleApplication {
  if (draftText !== previousText) {
    return applyLifecycleTransitions(draftText, changes);
  }

  return {
    candidateReferences: changes.candidateReferences,
    replacements: readTextReplacements(previousText, nextText),
    text: nextText,
  };
}

function areStringArraysEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function reconcileGeneratedMediaLifecycleChanges(
  previousCard: Card,
  nextCard: Card,
  currentFormState: CardFormState,
): GeneratedMediaLifecycleReconciliationResult {
  const frontChanges = readLifecycleChanges(previousCard.frontText, nextCard.frontText);
  const backChanges = readLifecycleChanges(previousCard.backText, nextCard.backText);
  const frontApplication = reconcileTextField(
    previousCard.frontText,
    nextCard.frontText,
    currentFormState.frontText,
    frontChanges,
  );
  const backApplication = reconcileTextField(
    previousCard.backText,
    nextCard.backText,
    currentFormState.backText,
    backChanges,
  );
  const formState = {
    ...currentFormState,
    frontText: frontApplication.text,
    backText: backApplication.text,
    tags: areStringArraysEqual(currentFormState.tags, previousCard.tags)
      ? nextCard.tags
      : currentFormState.tags,
  };
  const candidateReferences = mergeConflictReferences(
    frontApplication.candidateReferences,
    backApplication.candidateReferences,
  );
  const conflict: GeneratedMediaLifecycleConflict = {
    references: candidateReferences,
  };
  const textReplacements: GeneratedMediaLifecycleTextReplacements = {
    frontText: frontApplication.replacements,
    backText: backApplication.replacements,
  };
  const hasUnresolvedReference = (
    hasConflictingReference(formState.frontText, candidateReferences)
    || hasConflictingReference(formState.backText, candidateReferences)
  );
  if (hasUnresolvedReference) {
    return {
      status: "unresolved",
      conflict,
      formState,
      textReplacements,
    };
  }

  return {
    conflict,
    status: "resolved",
    formState,
    textReplacements,
  };
}

function hasConflictingReference(
  text: string,
  conflictingReferences: ReadonlyArray<GeneratedMediaLifecycleConflictReference>,
): boolean {
  if (conflictingReferences.length === 0) {
    return false;
  }

  const conflictKeys = new Set(conflictingReferences.map(conflictReferenceKey));
  return parseManagedImageMarkdownReferences(text).some((reference) => (
    reference.state !== "ready"
    && conflictKeys.has(conflictReferenceKey({
      mediaAssetId: reference.mediaAssetId,
      state: reference.state,
    }))
  ));
}

export function isGeneratedMediaLifecycleConflictPresent(
  conflict: GeneratedMediaLifecycleConflict,
  formState: CardFormState,
): boolean {
  return hasConflictingReference(
    formState.frontText,
    conflict.references,
  ) || hasConflictingReference(
    formState.backText,
    conflict.references,
  );
}

function mergeConflictReferences(
  left: ReadonlyArray<GeneratedMediaLifecycleConflictReference>,
  right: ReadonlyArray<GeneratedMediaLifecycleConflictReference>,
): ReadonlyArray<GeneratedMediaLifecycleConflictReference> {
  const merged = new Map<string, GeneratedMediaLifecycleConflictReference>();
  for (const reference of [...left, ...right]) {
    merged.set(conflictReferenceKey(reference), reference);
  }
  return [...merged.values()];
}

export function mergeGeneratedMediaLifecycleConflicts(
  left: GeneratedMediaLifecycleConflict,
  right: GeneratedMediaLifecycleConflict,
): GeneratedMediaLifecycleConflict {
  return {
    references: mergeConflictReferences(
      left.references,
      right.references,
    ),
  };
}
