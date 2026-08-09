package com.flashcardsopensourceapp.feature.review

internal sealed interface ReviewMathBlock {
    data class Markdown(
        val markdown: String,
        val normalizedMarkdown: String
    ) : ReviewMathBlock

    data class Formula(
        val source: String,
        val delimitedSource: String,
        val continuesParagraph: Boolean
    ) : ReviewMathBlock
}

internal data class ReviewMathBlockExtraction(
    val blocks: List<ReviewMathBlock>,
    val requiresMarkdownRendering: Boolean
)

private data class ReviewMathLine(
    val startOffset: Int,
    val contentEndOffset: Int,
    val endOffset: Int,
    val content: String
)

private data class ReviewMathCandidate(
    val startOffset: Int,
    val endOffset: Int,
    val source: String,
    val delimitedSource: String,
    val kind: ReviewMathCandidateKind
)

private enum class ReviewMathCandidateKind {
    INLINE,
    DISPLAY
}

private data class ReviewMathExtraction(
    val candidates: List<ReviewMathCandidate>,
    val escapedDollarOffsets: List<Int>
)

private data class ReviewInlineMathExtraction(
    val candidates: List<ReviewMathCandidate>,
    val escapedDollarOffsets: List<Int>,
    val hasUnmatchedOpener: Boolean
)

private const val reviewProtectedProseCharacters: String = "[]`|<>*_~"
private val reviewReferenceDefinitionRegex: Regex = Regex(
    pattern = """^\s*(?:(?:>\s*)|(?:[-+*]\s+)|(?:\d+[.)]\s+))*\[(?:\\.|[^]])+]:"""
)
private val reviewContainerRegex: Regex = Regex(
    pattern = """^\s{0,3}(?:>\s*|[-+*]\s+|\d+[.)]\s+)"""
)
private val reviewAtxHeadingRegex: Regex = Regex(
    pattern = """^\s{0,3}#{1,6}(?:\s+|$)"""
)
private val reviewSetextBoundaryRegex: Regex = Regex(
    pattern = """^\s{0,3}(?:=+|-+)\s*$"""
)
private val reviewBareLinkRegex: Regex = Regex(
    pattern = """(?i)(?:https?://|www\.)"""
)
private val reviewBareEmailRegex: Regex = Regex(
    pattern = """[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"""
)
internal fun extractReviewMathBlocks(markdown: String): ReviewMathBlockExtraction {
    val lines: List<ReviewMathLine> = makeReviewMathLines(markdown = markdown)
    val extraction: ReviewMathExtraction = extractReviewMathCandidates(
        markdown = markdown,
        lines = lines
    )
    val hasReferenceDefinition: Boolean = hasReviewReferenceDefinitionOutsideProtectedContexts(
        lines = lines,
        candidates = extraction.candidates
    )
    // This conservative boundary is intentional cross-client V1 behavior.
    val candidates: List<ReviewMathCandidate> = if (hasReferenceDefinition) {
        emptyList()
    } else {
        extraction.candidates.sortedBy { candidate -> candidate.startOffset }
    }

    return ReviewMathBlockExtraction(
        blocks = makeReviewMathBlocks(
            markdown = markdown,
            candidates = candidates,
            escapedDollarOffsets = extraction.escapedDollarOffsets
        ),
        requiresMarkdownRendering = hasReferenceDefinition
    )
}

private fun hasReviewReferenceDefinitionOutsideProtectedContexts(
    lines: List<ReviewMathLine>,
    candidates: List<ReviewMathCandidate>
): Boolean {
    val displayCandidates: List<ReviewMathCandidate> = candidates.filter { candidate ->
        candidate.kind == ReviewMathCandidateKind.DISPLAY
    }
    var lineIndex: Int = 0
    while (lineIndex < lines.size) {
        val line: ReviewMathLine = lines[lineIndex]
        val isInsideDisplayMath: Boolean = displayCandidates.any { candidate ->
            line.startOffset >= candidate.startOffset &&
                line.contentEndOffset <= candidate.endOffset
        }
        val fenceMarker: String? = reviewFenceMarker(line = line.content)
        when {
            isInsideDisplayMath -> lineIndex += 1
            isReviewIndentedCodeLine(line = line.content) -> lineIndex += 1
            fenceMarker != null -> {
                lineIndex = reviewLineIndexAfterFence(
                    lines = lines,
                    openingLineIndex = lineIndex,
                    marker = fenceMarker
                )
            }
            isReviewDisplayDelimiterLine(line = line.content) -> {
                val closingLineIndex: Int? = findReviewDisplayClosingLine(
                    lines = lines,
                    openingLineIndex = lineIndex
                )
                if (closingLineIndex == null) {
                    // The unmatched display tail is literal, including reference-looking lines.
                    return false
                } else {
                    lineIndex = closingLineIndex + 1
                }
            }
            // V1 avoids container-aware Markdown reconstruction, so container code may veto conservatively.
            reviewReferenceDefinitionRegex.containsMatchIn(line.content) -> return true
            else -> lineIndex += 1
        }
    }
    return false
}

