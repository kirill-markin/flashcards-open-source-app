import { hasEligibleReviewMath } from "./reviewMathBlocks";

/**
 * Keep review content presentation heuristics aligned with:
 * - apps/ios/Flashcards/Flashcards/Review/View/ReviewContentPresentation.swift
 * - apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/presentation/ReviewContentParser.kt
 */
export type ReviewContentPresentationMode = "shortPlain" | "paragraphPlain" | "markdown";

const markdownHeadingPattern = /^\s{0,3}#{1,6}\s+\S/m;
const markdownBlockquotePattern = /^\s{0,3}>\s+\S/m;
const markdownUnorderedListPattern = /^\s{0,3}[-*+]\s+\S/m;
const markdownOrderedListPattern = /^\s{0,3}\d+\.\s+\S/m;
const markdownFencedCodePattern = /^\s{0,3}(?:```|~~~)/m;
const markdownLinkOrMediaPattern = /!?\[[^\]]*]\([^)]+\)/;
const markdownReferenceLinkOrMediaPattern = /!?\[[^\]]+]\[[^\]]*]/;
const markdownReferenceDefinitionPattern = /^\s{0,3}\[[^\]]+]:\s+\S/m;
const markdownThematicBreakPattern = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m;
const markdownTableSeparatorPattern = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/m;
const newlinePattern = /[\r\n]/;
const whitespacePattern = /\s+/;
const shortPlainWordLimit = 4;
const shortPlainVisibleCharacterLimit = 48;

function hasStrongMarkdownCue(text: string): boolean {
  return markdownHeadingPattern.test(text)
    || markdownBlockquotePattern.test(text)
    || markdownUnorderedListPattern.test(text)
    || markdownOrderedListPattern.test(text)
    || markdownFencedCodePattern.test(text)
    || markdownLinkOrMediaPattern.test(text)
    || markdownReferenceLinkOrMediaPattern.test(text)
    || markdownReferenceDefinitionPattern.test(text)
    || markdownThematicBreakPattern.test(text)
    || markdownTableSeparatorPattern.test(text);
}

export function classifyReviewContentPresentation(text: string): ReviewContentPresentationMode {
  const trimmedText = text.trim();

  if (trimmedText.includes("`")) {
    return "markdown";
  }

  if (hasStrongMarkdownCue(trimmedText)) {
    return "markdown";
  }

  if (text.includes("$") && hasEligibleReviewMath(text)) {
    return "markdown";
  }

  if (trimmedText === "") {
    return "paragraphPlain";
  }

  if (newlinePattern.test(trimmedText)) {
    return "paragraphPlain";
  }

  const wordCount = trimmedText.split(whitespacePattern).length;
  if (wordCount < 1 || wordCount > shortPlainWordLimit) {
    return "paragraphPlain";
  }

  if (trimmedText.length > shortPlainVisibleCharacterLimit) {
    return "paragraphPlain";
  }

  return "shortPlain";
}
