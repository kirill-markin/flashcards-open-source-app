package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.ManagedMediaReference
import com.flashcardsopensourceapp.data.local.model.media.parseManagedMediaReference

/*
 Keep review content presentation heuristics aligned with:
 - apps/web/src/screens/review/components/card/reviewContentPresentation.ts
 - apps/ios/Flashcards/Flashcards/Review/View/ReviewContentPresentation.swift
 */

private const val reviewShortPlainWordLimit: Int = 4
private const val reviewShortPlainVisibleCharacterLimit: Int = 48

internal val reviewHeadingRegex: Regex = Regex(pattern = """^\s{0,3}(#{1,6})\s+(.+?)\s*$""")
internal val reviewQuoteRegex: Regex = Regex(pattern = """^\s{0,3}>\s?(.*)$""")
internal val reviewBulletRegex: Regex = Regex(pattern = """^\s{0,3}[-*+]\s+(.+?)\s*$""")
internal val reviewOrderedListRegex: Regex = Regex(pattern = """^\s{0,3}\d+\.\s+(.+?)\s*$""")
internal val reviewHorizontalRuleRegex: Regex = Regex(pattern = """^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$""")
internal val reviewTableDelimiterRegex: Regex = Regex(
    pattern = """^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$"""
)
internal val reviewManagedMediaReferenceRegex: Regex = Regex(
    pattern = """(!)?\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)"""
)
private val reviewMarkdownLinkOrImageRegex: Regex = Regex(
    pattern = """!?\[[^\]]*]\([^)]+\)"""
)
private val reviewFenceOpeningRegex: Regex = Regex(pattern = """^\s{0,3}(`{3,}|~{3,})(.*)$""")
private val reviewFenceClosingRegex: Regex = Regex(pattern = """^\s{0,3}(`{3,}|~{3,})\s*$""")
private data class ReviewManagedMediaMatch(
    val range: IntRange,
    val reference: ReviewManagedMediaReference
)

fun classifyReviewContentPresentation(text: String): ReviewContentPresentationMode {
    val trimmedText: String = text.trim()

    if (trimmedText.contains('`')) {
        return ReviewContentPresentationMode.RICH
    }
    if (hasStrongRichCue(text = trimmedText)) {
        return ReviewContentPresentationMode.RICH
    }
    if (trimmedText.isEmpty()) {
        return ReviewContentPresentationMode.PARAGRAPH_PLAIN
    }
    if (trimmedText.contains('\n') || trimmedText.contains('\r')) {
        return ReviewContentPresentationMode.PARAGRAPH_PLAIN
    }

    val wordCount: Int = trimmedText.split(Regex("""\s+""")).count()
    if (wordCount < 1 || wordCount > reviewShortPlainWordLimit) {
        return ReviewContentPresentationMode.PARAGRAPH_PLAIN
    }
    if (trimmedText.length > reviewShortPlainVisibleCharacterLimit) {
        return ReviewContentPresentationMode.PARAGRAPH_PLAIN
    }

    return ReviewContentPresentationMode.SHORT_PLAIN
}

internal fun prepareReviewContent(
    text: String,
    mediaAssetsById: Map<String, MediaAsset>
): PreparedReviewContent {
    val mathExtraction: ReviewMathBlockExtraction = extractReviewMathBlocks(markdown = text)
    val renderedContent: ReviewRenderedContent = makeReviewRenderedContent(
        text = text,
        mediaAssetsById = mediaAssetsById,
        mathBlocks = mathExtraction.blocks,
        requiresMarkdownRendering = mathExtraction.requiresMarkdownRendering
    )
    return PreparedReviewContent(
        renderedContent = renderedContent,
        speakableText = makeReviewSpeakableText(mathBlocks = mathExtraction.blocks)
    )
}