private fun extractReviewMathCandidates(
    markdown: String,
    lines: List<ReviewMathLine>
): ReviewMathExtraction {
    val candidates: MutableList<ReviewMathCandidate> = mutableListOf()
    val escapedDollarOffsets: MutableList<Int> = mutableListOf()
    var lineIndex: Int = 0

    while (lineIndex < lines.size) {
        val line: ReviewMathLine = lines[lineIndex]
        val fenceMarker: String? = reviewFenceMarker(line = line.content)
        when {
            line.content.isBlank() -> lineIndex += 1

            isReviewIndentedCodeLine(line = line.content) -> lineIndex += 1

            fenceMarker != null -> {
                lineIndex = reviewLineIndexAfterFence(
                    lines = lines,
                    openingLineIndex = lineIndex,
                    marker = fenceMarker
                )
            }

            reviewReferenceDefinitionRegex.containsMatchIn(line.content) -> {
                lineIndex = reviewLineIndexAfterLiteralBlock(
                    lines = lines,
                    startLineIndex = lineIndex
                )
            }

            isReviewDisplayDelimiterLine(line = line.content) -> {
                val closingLineIndex: Int? = findReviewDisplayClosingLine(
                    lines = lines,
                    openingLineIndex = lineIndex
                )
                if (closingLineIndex == null) {
                    // V1 avoids tail Markdown reconstruction; the unmatched tail stays byte-for-byte literal.
                    lineIndex = lines.size
                } else {
                    makeReviewDisplayCandidate(
                        markdown = markdown,
                        openingLine = line,
                        closingLine = lines[closingLineIndex]
                    )?.let(candidates::add)
                    lineIndex = closingLineIndex + 1
                }
            }

            isReviewContainerLine(line = line.content) || isReviewRawHtmlLine(line = line.content) -> {
                lineIndex = reviewLineIndexAfterLiteralBlock(
                    lines = lines,
                    startLineIndex = lineIndex
                )
            }

            isReviewSingleLineBoundary(line = line.content) -> lineIndex += 1

            else -> {
                val paragraphEndIndex: Int = findReviewParagraphEndIndex(
                    lines = lines,
                    startLineIndex = lineIndex
                )
                val nextLine: ReviewMathLine? = lines.getOrNull(index = paragraphEndIndex)
                val isSetextOrTable: Boolean = nextLine != null && (
                    reviewSetextBoundaryRegex.matches(nextLine.content) ||
                        reviewTableDelimiterRegex.matches(nextLine.content)
                    )
                if (isSetextOrTable.not()) {
                    val paragraphExtraction: ReviewInlineMathExtraction? = extractReviewInlineParagraph(
                        markdown = markdown,
                        lines = lines.subList(
                            fromIndex = lineIndex,
                            toIndex = paragraphEndIndex
                        )
                    )
                    if (paragraphExtraction != null) {
                        candidates.addAll(paragraphExtraction.candidates)
                        escapedDollarOffsets.addAll(paragraphExtraction.escapedDollarOffsets)
                    }
                }
                lineIndex = paragraphEndIndex
            }
        }
    }

    return ReviewMathExtraction(
        candidates = candidates,
        escapedDollarOffsets = escapedDollarOffsets
    )
}

private fun makeReviewMathLines(markdown: String): List<ReviewMathLine> {
    val lines: MutableList<ReviewMathLine> = mutableListOf()
    var lineStart: Int = 0
    while (lineStart < markdown.length) {
        var contentEnd: Int = lineStart
        while (contentEnd < markdown.length &&
            markdown[contentEnd] != '\r' &&
            markdown[contentEnd] != '\n'
        ) {
            contentEnd += 1
        }
        var lineEnd: Int = contentEnd
        if (lineEnd < markdown.length && markdown[lineEnd] == '\r') {
            lineEnd += 1
        }
        if (lineEnd < markdown.length && markdown[lineEnd] == '\n') {
            lineEnd += 1
        }
        lines.add(
            ReviewMathLine(
                startOffset = lineStart,
                contentEndOffset = contentEnd,
                endOffset = lineEnd,
                content = markdown.substring(startIndex = lineStart, endIndex = contentEnd)
            )
        )
        lineStart = lineEnd
    }
    return lines
}

