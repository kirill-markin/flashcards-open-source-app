package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.core.ui.content.MathBlock
import com.flashcardsopensourceapp.core.ui.content.extractMathBlocks
import com.flashcardsopensourceapp.data.local.model.media.parseManagedMediaReference
import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMElementTypes
import org.intellij.markdown.flavours.gfm.GFMFlavourDescriptor
import org.intellij.markdown.parser.CancellationToken
import org.intellij.markdown.parser.LinkMap
import org.intellij.markdown.parser.MarkdownParser

/**
 * Readable copy of a side: each managed-media reference becomes its visible label, or disappears
 * with its line and the blank lines it leaves when the label is empty or repeats the destination.
 */
internal fun reviewSideMarkdownForClipboard(sourceText: String): String {
    // Mask accepted math without changing source offsets or normalizing escaped dollars.
    val mediaMarkdown: CharSequence = buildString(capacity = sourceText.length) {
        extractMathBlocks(markdown = sourceText).blocks.forEach { block ->
            when (block) {
                is MathBlock.Markdown -> append(block.markdown)
                is MathBlock.Formula -> block.delimitedSource.forEach { character ->
                    append(if (character == '\r' || character == '\n') character else ' ')
                }
            }
        }
    }
    val tree: ASTNode = MarkdownParser(
        flavour = GFMFlavourDescriptor(),
        assertionsEnabled = true,
        cancellationToken = CancellationToken.NonCancellable
    ).buildMarkdownTreeFromString(mediaMarkdown)
    val linkMap: LinkMap = LinkMap.buildLinkMap(tree, mediaMarkdown)
    val replacements: List<Pair<IntRange, String>> = reviewClipboardReplacements(
        node = tree,
        sourceText = sourceText,
        linkMap = linkMap
    )
    val lineStarts: List<Int> = listOf(0) + sourceText.indices
        .filter { offset -> sourceText[offset] == '\n' }
        .map { offset -> offset + 1 }
    val deletedLines: Set<Int> = reviewClipboardDeletedLines(
        sourceText = sourceText,
        lineStarts = lineStarts,
        replacements = replacements
    )
    val edits: List<Pair<IntRange, String>> = reviewClipboardLineDeletions(
        sourceText = sourceText,
        lineStarts = lineStarts,
        deletedLines = deletedLines
    ) + replacements.filter { (range, _) ->
        reviewClipboardLineIndex(lineStarts = lineStarts, offset = range.first) !in deletedLines
    }
    // Edit source ranges only; Markdown serialization would change code, math and whitespace.
    return edits.sortedBy { (range, _) -> range.first }.asReversed().fold(sourceText) { markdown, (range, text) ->
        markdown.replaceRange(range = range, replacement = text)
    }
}

/**
 * Lines holding only removed media, plus one blank line when they formed a whole inner paragraph,
 * plus all blank lines between kept text and removed media at the start or end of the text.
 */
private fun reviewClipboardDeletedLines(
    sourceText: String,
    lineStarts: List<Int>,
    replacements: List<Pair<IntRange, String>>
): Set<Int> {
    val removedRanges: List<IntRange> = replacements
        .filter { (_, text) -> text.isEmpty() }
        .map { (range, _) -> range }
    val lineCount: Int = lineStarts.size
    val isBlankLine: (Int) -> Boolean = { line ->
        sourceText.substring(
            lineStarts[line],
            reviewClipboardLineEnd(sourceText = sourceText, lineStarts = lineStarts, line = line)
        ).isBlank()
    }
    val mediaOnlyLines: List<Int> = removedRanges
        .map { range -> reviewClipboardLineIndex(lineStarts = lineStarts, offset = range.first) }
        .distinct()
        .filter { line ->
            val lineStart: Int = lineStarts[line]
            val lineEnd: Int = reviewClipboardLineEnd(sourceText = sourceText, lineStarts = lineStarts, line = line)
            val rangesInLine: List<IntRange> = removedRanges.filter { range ->
                range.first >= lineStart && range.last < lineEnd
            }
            (lineStart until lineEnd).all { offset ->
                sourceText[offset].isWhitespace() || rangesInLine.any { range -> offset in range }
            }
        }
        .sorted()
    val paragraphBreaks: List<Int> = mediaOnlyLines
        .filter { line -> line - 1 !in mediaOnlyLines }
        .mapNotNull { firstLine ->
            var lastLine: Int = firstLine
            while (lastLine + 1 in mediaOnlyLines) {
                lastLine += 1
            }
            val nextLine: Int = lastLine + 1
            val isWholeParagraph: Boolean = firstLine > 0 && isBlankLine(firstLine - 1) &&
                nextLine < lineCount && isBlankLine(nextLine)
            if (isWholeParagraph) nextLine else null
        }
    val isKeptLine: (Int) -> Boolean = { line -> line !in mediaOnlyLines && isBlankLine(line).not() }
    val firstKeptLine: Int = (0 until lineCount).firstOrNull(isKeptLine) ?: lineCount
    val lastKeptLine: Int = (0 until lineCount).lastOrNull(isKeptLine) ?: -1
    // Removed media at either end of the text also takes every blank line up to the kept text.
    val edgeLines: List<Int> = listOf(0 until firstKeptLine, lastKeptLine + 1 until lineCount)
        .filter { lines -> lines.any { line -> line in mediaOnlyLines } }
        .flatten()
    return (mediaOnlyLines + paragraphBreaks + edgeLines).toSet()
}

