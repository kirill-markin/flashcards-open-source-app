package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.core.ui.content.InlineMathFormula
import com.flashcardsopensourceapp.core.ui.content.MathBlock
import com.flashcardsopensourceapp.core.ui.content.MathBlockExtraction
import com.flashcardsopensourceapp.core.ui.content.countInlineMathMarkers
import com.flashcardsopensourceapp.core.ui.content.extractMathBlocks
import com.flashcardsopensourceapp.core.ui.content.inlineMathMarker
import com.flashcardsopensourceapp.core.ui.content.inlineMathTag
import com.flashcardsopensourceapp.core.ui.content.isMarkdownFenceClosingLine
import com.flashcardsopensourceapp.core.ui.content.markdownFenceMarker
import com.flashcardsopensourceapp.core.ui.content.markdownHorizontalRuleRegex
import com.flashcardsopensourceapp.core.ui.content.markdownTableDelimiterRegex
import com.flashcardsopensourceapp.core.ui.content.removeInlineMathMarkers
import com.flashcardsopensourceapp.data.local.model.media.ManagedMediaReference
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.parseManagedMediaReference
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMFlavourDescriptor
import org.intellij.markdown.parser.CancellationToken
import org.intellij.markdown.parser.MarkdownParser

/*
 Keep review content presentation heuristics aligned with:
 - apps/web/src/screens/review/components/card/reviewContentPresentation.ts
 - apps/ios/Flashcards/Flashcards/Review/View/Content/ReviewContentPresentation.swift
 */

private const val reviewShortPlainWordLimit: Int = 4
private const val reviewShortPlainVisibleCharacterLimit: Int = 48

internal val reviewHeadingRegex: Regex = Regex(pattern = """^\s{0,3}(#{1,6})\s+(.+?)\s*$""")
internal val reviewQuoteRegex: Regex = Regex(pattern = """^\s{0,3}>\s?(.*)$""")
internal val reviewBulletRegex: Regex = Regex(pattern = """^\s{0,3}[-*+]\s+(.+?)\s*$""")
internal val reviewOrderedListRegex: Regex = Regex(pattern = """^\s{0,3}\d+\.\s+(.+?)\s*$""")
internal val reviewManagedMediaReferenceRegex: Regex = Regex(
    pattern = """(!)?\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)"""
)
private val reviewMarkdownLinkOrImageRegex: Regex = Regex(
    pattern = """!?\[[^\]]*]\([^)]+\)"""
)
// Images joined by spaces/tabs and at most one line break stay in one Markdown paragraph.
private val reviewSameParagraphImageSeparatorRegex: Regex = Regex(pattern = """[ \t]*(?:\r\n|\r|\n)?[ \t]*""")
private data class ReviewManagedMediaMatch(
    val range: IntRange,
    val reference: ReviewManagedMediaReference
)
private data class ReviewManagedMediaSegment(
    val range: IntRange,
    val block: ReviewManagedMarkdownBlock
)