private fun reviewLineIndexAfterFence(
    lines: List<ReviewMathLine>,
    openingLineIndex: Int,
    marker: String
): Int {
    var lineIndex: Int = openingLineIndex + 1
    while (lineIndex < lines.size) {
        val line: String = lines[lineIndex].content
        if (isReviewIndentedCodeLine(line = line).not() &&
            isReviewFenceClosingLine(line = line, openingMarker = marker)
        ) {
            return lineIndex + 1
        }
        lineIndex += 1
    }
    return lines.size
}

private fun reviewLineIndexAfterLiteralBlock(
    lines: List<ReviewMathLine>,
    startLineIndex: Int
): Int {
    var lineIndex: Int = startLineIndex + 1
    while (lineIndex < lines.size && lines[lineIndex].content.isNotBlank()) {
        lineIndex += 1
    }
    return lineIndex
}

private fun findReviewDisplayClosingLine(
    lines: List<ReviewMathLine>,
    openingLineIndex: Int
): Int? {
    var lineIndex: Int = openingLineIndex + 1
    while (lineIndex < lines.size) {
        if (isReviewDisplayDelimiterLine(line = lines[lineIndex].content)) {
            return lineIndex
        }
        lineIndex += 1
    }
    return null
}

private fun makeReviewDisplayCandidate(
    markdown: String,
    openingLine: ReviewMathLine,
    closingLine: ReviewMathLine
): ReviewMathCandidate? {
    val source: String = markdown.substring(
        startIndex = openingLine.endOffset,
        endIndex = closingLine.startOffset
    ).removeSuffix(suffix = "\r\n")
        .removeSuffix(suffix = "\n")
        .removeSuffix(suffix = "\r")
    if (source.isBlank()) {
        return null
    }
    return ReviewMathCandidate(
        startOffset = openingLine.startOffset,
        endOffset = closingLine.contentEndOffset,
        source = source,
        delimitedSource = markdown.substring(
            startIndex = openingLine.startOffset,
            endIndex = closingLine.contentEndOffset
        ),
        kind = ReviewMathCandidateKind.DISPLAY
    )
}

private fun findReviewParagraphEndIndex(
    lines: List<ReviewMathLine>,
    startLineIndex: Int
): Int {
    var lineIndex: Int = startLineIndex
    while (lineIndex < lines.size && isReviewParagraphBoundary(line = lines[lineIndex].content).not()) {
        lineIndex += 1
    }
    return lineIndex
}

private fun extractReviewInlineParagraph(
    markdown: String,
    lines: List<ReviewMathLine>
): ReviewInlineMathExtraction? {
    if (lines.dropLast(n = 1).any { line -> hasReviewMarkdownHardBreak(line = line.content) }) {
        return null
    }
    val candidates: MutableList<ReviewMathCandidate> = mutableListOf()
    val escapedDollarOffsets: MutableList<Int> = mutableListOf()
    var hasUnmatchedOpener: Boolean = false
    lines.forEach { line ->
        val lineExtraction: ReviewInlineMathExtraction = extractReviewInlineLine(
            markdown = markdown,
            line = line
        ) ?: return null
        candidates.addAll(lineExtraction.candidates)
        escapedDollarOffsets.addAll(lineExtraction.escapedDollarOffsets)
        hasUnmatchedOpener = hasUnmatchedOpener || lineExtraction.hasUnmatchedOpener
    }
    return ReviewInlineMathExtraction(
        candidates = if (hasUnmatchedOpener) emptyList() else candidates,
        escapedDollarOffsets = escapedDollarOffsets,
        hasUnmatchedOpener = hasUnmatchedOpener
    )
}

