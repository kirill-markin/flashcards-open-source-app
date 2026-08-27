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

private data class ReviewMathDollarRun(
    val startIndex: Int,
    val length: Int
)

private data class ReviewLineDollars(
    val runs: List<ReviewMathDollarRun>,
    val escapingBackslashIndices: List<Int>
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
        val displayFenceRunLength: Int? = reviewDisplayFenceRunLength(line = line.content)
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
            displayFenceRunLength != null &&
                isReviewTopLevelBlockStart(lines = lines, lineIndex = lineIndex) -> {
                val closingLineIndex: Int? = findReviewDisplayClosingLine(
                    lines = lines,
                    openingLineIndex = lineIndex,
                    openingRunLength = displayFenceRunLength
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
        val displayFenceRunLength: Int? = reviewDisplayFenceRunLength(line = line.content)
        val singleLineDisplayCandidate: ReviewMathCandidate? = makeReviewSingleLineDisplayCandidate(
            lines = lines,
            lineIndex = lineIndex
        )
        when {
            isReviewBlankLine(line = line.content) -> lineIndex += 1

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

            displayFenceRunLength != null &&
                isReviewTopLevelBlockStart(lines = lines, lineIndex = lineIndex) -> {
                val closingLineIndex: Int? = findReviewDisplayClosingLine(
                    lines = lines,
                    openingLineIndex = lineIndex,
                    openingRunLength = displayFenceRunLength
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

            singleLineDisplayCandidate != null -> {
                candidates.add(element = singleLineDisplayCandidate)
                lineIndex += 1
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
                    val paragraphExtraction: ReviewMathExtraction? = extractReviewInlineParagraph(
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
    while (lineIndex < lines.size && isReviewBlankLine(line = lines[lineIndex].content).not()) {
        lineIndex += 1
    }
    return lineIndex
}

private fun findReviewDisplayClosingLine(
    lines: List<ReviewMathLine>,
    openingLineIndex: Int,
    openingRunLength: Int
): Int? {
    var lineIndex: Int = openingLineIndex + 1
    while (lineIndex < lines.size) {
        val closingRunLength: Int? = reviewDisplayFenceRunLength(line = lines[lineIndex].content)
        if (closingRunLength != null) {
            // Only the first later delimiter-only line can close, and it has to hold the same run length.
            return if (closingRunLength == openingRunLength) lineIndex else null
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

private fun makeReviewSingleLineDisplayCandidate(
    lines: List<ReviewMathLine>,
    lineIndex: Int
): ReviewMathCandidate? {
    if (isReviewTopLevelBlockStart(lines = lines, lineIndex = lineIndex).not()) {
        return null
    }
    if (isReviewTopLevelBlockEnd(lines = lines, lineIndex = lineIndex).not()) {
        return null
    }
    val line: ReviewMathLine = lines[lineIndex]
    val bodyRange: IntRange = reviewSingleLineDisplayBodyRange(line = line.content) ?: return null
    val source: String = line.content.substring(
        startIndex = bodyRange.first,
        endIndex = bodyRange.last + 1
    )
    if (source.isBlank()) {
        return null
    }
    return ReviewMathCandidate(
        startOffset = line.startOffset,
        endOffset = line.contentEndOffset,
        source = source,
        delimitedSource = line.content,
        kind = ReviewMathCandidateKind.DISPLAY
    )
}

/**
 * Body of `$$X$$` written on one line, where the closing run is the first later run on that line,
 * holds as many `$` as the opening run, and is followed only by spaces or tabs.
 */
private fun reviewSingleLineDisplayBodyRange(line: String): IntRange? {
    val runs: List<ReviewMathDollarRun> = reviewLineDollars(line = line).runs
    val openingRun: ReviewMathDollarRun = runs.getOrNull(index = 0) ?: return null
    val closingRun: ReviewMathDollarRun = runs.getOrNull(index = 1) ?: return null
    if (openingRun.startIndex != 0 || openingRun.length < 2) {
        return null
    }
    if (closingRun.length != openingRun.length) {
        return null
    }
    val trailing: String = line.substring(startIndex = closingRun.startIndex + closingRun.length)
    if (trailing.all { character -> isReviewMathSpace(character = character) }.not()) {
        return null
    }
    return openingRun.length..(closingRun.startIndex - 1)
}

/**
 * Length of the `$` run on a line that holds nothing but that run.
 *
 * V1 requires an unindented run: it approximates the contract's "direct top-level block" test
 * without reconstructing container blocks, so an indented `$$` inside a list item stays literal.
 */
private fun reviewDisplayFenceRunLength(line: String): Int? {
    val run: ReviewMathDollarRun = reviewLineDollars(line = line).runs.singleOrNull() ?: return null
    if (run.startIndex != 0 || run.length < 2) {
        return null
    }
    val trailing: String = line.substring(startIndex = run.length)
    if (trailing.all { character -> isReviewMathSpace(character = character) }.not()) {
        return null
    }
    return run.length
}

private fun isReviewTopLevelBlockStart(
    lines: List<ReviewMathLine>,
    lineIndex: Int
): Boolean {
    return lineIndex == 0 || isReviewBlankLine(line = lines[lineIndex - 1].content)
}

private fun isReviewTopLevelBlockEnd(
    lines: List<ReviewMathLine>,
    lineIndex: Int
): Boolean {
    return lineIndex == lines.size - 1 || isReviewBlankLine(line = lines[lineIndex + 1].content)
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
    lines: List<ReviewMathLine>
): ReviewMathExtraction? {
    if (lines.dropLast(n = 1).any { line -> hasReviewMarkdownHardBreak(line = line.content) }) {
        return null
    }
    val candidates: MutableList<ReviewMathCandidate> = mutableListOf()
    val escapedDollarOffsets: MutableList<Int> = mutableListOf()
    lines.forEach { line ->
        val lineExtraction: ReviewMathExtraction = extractReviewInlineLine(
            line = line
        ) ?: return null
        candidates.addAll(lineExtraction.candidates)
        escapedDollarOffsets.addAll(lineExtraction.escapedDollarOffsets)
    }
    return ReviewMathExtraction(
        candidates = candidates,
        escapedDollarOffsets = escapedDollarOffsets
    )
}

private fun extractReviewInlineLine(line: ReviewMathLine): ReviewMathExtraction? {
    val leadingSpaces: String = line.content.takeWhile { character ->
        isReviewMathSpace(character = character)
    }
    if (leadingSpaces.contains(char = '\t') || leadingSpaces.length > 3) {
        return null
    }
    val dollars: ReviewLineDollars = reviewLineDollars(line = line.content)
    val spans: List<IntRange> = reviewAcceptedInlineMathSpans(
        line = line.content,
        runs = dollars.runs
    )
    val prose: String = reviewInlineMathProse(line = line.content, spans = spans)
    if (containsReviewProtectedProse(source = prose)) {
        return null
    }
    return ReviewMathExtraction(
        candidates = spans.map { span ->
            ReviewMathCandidate(
                startOffset = line.startOffset + span.first,
                endOffset = line.startOffset + span.last + 1,
                source = line.content.substring(
                    startIndex = span.first + 1,
                    endIndex = span.last
                ),
                delimitedSource = line.content.substring(
                    startIndex = span.first,
                    endIndex = span.last + 1
                ),
                kind = ReviewMathCandidateKind.INLINE
            )
        },
        escapedDollarOffsets = dollars.escapingBackslashIndices.map { index ->
            line.startOffset + index
        }
    )
}

/**
 * Ranges from an accepted opening `$` to its closing `$`, both inclusive.
 *
 * Follows the pandoc `tex_math_dollars` guards: the opener needs a non-space character to its
 * right, the closer needs a non-space character to its left and no digit to its right, and a `$`
 * that fails as a closer is re-tested from scratch as the next opener.
 */
private fun reviewAcceptedInlineMathSpans(
    line: String,
    runs: List<ReviewMathDollarRun>
): List<IntRange> {
    val spans: MutableList<IntRange> = mutableListOf()
    var openingIndex: Int = -1
    runs.forEach { run ->
        val index: Int = run.startIndex
        openingIndex = when {
            // A run of two or more `$` is a display fence sequence and never an inline delimiter.
            run.length > 1 -> -1

            openingIndex < 0 -> if (hasReviewInlineOpeningGuard(line = line, index = index)) {
                index
            } else {
                -1
            }

            hasReviewInlineClosingGuard(line = line, index = index) -> {
                spans.add(element = openingIndex..index)
                -1
            }

            hasReviewInlineOpeningGuard(line = line, index = index) -> index

            else -> -1
        }
    }
    return spans
}

private fun hasReviewInlineOpeningGuard(line: String, index: Int): Boolean {
    val rightCharacter: Char = line.getOrNull(index = index + 1) ?: return false
    return isReviewMathSpace(character = rightCharacter).not()
}

private fun hasReviewInlineClosingGuard(line: String, index: Int): Boolean {
    val leftCharacter: Char = line.getOrNull(index = index - 1) ?: return false
    if (isReviewMathSpace(character = leftCharacter)) {
        return false
    }
    val rightCharacter: Char = line.getOrNull(index = index + 1) ?: return true
    return rightCharacter !in '0'..'9'
}

private fun reviewInlineMathProse(line: String, spans: List<IntRange>): String {
    if (spans.isEmpty()) {
        return line
    }
    return buildString(capacity = line.length) {
        var currentIndex: Int = 0
        spans.forEach { span ->
            append(line.substring(startIndex = currentIndex, endIndex = span.first))
            currentIndex = span.last + 1
        }
        append(line.substring(startIndex = currentIndex))
    }
}

private fun reviewLineDollars(line: String): ReviewLineDollars {
    val runs: MutableList<ReviewMathDollarRun> = mutableListOf()
    val escapingBackslashIndices: MutableList<Int> = mutableListOf()
    var index: Int = 0
    var precedingBackslashCount: Int = 0
    while (index < line.length) {
        val character: Char = line[index]
        when {
            character == '\\' -> {
                precedingBackslashCount += 1
                index += 1
            }

            character != '$' -> {
                precedingBackslashCount = 0
                index += 1
            }

            precedingBackslashCount % 2 == 1 -> {
                precedingBackslashCount = 0
                escapingBackslashIndices.add(element = index - 1)
                index += 1
            }

            else -> {
                var runEndIndex: Int = index
                while (runEndIndex < line.length && line[runEndIndex] == '$') {
                    runEndIndex += 1
                }
                runs.add(
                    ReviewMathDollarRun(
                        startIndex = index,
                        length = runEndIndex - index
                    )
                )
                index = runEndIndex
            }
        }
    }
    return ReviewLineDollars(
        runs = runs,
        escapingBackslashIndices = escapingBackslashIndices
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
    return isReviewBlankLine(line = line) ||
        reviewFenceMarker(line = line) != null ||
        isReviewIndentedCodeLine(line = line) ||
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

/**
 * The contract defines a space as exactly U+0020, U+0009, and the line break. A general whitespace
 * predicate also accepts U+00A0, which the delimiter guards and the blank-line test must reject.
 */
private fun isReviewMathSpace(character: Char): Boolean {
    return character == ' ' || character == '\t'
}

/** CommonMark blank line: a line holding only spaces and tabs, not only a zero-length line. */
private fun isReviewBlankLine(line: String): Boolean {
    return line.all { character -> isReviewMathSpace(character = character) }
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
                escapedDollarOffsets = escapedDollarOffsets
            )
        )
    }

    var currentOffset: Int = 0
    return buildList {
        candidates.forEach { candidate ->
            if (currentOffset < candidate.startOffset) {
                add(
                    makeReviewMarkdownBlock(
                        markdown = markdown,
                        startOffset = currentOffset,
                        endOffset = candidate.startOffset,
                        escapedDollarOffsets = escapedDollarOffsets
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
        }
        if (currentOffset < markdown.length) {
            add(
                makeReviewMarkdownBlock(
                    markdown = markdown,
                    startOffset = currentOffset,
                    endOffset = markdown.length,
                    escapedDollarOffsets = escapedDollarOffsets
                )
            )
        }
    }
}

private fun makeReviewMarkdownBlock(
    markdown: String,
    startOffset: Int,
    endOffset: Int,
    escapedDollarOffsets: List<Int>
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
        markdown = rawMarkdown,
        normalizedMarkdown = normalizedMarkdown
    )
}