private fun makeReviewRenderedContent(
    text: String,
    mediaAssetsById: Map<String, MediaAsset>,
    mathBlocks: List<ReviewMathBlock>,
    requiresMarkdownRendering: Boolean
): ReviewRenderedContent {
    if (mathBlocks.any { block -> block is ReviewMathBlock.Formula }) {
        return makeReviewMathMarkdownContent(
            mathBlocks = mathBlocks,
            mediaAssetsById = mediaAssetsById
        )
    }

    val managedMarkdown: ReviewRenderedContent.ManagedMarkdown? = makeReviewManagedMarkdownContent(
        text = text,
        mediaAssetsById = mediaAssetsById
    )
    if (managedMarkdown != null) {
        // Managed media keeps the segmented renderer authoritative; V1 does not rebuild document-wide reference context.
        return managedMarkdown
    }
    if (requiresMarkdownRendering) {
        return ReviewRenderedContent.Markdown(markdown = text)
    }

    val plainText: String = (mathBlocks.single() as ReviewMathBlock.Markdown).normalizedMarkdown
    return when (classifyReviewContentPresentation(text = text)) {
        ReviewContentPresentationMode.SHORT_PLAIN -> ReviewRenderedContent.ShortPlain(text = plainText)
        ReviewContentPresentationMode.PARAGRAPH_PLAIN -> {
            ReviewRenderedContent.ParagraphPlain(text = plainText)
        }
        ReviewContentPresentationMode.RICH -> ReviewRenderedContent.Markdown(markdown = text)
    }
}

private fun makeReviewMathMarkdownContent(
    mathBlocks: List<ReviewMathBlock>,
    mediaAssetsById: Map<String, MediaAsset>
): ReviewRenderedContent.ManagedMarkdown {
    val renderedBlocks: List<ReviewManagedMarkdownBlock> = buildList {
        mathBlocks.forEach { block ->
            when (block) {
                is ReviewMathBlock.Markdown -> addAll(
                    reviewManagedMarkdownBlocks(
                        text = block.markdown,
                        mediaAssetsById = mediaAssetsById
                    )
                )

                is ReviewMathBlock.Formula -> add(
                    ReviewManagedMarkdownBlock.Formula(
                        source = block.source,
                        delimitedSource = block.delimitedSource
                    )
                )
            }
        }
    }
    return ReviewRenderedContent.ManagedMarkdown(blocks = renderedBlocks)
}

private fun reviewManagedMarkdownBlocks(
    text: String,
    mediaAssetsById: Map<String, MediaAsset>
): List<ReviewManagedMarkdownBlock> {
    val managedContent: ReviewRenderedContent.ManagedMarkdown? = makeReviewManagedMarkdownContent(
        text = text,
        mediaAssetsById = mediaAssetsById
    )
    if (managedContent != null) {
        return managedContent.blocks
    }
    return if (text.isBlank()) {
        emptyList()
    } else {
        listOf(ReviewManagedMarkdownBlock.Markdown(markdown = text))
    }
}

private fun hasStrongRichCue(text: String): Boolean {
    if (text.isBlank()) {
        return false
    }
    if (reviewMarkdownLinkOrImageRegex.containsMatchIn(input = text)) {
        return true
    }

    return text.lineSequence().any { line ->
        reviewHeadingRegex.matches(line)
            || reviewQuoteRegex.matches(line)
            || reviewBulletRegex.matches(line)
            || reviewOrderedListRegex.matches(line)
            || reviewFenceMarker(line = line) != null
            || reviewHorizontalRuleRegex.matches(line)
            || reviewTableDelimiterRegex.matches(line)
    }
}

internal fun reviewFenceMarker(line: String): String? {
    val match: MatchResult = reviewFenceOpeningRegex.matchEntire(input = line) ?: return null
    val marker: String = match.groupValues[1]
    val info: String = match.groupValues[2]
    if (marker.first() == '`' && info.contains('`')) {
        return null
    }

    return marker
}