private fun extractReviewInlineLine(
    markdown: String,
    line: ReviewMathLine
): ReviewInlineMathExtraction? {
    val leadingWhitespace: String = line.content.takeWhile { character -> character.isWhitespace() }
    if (leadingWhitespace.any { character -> character != ' ' } || leadingWhitespace.length > 3) {
        return null
    }
    val candidates: MutableList<ReviewMathCandidate> = mutableListOf()
    val escapedDollarOffsets: MutableList<Int> = mutableListOf()
    val prose: StringBuilder = StringBuilder()
    var openingDollarOffset: Int? = null
    var literalDoubleDollarSecondOffset: Int? = null
    var precedingBackslashCount: Int = 0

    line.content.forEachIndexed { index, character ->
        if (character == '\\') {
            precedingBackslashCount += 1
            if (openingDollarOffset == null) {
                prose.append(character)
            }
            return@forEachIndexed
        }

        val isEscaped: Boolean = precedingBackslashCount % 2 == 1
        precedingBackslashCount = 0
        if (character != '$') {
            if (openingDollarOffset == null) {
                prose.append(character)
            }
            return@forEachIndexed
        }

        if (literalDoubleDollarSecondOffset == index) {
            literalDoubleDollarSecondOffset = null
            return@forEachIndexed
        }

        if (isEscaped) {
            escapedDollarOffsets.add(line.startOffset + index - 1)
            if (openingDollarOffset == null) {
                prose.append(character)
            }
            return@forEachIndexed
        }

        if (line.content.getOrNull(index = index + 1) == '$') {
            if (openingDollarOffset != null) {
                return null
            }
            prose.append("$$")
            literalDoubleDollarSecondOffset = index + 1
            return@forEachIndexed
        }

        val openingOffset: Int? = openingDollarOffset
        if (openingOffset == null) {
            openingDollarOffset = index
        } else {
            val source: String = line.content.substring(
                startIndex = openingOffset + 1,
                endIndex = index
            )
            if (source.isBlank()) {
                return null
            }
            candidates.add(
                ReviewMathCandidate(
                    startOffset = line.startOffset + openingOffset,
                    endOffset = line.startOffset + index + 1,
                    source = source,
                    delimitedSource = markdown.substring(
                        startIndex = line.startOffset + openingOffset,
                        endIndex = line.startOffset + index + 1
                    ),
                    kind = ReviewMathCandidateKind.INLINE
                )
            )
            openingDollarOffset = null
        }
    }

    if (containsReviewProtectedProse(source = prose.toString())) {
        return null
    }
    val hasUnmatchedOpener: Boolean = openingDollarOffset != null
    return ReviewInlineMathExtraction(
        candidates = if (hasUnmatchedOpener) emptyList() else candidates,
        escapedDollarOffsets = escapedDollarOffsets,
        hasUnmatchedOpener = hasUnmatchedOpener
    )
}

private fun containsReviewProtectedProse(source: String): Boolean {
    return source.indices.any { index ->
        reviewProtectedProseCharacters.contains(source[index]) &&
            isReviewCharacterUnescaped(source = source, index = index)
    } ||
        reviewBareLinkRegex.containsMatchIn(source) ||
        reviewBareEmailRegex.containsMatchIn(source)
}

private fun isReviewCharacterUnescaped(source: String, index: Int): Boolean {
    var precedingBackslashCount: Int = 0
    var cursor: Int = index - 1
    while (cursor >= 0 && source[cursor] == '\\') {
        precedingBackslashCount += 1
        cursor -= 1
    }
    return precedingBackslashCount % 2 == 0
}

private fun hasReviewMarkdownHardBreak(line: String): Boolean {
    if (line.takeLastWhile { character -> character == ' ' }.length >= 2) {
        return true
    }
    return line.takeLastWhile { character -> character == '\\' }.length % 2 == 1
}

private fun isReviewParagraphBoundary(line: String): Boolean {
    return line.isBlank() ||
        reviewFenceMarker(line = line) != null ||
        isReviewIndentedCodeLine(line = line) ||
        isReviewDisplayDelimiterLine(line = line) ||
        isReviewContainerLine(line = line) ||
        isReviewRawHtmlLine(line = line) ||
        isReviewSingleLineBoundary(line = line)
}

private fun isReviewSingleLineBoundary(line: String): Boolean {
    return reviewAtxHeadingRegex.containsMatchIn(line) ||
        reviewSetextBoundaryRegex.matches(line) ||
        reviewHorizontalRuleRegex.matches(line) ||
        reviewTableDelimiterRegex.matches(line)
}

private fun isReviewContainerLine(line: String): Boolean {
    return reviewContainerRegex.containsMatchIn(line)
}

private fun isReviewRawHtmlLine(line: String): Boolean {
    return line.trimStart().startsWith(prefix = "<")
}

