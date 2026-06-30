package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.media.MediaAsset

/*
 Keep review content presentation heuristics aligned with:
 - apps/web/src/screens/reviewContentPresentation.ts
 - apps/ios/Flashcards/Flashcards/Review/View/ReviewContentPresentation.swift
 */

private const val reviewShortPlainWordLimit: Int = 4
private const val reviewShortPlainVisibleCharacterLimit: Int = 48

internal val reviewHeadingRegex: Regex = Regex(pattern = """^\s{0,3}(#{1,6})\s+(.+?)\s*$""")
internal val reviewQuoteRegex: Regex = Regex(pattern = """^\s{0,3}>\s?(.*)$""")
internal val reviewBulletRegex: Regex = Regex(pattern = """^\s{0,3}[-*+]\s+(.+?)\s*$""")
internal val reviewOrderedListRegex: Regex = Regex(pattern = """^\s{0,3}\d+\.\s+(.+?)\s*$""")
internal val reviewFenceRegex: Regex = Regex(pattern = """^\s{0,3}(```|~~~)\s*([\w+-]+)?\s*$""")
internal val reviewHorizontalRuleRegex: Regex = Regex(pattern = """^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$""")
internal val reviewTableDelimiterRegex: Regex = Regex(
    pattern = """^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$"""
)
internal val reviewManagedMediaReferenceRegex: Regex = Regex(
    pattern = """(!)?\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)"""
)
private const val reviewManagedMediaSchemePrefix: String = "fcasset:"

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

fun makeReviewRenderedContent(
    text: String,
    mediaAssetsById: Map<String, MediaAsset>
): ReviewRenderedContent {
    return when (classifyReviewContentPresentation(text = text)) {
        ReviewContentPresentationMode.SHORT_PLAIN -> ReviewRenderedContent.ShortPlain(text = text)
        ReviewContentPresentationMode.PARAGRAPH_PLAIN -> ReviewRenderedContent.ParagraphPlain(text = text)
        ReviewContentPresentationMode.RICH -> ReviewRenderedContent.Rich(
            blocks = parseReviewRichBlocks(
                text = text,
                mediaAssetsById = mediaAssetsById
            )
        )
    }
}

private fun hasStrongRichCue(text: String): Boolean {
    if (text.isBlank()) {
        return false
    }
    if (containsReviewManagedMediaReference(text = text)) {
        return true
    }

    return text.lineSequence().any { line ->
        reviewHeadingRegex.matches(line)
            || reviewQuoteRegex.matches(line)
            || reviewBulletRegex.matches(line)
            || reviewOrderedListRegex.matches(line)
            || reviewFenceRegex.matches(line)
            || reviewHorizontalRuleRegex.matches(line)
            || reviewTableDelimiterRegex.matches(line)
    }
}

private fun containsReviewManagedMediaReference(text: String): Boolean {
    return reviewManagedMediaReferenceRegex.findAll(input = text).any { match ->
        val reference: String = match.groups[3]?.value ?: return@any false
        parseReviewManagedMediaAssetId(reference = reference) != null
    }
}

internal fun parseReviewManagedMediaAssetId(reference: String): String? {
    val trimmedReference: String = reference.trim()
    if (trimmedReference.lowercase().startsWith(prefix = reviewManagedMediaSchemePrefix).not()) {
        return null
    }

    var rawAssetId: String = trimmedReference.drop(n = reviewManagedMediaSchemePrefix.length)
    while (rawAssetId.startsWith(prefix = "/")) {
        rawAssetId = rawAssetId.drop(n = 1)
    }

    val fragmentOrQueryStart: Int = rawAssetId.indexOfAny(chars = charArrayOf('?', '#'))
    val mediaAssetId: String = if (fragmentOrQueryStart >= 0) {
        rawAssetId.substring(startIndex = 0, endIndex = fragmentOrQueryStart)
    } else {
        rawAssetId
    }.trim()

    return mediaAssetId.ifEmpty { null }
}