internal fun isReviewFenceClosingLine(
    line: String,
    openingMarker: String
): Boolean {
    val match: MatchResult = reviewFenceClosingRegex.matchEntire(input = line) ?: return false
    val closingMarker: String = match.groupValues[1]
    return closingMarker.first() == openingMarker.first() &&
        closingMarker.length >= openingMarker.length
}

internal fun parseReviewManagedMediaAssetId(reference: String): String? {
    return parseManagedMediaReference(reference = reference)?.mediaAssetId
}

private fun makeReviewManagedMarkdownContent(
    text: String,
    mediaAssetsById: Map<String, MediaAsset>
): ReviewRenderedContent.ManagedMarkdown? {
    val matches: List<ReviewManagedMediaMatch> = findReviewManagedMediaMatches(
        text = text,
        mediaAssetsById = mediaAssetsById
    )
    if (matches.isEmpty()) {
        return null
    }

    var currentIndex: Int = 0
    val blocks: List<ReviewManagedMarkdownBlock> = buildList {
        matches.forEach { match ->
            val precedingMarkdown: String = text.substring(
                startIndex = currentIndex,
                endIndex = match.range.first
            )
            if (precedingMarkdown.isNotBlank()) {
                add(ReviewManagedMarkdownBlock.Markdown(markdown = precedingMarkdown))
            }
            add(ReviewManagedMarkdownBlock.ManagedMedia(reference = match.reference))
            currentIndex = match.range.last + 1
        }

        val trailingMarkdown: String = text.substring(startIndex = currentIndex)
        if (trailingMarkdown.isNotBlank()) {
            add(ReviewManagedMarkdownBlock.Markdown(markdown = trailingMarkdown))
        }
    }

    return ReviewRenderedContent.ManagedMarkdown(blocks = blocks)
}

private fun findReviewManagedMediaMatches(
    text: String,
    mediaAssetsById: Map<String, MediaAsset>
): List<ReviewManagedMediaMatch> {
    return buildList {
        var activeFenceMarker: String? = null
        var lineStart: Int = 0

        while (lineStart <= text.length) {
            val lineEnd: Int = text.indexOfAny(
                chars = charArrayOf('\r', '\n'),
                startIndex = lineStart
            ).let { index ->
                if (index < 0) text.length else index
            }
            val line: String = text.substring(startIndex = lineStart, endIndex = lineEnd)
            val fenceMarker: String? = reviewFenceMarker(line = line)
            val currentFenceMarker: String? = activeFenceMarker

            if (currentFenceMarker != null) {
                if (isReviewFenceClosingLine(line = line, openingMarker = currentFenceMarker)) {
                    activeFenceMarker = null
                }
            } else if (fenceMarker != null) {
                activeFenceMarker = fenceMarker
            } else {
                reviewManagedMediaReferenceRegex.findAll(input = line).forEach { match ->
                    val rawReference: String = match.groups[3]?.value ?: return@forEach
                    val parsedReference: ManagedMediaReference = parseManagedMediaReference(
                        reference = rawReference
                    ) ?: return@forEach
                    add(
                        ReviewManagedMediaMatch(
                            range = (lineStart + match.range.first)..(lineStart + match.range.last),
                            reference = ReviewManagedMediaReference(
                                mediaAssetId = parsedReference.mediaAssetId,
                                state = parsedReference.state,
                                label = match.groups[2]?.value?.trim()?.ifEmpty { null },
                                isImageSyntax = match.groups[1] != null,
                                mediaAsset = mediaAssetsById[parsedReference.mediaAssetId]
                            )
                        )
                    )
                }
            }

            if (lineEnd == text.length) {
                break
            }
            lineStart = if (text[lineEnd] == '\r' &&
                lineEnd + 1 < text.length &&
                text[lineEnd + 1] == '\n'
            ) {
                lineEnd + 2
            } else {
                lineEnd + 1
            }
        }
    }
}