private fun reviewClipboardLineDeletions(
    sourceText: String,
    lineStarts: List<Int>,
    deletedLines: Set<Int>
): List<Pair<IntRange, String>> {
    return deletedLines
        .filter { line -> line - 1 !in deletedLines }
        .map { firstLine ->
            var lastLine: Int = firstLine
            while (lastLine + 1 in deletedLines) {
                lastLine += 1
            }
            val range: IntRange = when {
                lastLine + 1 < lineStarts.size -> lineStarts[firstLine] until lineStarts[lastLine + 1]
                // The last line has no terminator, so the preceding line's terminator goes instead.
                firstLine > 0 -> {
                    val lineFeed: Int = lineStarts[firstLine] - 1
                    val isCrLf: Boolean = lineFeed > 0 && sourceText[lineFeed - 1] == '\r'
                    (if (isCrLf) lineFeed - 1 else lineFeed) until sourceText.length
                }
                else -> 0 until sourceText.length
            }
            range to ""
        }
}

private fun reviewClipboardLineIndex(lineStarts: List<Int>, offset: Int): Int {
    return lineStarts.indexOfLast { lineStart -> lineStart <= offset }
}

private fun reviewClipboardLineEnd(sourceText: String, lineStarts: List<Int>, line: Int): Int {
    return if (line + 1 < lineStarts.size) lineStarts[line + 1] - 1 else sourceText.length
}

private fun reviewClipboardReplacements(
    node: ASTNode,
    sourceText: String,
    linkMap: LinkMap
): List<Pair<IntRange, String>> {
    if (node.type == MarkdownElementTypes.CODE_FENCE ||
        node.type == MarkdownElementTypes.CODE_BLOCK ||
        node.type == MarkdownElementTypes.CODE_SPAN ||
        node.type == MarkdownElementTypes.LINK_DEFINITION ||
        node.type == GFMElementTypes.INLINE_MATH ||
        node.type == GFMElementTypes.BLOCK_MATH
    ) {
        return emptyList()
    }

    val link: ASTNode = if (node.type == MarkdownElementTypes.IMAGE) {
        node.children.firstOrNull { child ->
            child.type == MarkdownElementTypes.INLINE_LINK ||
                child.type == MarkdownElementTypes.FULL_REFERENCE_LINK ||
                child.type == MarkdownElementTypes.SHORT_REFERENCE_LINK
        } ?: node
    } else {
        node
    }
    val destination: ASTNode? = link.children.firstOrNull { child ->
        child.type == MarkdownElementTypes.LINK_DESTINATION
    }
    val label: ASTNode? = link.children.firstOrNull { child ->
        child.type == MarkdownElementTypes.LINK_TEXT
    } ?: link.children.firstOrNull { child ->
        child.type == MarkdownElementTypes.LINK_LABEL
    }
    val referenceLabel: ASTNode? = link.children.lastOrNull { child ->
        child.type == MarkdownElementTypes.LINK_LABEL
    }
    val rawDestination: String? = when {
        destination != null -> sourceText.substring(destination.startOffset, destination.endOffset)
            .removeSurrounding(prefix = "<", suffix = ">")
        (link.type == MarkdownElementTypes.FULL_REFERENCE_LINK ||
            link.type == MarkdownElementTypes.SHORT_REFERENCE_LINK) && referenceLabel != null -> {
            linkMap.getLinkInfo(
                sourceText.subSequence(referenceLabel.startOffset, referenceLabel.endOffset)
            )?.destination?.toString()
        }
        else -> null
    }
    if (rawDestination != null && parseManagedMediaReference(reference = rawDestination) != null) {
        val mediaLabel: String = label?.let { labelNode ->
            sourceText.substring(labelNode.startOffset + 1, labelNode.endOffset - 1).trim()
        }.orEmpty()
        val copiedLabel: String = if (mediaLabel == rawDestination.trim()) "" else mediaLabel
        return listOf((node.startOffset until node.endOffset) to copiedLabel)
    }

    return node.children.flatMap { child ->
        reviewClipboardReplacements(
            node = child,
            sourceText = sourceText,
            linkMap = linkMap
        )
    }
}