fun classifyReviewContentPresentation(text: String): ReviewContentPresentationMode {
    val trimmedText: String = text.trim()

    if (trimmedText.contains('`')) {
        return ReviewContentPresentationMode.RICH
    }
    if (hasStrongRichCue(text = trimmedText) || hasInlineMarkdownFormatting(text = trimmedText)) {
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
    // An accepted inline formula stands in as one marker character, so a marker the card text
    // already holds would consume a formula slot. Removing it once, before segmentation, keeps
    // every offset that segmentation, rendering and speech derive from this text consistent.
    val sanitizedText: String = removeInlineMathMarkers(text = text)
    val mathExtraction: MathBlockExtraction = extractMathBlocks(
        markdown = sanitizedText
    )
    val renderedContent: ReviewRenderedContent = makeReviewRenderedContent(
        text = sanitizedText,
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
    mathBlocks: List<MathBlock>,
    requiresMarkdownRendering: Boolean
): ReviewRenderedContent {
    if (mathBlocks.any { block -> block is MathBlock.Formula }) {
        return makeReviewMathMarkdownContent(
            mathBlocks = mathBlocks,
            mediaAssetsById = mediaAssetsById
        )
    }

    val managedMarkdown: ReviewRenderedContent.ManagedMarkdown? = makeReviewManagedMarkdownContent(
        text = text,
        inlineFormulas = emptyList(),
        mediaAssetsById = mediaAssetsById
    )
    if (managedMarkdown != null) {
        // Managed media keeps the segmented renderer authoritative; V1 does not rebuild document-wide reference context.
        return managedMarkdown
    }
    if (requiresMarkdownRendering) {
        return ReviewRenderedContent.Markdown(markdown = text)
    }

    val plainText: String = (mathBlocks.single() as MathBlock.Markdown).normalizedMarkdown
    return when (classifyReviewContentPresentation(text = text)) {
        ReviewContentPresentationMode.SHORT_PLAIN -> ReviewRenderedContent.ShortPlain(text = plainText)
        ReviewContentPresentationMode.PARAGRAPH_PLAIN -> {
            ReviewRenderedContent.ParagraphPlain(text = plainText)
        }
        ReviewContentPresentationMode.RICH -> ReviewRenderedContent.Markdown(markdown = text)
    }
}

private fun makeReviewMathMarkdownContent(
    mathBlocks: List<MathBlock>,
    mediaAssetsById: Map<String, MediaAsset>
): ReviewRenderedContent.ManagedMarkdown {
    val renderedBlocks: MutableList<ReviewManagedMarkdownBlock> = mutableListOf()
    val pendingMarkdown: StringBuilder = StringBuilder()
    val pendingFormulas: MutableList<InlineMathFormula> = mutableListOf()
    var inlineFormulaIndex: Int = 0

    fun flushPendingMarkdown() {
        renderedBlocks.addAll(
            elements = reviewManagedMarkdownBlocks(
                text = pendingMarkdown.toString(),
                inlineFormulas = pendingFormulas.toList(),
                mediaAssetsById = mediaAssetsById
            )
        )
        pendingMarkdown.clear()
        pendingFormulas.clear()
    }

    mathBlocks.forEach { block ->
        when (block) {
            is MathBlock.Markdown -> pendingMarkdown.append(block.markdown)

            // An accepted inline span stays inside its paragraph, standing in as one marker
            // character; only display math is its own top-level block.
            is MathBlock.Formula -> if (block.continuesParagraph) {
                pendingFormulas.add(
                    element = InlineMathFormula(
                        tag = inlineMathTag(index = inlineFormulaIndex),
                        source = block.source,
                        delimitedSource = block.delimitedSource
                    )
                )
                inlineFormulaIndex += 1
                pendingMarkdown.append(inlineMathMarker)
            } else {
                flushPendingMarkdown()
                renderedBlocks.add(
                    element = ReviewManagedMarkdownBlock.Formula(
                        source = block.source,
                        delimitedSource = block.delimitedSource
                    )
                )
            }
        }
    }
    flushPendingMarkdown()

    return ReviewRenderedContent.ManagedMarkdown(blocks = renderedBlocks.toList())
}

private fun reviewManagedMarkdownBlocks(
    text: String,
    inlineFormulas: List<InlineMathFormula>,
    mediaAssetsById: Map<String, MediaAsset>
): List<ReviewManagedMarkdownBlock> {
    val managedContent: ReviewRenderedContent.ManagedMarkdown? = makeReviewManagedMarkdownContent(
        text = text,
        inlineFormulas = inlineFormulas,
        mediaAssetsById = mediaAssetsById
    )
    if (managedContent != null) {
        return managedContent.blocks
    }
    return if (text.isBlank()) {
        emptyList()
    } else {
        listOf(
            ReviewManagedMarkdownBlock.Markdown(
                markdown = text,
                inlineFormulas = inlineFormulas
            )
        )
    }
}

private fun hasInlineMarkdownFormatting(text: String): Boolean {
    if (text.none { character -> character in "*_~" }) {
        return false
    }

    return hasInlineMarkdownFormattingNode(node = parseReviewMarkdownTree(markdown = text))
}

private fun parseReviewMarkdownTree(markdown: CharSequence): ASTNode {
    return MarkdownParser(
        flavour = GFMFlavourDescriptor(),
        assertionsEnabled = true,
        cancellationToken = CancellationToken.NonCancellable
    ).buildMarkdownTreeFromString(markdown)
}

private fun hasInlineMarkdownFormattingNode(node: ASTNode): Boolean {
    return node.type == MarkdownElementTypes.EMPH
        || node.type == MarkdownElementTypes.STRONG
        || node.type == GFMElementTypes.STRIKETHROUGH
        || node.children.any { child -> hasInlineMarkdownFormattingNode(node = child) }
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
            || markdownFenceMarker(line = line) != null
            || markdownHorizontalRuleRegex.matches(line)
            || markdownTableDelimiterRegex.matches(line)
    }
}

internal fun parseReviewManagedMediaAssetId(reference: String): String? {
    return parseManagedMediaReference(reference = reference)?.mediaAssetId
}

private fun makeReviewManagedMarkdownContent(
    text: String,
    inlineFormulas: List<InlineMathFormula>,
    mediaAssetsById: Map<String, MediaAsset>
): ReviewRenderedContent.ManagedMarkdown? {
    val matches: List<ReviewManagedMediaMatch> = findReviewManagedMediaMatches(
        text = text,
        mediaAssetsById = mediaAssetsById
    )
    if (matches.isEmpty()) {
        return null
    }
    val segments: List<ReviewManagedMediaSegment> = groupReviewManagedMediaMatches(
        text = text,
        matches = matches
    )

    var currentIndex: Int = 0
    var formulaIndex: Int = 0
    val blocks: List<ReviewManagedMarkdownBlock> = buildList {
        segments.forEach { segment ->
            val precedingMarkdown: String = text.substring(
                startIndex = currentIndex,
                endIndex = segment.range.first
            )
            val precedingFormulaCount: Int = countInlineMathMarkers(text = precedingMarkdown)
            if (precedingMarkdown.isNotBlank()) {
                add(
                    ReviewManagedMarkdownBlock.Markdown(
                        markdown = precedingMarkdown,
                        inlineFormulas = inlineFormulas.subList(
                            fromIndex = formulaIndex,
                            toIndex = formulaIndex + precedingFormulaCount
                        )
                    )
                )
            }
            formulaIndex += precedingFormulaCount
            add(segment.block)
            currentIndex = segment.range.last + 1
        }

        val trailingMarkdown: String = text.substring(startIndex = currentIndex)
        if (trailingMarkdown.isNotBlank()) {
            add(
                ReviewManagedMarkdownBlock.Markdown(
                    markdown = trailingMarkdown,
                    inlineFormulas = inlineFormulas.subList(
                        fromIndex = formulaIndex,
                        toIndex = inlineFormulas.size
                    )
                )
            )
        }
    }

    return ReviewRenderedContent.ManagedMarkdown(blocks = blocks)
}

/**
 * Consecutive image references that are the whole content of one Markdown paragraph become a
 * gallery; every other reference stays its own block.
 */
private fun groupReviewManagedMediaMatches(
    text: String,
    matches: List<ReviewManagedMediaMatch>
): List<ReviewManagedMediaSegment> {
    val runs: List<List<ReviewManagedMediaMatch>> = matches.fold(
        initial = emptyList()
    ) { currentRuns, match ->
        val currentRun: List<ReviewManagedMediaMatch>? = currentRuns.lastOrNull()
        val previousMatch: ReviewManagedMediaMatch? = currentRun?.last()
        if (currentRun != null &&
            previousMatch != null &&
            previousMatch.reference.isImageSyntax &&
            match.reference.isImageSyntax &&
            reviewSameParagraphImageSeparatorRegex.matches(
                input = text.substring(startIndex = previousMatch.range.last + 1, endIndex = match.range.first)
            )
        ) {
            currentRuns.dropLast(n = 1) + listOf(currentRun + match)
        } else {
            currentRuns + listOf(listOf(match))
        }
    }
    val paragraphContentRanges: Set<IntRange> = if (runs.any { run -> run.size > 1 }) {
        reviewMarkdownParagraphContentRanges(text = text)
    } else {
        emptySet()
    }

    return runs.flatMap { run ->
        val runRange: IntRange = run.first().range.first..run.last().range.last
        if (run.size > 1 && runRange in paragraphContentRanges) {
            listOf(
                ReviewManagedMediaSegment(
                    range = runRange,
                    block = ReviewManagedMarkdownBlock.ManagedMediaGallery(
                        references = run.map(ReviewManagedMediaMatch::reference)
                    )
                )
            )
        } else {
            run.map { match ->
                ReviewManagedMediaSegment(
                    range = match.range,
                    block = ReviewManagedMarkdownBlock.ManagedMedia(reference = match.reference)
                )
            }
        }
    }
}

/** Each paragraph's range without its surrounding whitespace. */
private fun reviewMarkdownParagraphContentRanges(text: String): Set<IntRange> {
    // A same-length line-ending rewrite keeps parser offsets equal to offsets in [text].
    val parserText: String = text
        .replace(oldValue = "\r\n", newValue = " \n")
        .replace(oldChar = '\r', newChar = '\n')
    return reviewMarkdownParagraphNodes(node = parseReviewMarkdownTree(markdown = parserText))
        .map { node ->
            val paragraphText: String = parserText.substring(
                startIndex = node.startOffset,
                endIndex = node.endOffset
            )
            val contentStart: Int = node.startOffset + paragraphText.length - paragraphText.trimStart().length
            val contentEndExclusive: Int = node.endOffset - (paragraphText.length - paragraphText.trimEnd().length)
            contentStart until contentEndExclusive
        }
        .toSet()
}

private fun reviewMarkdownParagraphNodes(node: ASTNode): List<ASTNode> {
    if (node.type == MarkdownElementTypes.PARAGRAPH) {
        return listOf(node)
    }
    return node.children.flatMap { child -> reviewMarkdownParagraphNodes(node = child) }
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
            val fenceMarker: String? = markdownFenceMarker(line = line)
            val currentFenceMarker: String? = activeFenceMarker

            if (currentFenceMarker != null) {
                if (isMarkdownFenceClosingLine(line = line, openingMarker = currentFenceMarker)) {
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