private fun parseReviewRichBlocks(
    text: String,
    mediaAssetsById: Map<String, MediaAsset>
): List<ReviewRichBlock> {
    val normalizedText: String = text.replace("\r\n", "\n").replace('\r', '\n')
    val lines: List<String> = normalizedText.lines()
    var index: Int = 0
    val blocks: MutableList<ReviewRichBlock> = mutableListOf()

    while (index < lines.size) {
        val line: String = lines[index]

        if (line.isBlank()) {
            index += 1
            continue
        }

        val fenceMatch: MatchResult? = reviewFenceRegex.matchEntire(line)
        if (fenceMatch != null) {
            val fence: String = fenceMatch.groupValues[1]
            val languageLabel: String? = fenceMatch.groupValues[2].ifBlank { null }
            val codeLines: MutableList<String> = mutableListOf()
            index += 1

            while (index < lines.size && reviewFenceRegex.matchEntire(lines[index])?.groupValues?.get(1) != fence) {
                codeLines += lines[index]
                index += 1
            }

            if (index < lines.size) {
                index += 1
            }

            blocks += ReviewRichBlock.CodeBlock(
                languageLabel = languageLabel,
                code = codeLines.joinToString(separator = "\n")
            )
            continue
        }

        val managedMediaBlocks: List<ReviewRichBlock>? = splitReviewManagedMediaLine(
            line = line,
            mediaAssetsById = mediaAssetsById
        )
        if (managedMediaBlocks != null) {
            blocks += managedMediaBlocks
            index += 1
            continue
        }

        val headingMatch: MatchResult? = reviewHeadingRegex.matchEntire(line)
        if (headingMatch != null) {
            blocks += ReviewRichBlock.Heading(
                level = headingMatch.groupValues[1].length,
                segments = parseInlineSegments(text = headingMatch.groupValues[2])
            )
            index += 1
            continue
        }

        if (reviewQuoteRegex.matches(line)) {
            val quoteLines: MutableList<String> = mutableListOf()

            while (index < lines.size) {
                val quoteMatch: MatchResult = reviewQuoteRegex.matchEntire(lines[index]) ?: break
                quoteLines += quoteMatch.groupValues[1]
                index += 1
            }

            blocks += ReviewRichBlock.Quote(
                segments = parseInlineSegments(text = quoteLines.joinToString(separator = "\n"))
            )
            continue
        }

        val bulletMatch: MatchResult? = reviewBulletRegex.matchEntire(line)
        val orderedMatch: MatchResult? = reviewOrderedListRegex.matchEntire(line)
        if (bulletMatch != null || orderedMatch != null) {
            val ordered: Boolean = orderedMatch != null
            val items: MutableList<List<ReviewInlineSegment>> = mutableListOf()

            while (index < lines.size) {
                val itemMatch: MatchResult = if (ordered) {
                    reviewOrderedListRegex.matchEntire(lines[index])
                } else {
                    reviewBulletRegex.matchEntire(lines[index])
                } ?: break

                items += parseInlineSegments(text = itemMatch.groupValues[1])
                index += 1
            }

            blocks += ReviewRichBlock.BulletList(
                ordered = ordered,
                items = items
            )
            continue
        }

        val paragraphLines: MutableList<String> = mutableListOf()
        while (index < lines.size && shouldContinueParagraph(line = lines[index])) {
            paragraphLines += lines[index]
            index += 1
        }

        blocks += ReviewRichBlock.Paragraph(
            segments = parseInlineSegments(text = paragraphLines.joinToString(separator = "\n"))
        )
    }

    return if (blocks.isEmpty()) {
        listOf(
            ReviewRichBlock.Paragraph(
                segments = parseInlineSegments(text = text)
            )
        )
    } else {
        blocks
    }
}

private fun shouldContinueParagraph(line: String): Boolean {
    if (line.isBlank()) {
        return false
    }

    return reviewFenceRegex.matches(line).not()
        && containsReviewManagedMediaReference(text = line).not()
        && reviewHeadingRegex.matches(line).not()
        && reviewQuoteRegex.matches(line).not()
        && reviewBulletRegex.matches(line).not()
        && reviewOrderedListRegex.matches(line).not()
}