private fun isReviewIndentedCodeLine(line: String): Boolean {
    var indentationColumns: Int = 0
    line.forEach { character ->
        indentationColumns = when (character) {
            ' ' -> indentationColumns + 1
            '\t' -> indentationColumns + (4 - indentationColumns % 4)
            else -> return false
        }
        if (indentationColumns >= 4) {
            return true
        }
    }
    return false
}

private fun isReviewDisplayDelimiterLine(line: String): Boolean {
    return line.trimEnd(chars = charArrayOf(' ', '\t')) == "$$"
}

private fun makeReviewMathBlocks(
    markdown: String,
    candidates: List<ReviewMathCandidate>,
    escapedDollarOffsets: List<Int>
): List<ReviewMathBlock> {
    if (candidates.isEmpty()) {
        return listOf(
            makeReviewMarkdownBlock(
                markdown = markdown,
                startOffset = 0,
                endOffset = markdown.length,
                escapedDollarOffsets = escapedDollarOffsets,
                continuesInlineParagraph = false
            )
        )
    }

    var currentOffset: Int = 0
    var continuesInlineParagraph: Boolean = false
    return buildList {
        candidates.forEach { candidate ->
            if (currentOffset < candidate.startOffset) {
                add(
                    makeReviewMarkdownBlock(
                        markdown = markdown,
                        startOffset = currentOffset,
                        endOffset = candidate.startOffset,
                        escapedDollarOffsets = escapedDollarOffsets,
                        continuesInlineParagraph = continuesInlineParagraph
                    )
                )
            }
            add(
                ReviewMathBlock.Formula(
                    source = candidate.source,
                    delimitedSource = candidate.delimitedSource,
                    continuesParagraph = candidate.kind == ReviewMathCandidateKind.INLINE
                )
            )
            currentOffset = candidate.endOffset
            continuesInlineParagraph = candidate.kind == ReviewMathCandidateKind.INLINE
        }
        if (currentOffset < markdown.length) {
            add(
                makeReviewMarkdownBlock(
                    markdown = markdown,
                    startOffset = currentOffset,
                    endOffset = markdown.length,
                    escapedDollarOffsets = escapedDollarOffsets,
                    continuesInlineParagraph = continuesInlineParagraph
                )
            )
        }
    }
}

private fun makeReviewMarkdownBlock(
    markdown: String,
    startOffset: Int,
    endOffset: Int,
    escapedDollarOffsets: List<Int>,
    continuesInlineParagraph: Boolean
): ReviewMathBlock.Markdown {
    val rawMarkdown: String = markdown.substring(startIndex = startOffset, endIndex = endOffset)
    val removedOffsets: Set<Int> = escapedDollarOffsets.filter { offset ->
        offset >= startOffset && offset < endOffset
    }.toSet()
    val normalizedMarkdown: String = buildString(capacity = rawMarkdown.length) {
        rawMarkdown.forEachIndexed { index, character ->
            if (startOffset + index !in removedOffsets) {
                append(character)
            }
        }
    }
    return ReviewMathBlock.Markdown(
        markdown = if (continuesInlineParagraph) {
            normalizeReviewInlineMathParagraphContinuation(markdown = rawMarkdown)
        } else {
            rawMarkdown
        },
        normalizedMarkdown = normalizedMarkdown
    )
}

private fun normalizeReviewInlineMathParagraphContinuation(markdown: String): String {
    if (markdown.isEmpty() || markdown.first() == '\r' || markdown.first() == '\n') {
        return markdown
    }
    // A mid-paragraph fragment must not acquire document-level block syntax after splitting.
    val leadingWhitespaceLength: Int = markdown.takeWhile { character ->
        character == ' ' || character == '\t'
    }.length
    val content: String = markdown.drop(n = leadingWhitespaceLength)
    val normalizedPrefix: String = if (leadingWhitespaceLength == 0) "" else " "
    val escapedContent: String = when {
        Regex(pattern = """^#{1,6}(?:[ \t]+|$)""").containsMatchIn(content) -> "\\$content"
        Regex(pattern = """^[-+*](?:[ \t]+|$)""").containsMatchIn(content) -> "\\$content"
        Regex(pattern = """^(?:-[ \t]*){3,}(?:\r?\n|$)""").containsMatchIn(content) -> "\\$content"
        else -> Regex(pattern = """^(\d{1,9})([.)])(?=[ \t]+|\r\n|\r|\n|$)""").replaceFirst(
            input = content,
            replacement = "$1\\\\$2"
        )
    }
    return normalizedPrefix + escapedContent
}
