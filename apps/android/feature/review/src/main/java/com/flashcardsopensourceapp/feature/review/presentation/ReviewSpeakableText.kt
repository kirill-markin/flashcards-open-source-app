package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.core.ui.content.MathBlock
import com.flashcardsopensourceapp.core.ui.content.isMarkdownFenceClosingLine
import com.flashcardsopensourceapp.core.ui.content.markdownFenceMarker
import com.flashcardsopensourceapp.core.ui.content.markdownHorizontalRuleRegex
import com.flashcardsopensourceapp.core.ui.content.markdownTableDelimiterRegex

internal fun makeReviewSpeakableText(
    mathBlocks: List<MathBlock>
): String {
    if (mathBlocks.any { block -> block is MathBlock.Formula }) {
        var preservesNextOpeningBlockPrefix: Boolean = false
        val speakableSegments: List<String> = buildList {
            mathBlocks.forEach { block ->
                when (block) {
                    is MathBlock.Formula -> {
                        add(block.source)
                        preservesNextOpeningBlockPrefix = block.continuesParagraph
                    }
                    is MathBlock.Markdown -> {
                        val segment: String = makeReviewSpeakableTextWithoutMath(
                            text = block.normalizedMarkdown,
                            preservesOpeningBlockPrefix = preservesNextOpeningBlockPrefix
                        )
                        if (segment.isNotEmpty()) {
                            add(segment)
                        }
                        preservesNextOpeningBlockPrefix = false
                    }
                }
            }
        }
        return speakableSegments.joinToString(separator = "\n")
    }

    val markdownBlock: MathBlock.Markdown = mathBlocks.single() as MathBlock.Markdown
    return makeReviewSpeakableTextWithoutMath(
        text = markdownBlock.normalizedMarkdown,
        preservesOpeningBlockPrefix = false
    )
}

private fun makeReviewSpeakableTextWithoutMath(
    text: String,
    preservesOpeningBlockPrefix: Boolean
): String {
    if (text.trim().isEmpty()) {
        return ""
    }

    if (classifyReviewContentPresentation(text = text) != ReviewContentPresentationMode.RICH) {
        return normalizeReviewSpeakableText(lines = text.split(Regex(pattern = """\R+""")))
    }

    val speakableLines: List<String> = buildList {
        var activeFenceMarker: String? = null

        text.lines().forEachIndexed { lineIndex, line ->
            val fenceMarker: String? = markdownFenceMarker(line = line)
            val currentFenceMarker: String? = activeFenceMarker

            if (currentFenceMarker != null) {
                if (isMarkdownFenceClosingLine(line = line, openingMarker = currentFenceMarker)) {
                    activeFenceMarker = null
                }
                return@forEachIndexed
            }

            if (fenceMarker != null) {
                activeFenceMarker = fenceMarker
                return@forEachIndexed
            }

            val normalizedLine: String = if (preservesOpeningBlockPrefix && lineIndex == 0) {
                normalizeReviewSpeakableInlineText(text = line)
            } else {
                normalizeReviewSpeakableMarkdownLine(line = line)
            }
            if (normalizedLine.isNotEmpty()) {
                add(normalizedLine)
            }
        }
    }

    return normalizeReviewSpeakableText(lines = speakableLines)
}

private fun normalizeReviewSpeakableMarkdownLine(line: String): String {
    val trimmedLine: String = line.trim()
    if (trimmedLine.isEmpty()) {
        return ""
    }
    if (markdownHorizontalRuleRegex.matches(trimmedLine) || markdownTableDelimiterRegex.matches(trimmedLine)) {
        return ""
    }

    reviewHeadingRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[2])
    }
    reviewQuoteRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[1])
    }
    reviewBulletRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[1])
    }
    reviewOrderedListRegex.matchEntire(trimmedLine)?.let { match ->
        return normalizeReviewSpeakableInlineText(text = match.groupValues[1])
    }

    return normalizeReviewSpeakableInlineText(text = trimmedLine)
}

private fun normalizeReviewSpeakableText(lines: List<String>): String {
    return lines.map { line ->
        normalizeReviewSpeakableInlineText(text = line)
    }.filter { line ->
        line.isNotEmpty()
    }.joinToString(separator = "\n")
}

private fun normalizeReviewSpeakableInlineText(text: String): String {
    return reviewSpeakableTextReplacingManagedMediaReferences(text = text)
        .replace(oldValue = "`", newValue = "")
        .replace(oldValue = "|", newValue = " ")
        .replace(regex = Regex(pattern = """\s+"""), replacement = " ")
        .trim()
}

private fun reviewSpeakableTextReplacingManagedMediaReferences(text: String): String {
    var output: String = text
    reviewManagedMediaReferenceRegex.findAll(input = text).toList().asReversed().forEach { match ->
        val reference: String = match.groups[3]?.value ?: return@forEach
        if (parseReviewManagedMediaAssetId(reference = reference) == null) {
            return@forEach
        }

        val label: String = match.groups[2]?.value?.trim().orEmpty()
        output = output.replaceRange(
            range = match.range,
            replacement = label
        )
    }

    return output
}