private fun splitReviewManagedMediaLine(
    line: String,
    mediaAssetsById: Map<String, MediaAsset>
): List<ReviewRichBlock>? {
    val matches: List<MatchResult> = reviewManagedMediaReferenceRegex.findAll(input = line).toList()
    if (matches.isEmpty()) {
        return null
    }

    val blocks: MutableList<ReviewRichBlock> = mutableListOf()
    var currentIndex: Int = 0
    var didFindManagedMedia: Boolean = false

    matches.forEach { match ->
        val reference: String = match.groups[3]?.value ?: return@forEach
        val mediaAssetId: String = parseReviewManagedMediaAssetId(reference = reference) ?: return@forEach
        val matchStart: Int = match.range.first
        val matchEndExclusive: Int = match.range.last + 1

        appendReviewManagedMediaTextBlock(
            text = line.substring(startIndex = currentIndex, endIndex = matchStart),
            blocks = blocks
        )
        blocks += ReviewRichBlock.ManagedMedia(
            reference = ReviewManagedMediaReference(
                mediaAssetId = mediaAssetId,
                label = match.groups[2]?.value?.trim()?.ifEmpty { null },
                isImageSyntax = match.groups[1] != null,
                mediaAsset = mediaAssetsById[mediaAssetId]
            )
        )
        currentIndex = matchEndExclusive
        didFindManagedMedia = true
    }

    if (didFindManagedMedia.not()) {
        return null
    }

    appendReviewManagedMediaTextBlock(
        text = line.substring(startIndex = currentIndex),
        blocks = blocks
    )
    return blocks
}

private fun appendReviewManagedMediaTextBlock(
    text: String,
    blocks: MutableList<ReviewRichBlock>
) {
    if (text.trim().isEmpty()) {
        return
    }

    blocks += ReviewRichBlock.Paragraph(
        segments = parseInlineSegments(text = text)
    )
}

private fun parseInlineSegments(text: String): List<ReviewInlineSegment> {
    if (text.contains('`').not()) {
        return listOf(
            ReviewInlineSegment(
                text = text,
                isCode = false
            )
        )
    }

    val segments: MutableList<ReviewInlineSegment> = mutableListOf()
    val currentText: StringBuilder = StringBuilder()
    var isInsideCode: Boolean = false

    text.forEach { character ->
        if (character == '`') {
            if (currentText.isNotEmpty()) {
                segments += ReviewInlineSegment(
                    text = currentText.toString(),
                    isCode = isInsideCode
                )
                currentText.clear()
            }
            isInsideCode = isInsideCode.not()
        } else {
            currentText.append(character)
        }
    }

    if (currentText.isNotEmpty()) {
        segments += ReviewInlineSegment(
            text = currentText.toString(),
            isCode = isInsideCode
        )
    }

    return if (segments.isEmpty()) {
        listOf(
            ReviewInlineSegment(
                text = text,
                isCode = false
            )
        )
    } else {
        segments
    }
}

fun reviewRenderedContentDebugText(content: ReviewRenderedContent): String {
    return when (content) {
        is ReviewRenderedContent.ShortPlain -> content.text
        is ReviewRenderedContent.ParagraphPlain -> content.text
        is ReviewRenderedContent.Rich -> content.blocks.joinToString(separator = "\n") { block ->
            when (block) {
                is ReviewRichBlock.Paragraph -> inlineSegmentsDebugText(segments = block.segments)
                is ReviewRichBlock.Heading -> inlineSegmentsDebugText(segments = block.segments)
                is ReviewRichBlock.BulletList -> block.items.joinToString(separator = "\n") { item ->
                    inlineSegmentsDebugText(segments = item)
                }

                is ReviewRichBlock.Quote -> inlineSegmentsDebugText(segments = block.segments)
                is ReviewRichBlock.CodeBlock -> block.code
                is ReviewRichBlock.ManagedMedia -> block.reference.label.orEmpty()
            }
        }
    }
}

private fun inlineSegmentsDebugText(segments: List<ReviewInlineSegment>): String {
    return buildString {
        segments.forEach { segment ->
            append(segment.text)
        }
    }
}
