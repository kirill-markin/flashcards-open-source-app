import Foundation

enum ReviewMathBlockExtraction {
    case none
    case literalMarkdown
    case segmented([ReviewMathBlock])
}

enum ReviewMathBlock {
    case markdown(String)
    case formula(ReviewFormulaContent)
}

private struct ReviewMathSourceLine {
    let content: String
    let separator: String
}

struct ReviewMathFence {
    let marker: Character
    let minimumLength: Int
}

private enum ReviewInlineMathPart {
    case text(String)
    case formula(ReviewFormulaContent)
}

private struct ReviewInlineMathLine {
    let parts: [ReviewInlineMathPart]
    let containsFormula: Bool
}

private struct ReviewMathDisplayConstruct {
    let closingIndex: Int
    let latex: String
}

private enum ReviewInlineMathClosingScan {
    case candidate(String.Index)
    case displayRun(String.Index)
    case none
}

private let reviewMathReferenceDefinitionExpression = makeReviewContentRegularExpression(
    pattern: #"^ {0,3}\[(?:\\.|[^\\\]])+\]:"#
)
private let reviewMathContainerPrefixExpression = makeReviewContentRegularExpression(
    pattern: #"^ {0,3}(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t])"#
)
private let reviewMathHeadingExpression = makeReviewContentRegularExpression(pattern: #"^ {0,3}#{1,6}(?:[ \t]+|$)"#)
private let reviewMathBlockquoteExpression = makeReviewContentRegularExpression(pattern: #"^ {0,3}>"#)
private let reviewMathListExpression = makeReviewContentRegularExpression(pattern: #"^ {0,3}(?:[-+*][ \t]+|\d{1,9}[.)][ \t]+)"#)
private let reviewMathThematicBreakExpression = makeReviewContentRegularExpression(pattern: #"^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$"#)
private let reviewMathSetextHeadingExpression = makeReviewContentRegularExpression(pattern: #"^ {0,3}(?:=+[ \t]*|-+[ \t]*)$"#)
private let reviewMathTableSeparatorExpression = makeReviewContentRegularExpression(pattern: #"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$"#)
private let reviewMathHTMLExpression = makeReviewContentRegularExpression(pattern: #"^ {0,3}<"#)
private let reviewMathUnsupportedInlineCharacters = "[]`|<>*_~"
private let reviewMathBareURLExpression = makeReviewContentRegularExpression(pattern: #"(?i)\b(?:https?://|www\.)"#)
private let reviewMathBareEmailExpression = makeReviewContentRegularExpression(
    pattern: #"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"#
)

func extractReviewMathBlocks(text: String) -> ReviewMathBlockExtraction {
    let lines = makeReviewMathSourceLines(text: text)
    var blocks: [ReviewMathBlock] = []
    var pendingMarkdown = ""
    var didFindFormula = false
    var didFindReferenceDefinition = false
    var lineIndex = 0

    while lineIndex < lines.count {
        let line = lines[lineIndex]

        if reviewMathLineIsBlank(line: line.content) {
            pendingMarkdown += line.content + line.separator
            lineIndex += 1
            continue
        }

        if let fence = reviewMathFence(line: line.content) {
            pendingMarkdown += line.content + line.separator
            lineIndex += 1

            while lineIndex < lines.count {
                let fencedLine = lines[lineIndex]
                pendingMarkdown += fencedLine.content + fencedLine.separator
                lineIndex += 1

                if reviewMathFenceCloses(line: fencedLine.content, openingFence: fence) {
                    break
                }
            }
            continue
        }

        if reviewMathLineIsIndentedCode(line: line.content) {
            pendingMarkdown += line.content + line.separator
            lineIndex += 1
            continue
        }

        if reviewMathReferenceDefinitionExpression.matches(line.content) {
            didFindReferenceDefinition = true
            pendingMarkdown += line.content + line.separator
            lineIndex += 1
            continue
        }

        // A display construct that fails any source rule stays literal and is rescanned as prose.
        if let construct = reviewMathDisplayConstruct(lines: lines, openingIndex: lineIndex) {
            if pendingMarkdown.isEmpty == false {
                blocks.append(.markdown(pendingMarkdown))
                pendingMarkdown = ""
            }

            let originalSource = reviewMathDisplaySource(
                lines: lines,
                openingIndex: lineIndex,
                closingIndex: construct.closingIndex
            )
            blocks.append(
                .formula(
                    ReviewFormulaContent(
                        originalSource: originalSource,
                        latex: construct.latex,
                        continuesParagraph: false
                    )
                )
            )
            pendingMarkdown += lines[construct.closingIndex].separator
            didFindFormula = true
            lineIndex = construct.closingIndex + 1
            continue
        }

        if reviewMathLineStartsContainer(line: line.content) || reviewMathHTMLExpression.matches(line.content) {
            let detectsContainerReferences = reviewMathLineStartsContainer(line: line.content)
            var containerFence: ReviewMathFence?

            while lineIndex < lines.count {
                while lineIndex < lines.count
                    && reviewMathLineIsBlank(line: lines[lineIndex].content) == false {
                    let containerLine = lines[lineIndex]
                    pendingMarkdown += containerLine.content + containerLine.separator

                    if detectsContainerReferences {
                        let containerContent = reviewMathContainerContent(line: containerLine.content)
                        if let fence = containerFence {
                            if reviewMathFenceCloses(line: containerContent, openingFence: fence) {
                                containerFence = nil
                            }
                        } else if reviewMathLineIsIndentedCode(line: containerContent) == false {
                            if let fence = reviewMathFence(line: containerContent) {
                                containerFence = fence
                            } else if reviewMathReferenceDefinitionExpression.matches(containerContent) {
                                didFindReferenceDefinition = true
                            }
                        }
                    }
                    lineIndex += 1
                }

                while lineIndex < lines.count
                    && reviewMathLineIsBlank(line: lines[lineIndex].content) {
                    pendingMarkdown += lines[lineIndex].content + lines[lineIndex].separator
                    lineIndex += 1
                }

                guard lineIndex < lines.count,
                      reviewMathLineContinuesContainerAfterBlank(line: lines[lineIndex].content) else {
                    break
                }
            }
            continue
        }

        if reviewMathHeadingExpression.matches(line.content)
            || reviewMathThematicBreakExpression.matches(line.content)
            || reviewMathSetextHeadingExpression.matches(line.content)
            || reviewMathTableSeparatorExpression.matches(line.content) {
            pendingMarkdown += line.content + line.separator
            lineIndex += 1
            continue
        }

        let paragraphStartIndex = lineIndex
        lineIndex += 1
        while lineIndex < lines.count
            && reviewMathLineIsBlank(line: lines[lineIndex].content) == false {
            if reviewMathSetextHeadingExpression.matches(lines[lineIndex].content) {
                lineIndex += 1
                break
            }
            if reviewMathLineStartsParagraphBoundary(line: lines[lineIndex].content) {
                break
            }
            lineIndex += 1
        }

        let paragraphLines = Array(lines[paragraphStartIndex..<lineIndex])
        let paragraphResult = splitReviewMathParagraph(lines: paragraphLines)
        guard let paragraphBlocks = paragraphResult else {
            pendingMarkdown += reviewMathSource(lines: paragraphLines)
            continue
        }

        for paragraphBlock in paragraphBlocks {
            switch paragraphBlock {
            case .markdown(let source):
                pendingMarkdown += source
            case .formula(let formula):
                if pendingMarkdown.isEmpty == false {
                    blocks.append(.markdown(pendingMarkdown))
                    pendingMarkdown = ""
                }
                blocks.append(.formula(formula))
                didFindFormula = true
            }
        }
    }

    if didFindReferenceDefinition {
        return .literalMarkdown
    }

    guard didFindFormula else {
        return .none
    }

    if pendingMarkdown.isEmpty == false {
        blocks.append(.markdown(pendingMarkdown))
    }
    return .segmented(blocks)
}

func normalizeReviewPlainTextEscapedDollars(text: String) -> String {
    var normalizedText = ""
    var precedingBackslashCount = 0

    for character in text {
        if character == "\\" {
            precedingBackslashCount += 1
            continue
        }

        let preservedBackslashCount = character == "$" && precedingBackslashCount.isMultiple(of: 2) == false
            ? precedingBackslashCount - 1
            : precedingBackslashCount
        normalizedText += String(repeating: "\\", count: preservedBackslashCount)
        normalizedText.append(character)
        precedingBackslashCount = 0
    }

    normalizedText += String(repeating: "\\", count: precedingBackslashCount)
    return normalizedText
}

private func makeReviewMathSourceLines(text: String) -> [ReviewMathSourceLine] {
    let rawLines = text.components(separatedBy: "\n")
    return rawLines.enumerated().map { index, rawLine in
        let usesCarriageReturn = rawLine.last == "\r"
        let content = usesCarriageReturn ? String(rawLine.dropLast()) : rawLine
        let separator: String
        if index == rawLines.count - 1 {
            separator = ""
        } else {
            separator = usesCarriageReturn ? "\r\n" : "\n"
        }
        return ReviewMathSourceLine(content: content, separator: separator)
    }
}

func reviewMathFence(line: String) -> ReviewMathFence? {
    let content = line.dropFirst(min(reviewMathLeadingSpaceCount(line: line), 3))
    guard let marker = content.first, marker == "`" || marker == "~" else {
        return nil
    }

    let markerLength = content.prefix(while: { character in
        character == marker
    }).count
    guard markerLength >= 3 else {
        return nil
    }

    let info = content.dropFirst(markerLength)
    if marker == "`", info.contains("`") {
        return nil
    }

    return ReviewMathFence(marker: marker, minimumLength: markerLength)
}

func reviewMathFenceCloses(line: String, openingFence: ReviewMathFence) -> Bool {
    let content = line.dropFirst(min(reviewMathLeadingSpaceCount(line: line), 3))
    let markerLength = content.prefix(while: { character in
        character == openingFence.marker
    }).count
    guard markerLength >= openingFence.minimumLength else {
        return false
    }

    return content.dropFirst(markerLength).allSatisfy { character in
        character == " " || character == "\t"
    }
}

private func reviewMathLeadingSpaceCount(line: String) -> Int {
    line.prefix(while: { character in
        character == " "
    }).count
}

private func reviewMathLineIsIndentedCode(line: String) -> Bool {
    var indentationColumns = 0

    for character in line {
        if character == " " {
            indentationColumns += 1
        } else if character == "\t" {
            indentationColumns += 4 - (indentationColumns % 4)
        } else {
            break
        }

        if indentationColumns >= 4 {
            return true
        }
    }

    return false
}

// The contract defines *space* as exactly U+0020 and U+0009, so a general whitespace
// predicate must never stand in for this check.
private func reviewMathCharacterIsSpace(_ character: Character) -> Bool {
    character == " " || character == "\t"
}

private func reviewMathCharacterIsDigit(_ character: Character) -> Bool {
    character.isASCII && character.isNumber
}

// CommonMark's blank line: a line holding only spaces and tabs, not only a zero-length line.
private func reviewMathLineIsBlank(line: String) -> Bool {
    line.allSatisfy { character in
        reviewMathCharacterIsSpace(character)
    }
}

private func reviewMathDollarRunLength(line: String, from index: String.Index) -> Int {
    var length = 0
    var cursor = index

    while cursor < line.endIndex, line[cursor] == "$" {
        length += 1
        cursor = line.index(after: cursor)
    }
    return length
}

/// Start of the line content when at most three spaces and no tab precede it.
private func reviewMathDisplayIndentationEnd(line: String) -> String.Index? {
    var index = line.startIndex
    var spaceCount = 0

    while index < line.endIndex, line[index] == " " {
        spaceCount += 1
        index = line.index(after: index)
    }
    return spaceCount <= 3 ? index : nil
}

private func reviewMathDisplayOpeningRun(line: String) -> (contentStart: String.Index, length: Int)? {
    guard let start = reviewMathDisplayIndentationEnd(line: line), start < line.endIndex, line[start] == "$" else {
        return nil
    }

    let length = reviewMathDollarRunLength(line: line, from: start)
    guard length >= 2 else {
        return nil
    }
    return (line.index(start, offsetBy: length), length)
}

/// Length of the `$` run on a line whose whole content is that run.
private func reviewMathDisplayClosingRunLength(line: String) -> Int? {
    guard let start = reviewMathDisplayIndentationEnd(line: line), start < line.endIndex, line[start] == "$" else {
        return nil
    }

    let length = reviewMathDollarRunLength(line: line, from: start)
    let trailingContent = line[line.index(start, offsetBy: length)...]
    guard trailingContent.allSatisfy({ character in reviewMathCharacterIsSpace(character) }) else {
        return nil
    }
    return length
}

private func reviewMathUnescapedDollarIndex(line: String, from startIndex: String.Index) -> String.Index? {
    var index = startIndex

    while index < line.endIndex {
        if line[index] == "$", reviewMathCharacterIsUnescaped(text: line, index: index) {
            return index
        }
        index = line.index(after: index)
    }
    return nil
}

private func reviewMathDisplayConstruct(
    lines: [ReviewMathSourceLine],
    openingIndex: Int
) -> ReviewMathDisplayConstruct? {
    guard reviewMathLineIsIndentedCode(line: lines[openingIndex].content) == false,
          openingIndex == 0 || reviewMathLineIsBlank(line: lines[openingIndex - 1].content),
          let opening = reviewMathDisplayOpeningRun(line: lines[openingIndex].content) else {
        return nil
    }

    let openingLine = lines[openingIndex].content
    let openingRemainder = openingLine[opening.contentStart...]
    guard openingRemainder.allSatisfy({ character in reviewMathCharacterIsSpace(character) }) == false else {
        return reviewMathMultipleLineDisplayConstruct(
            lines: lines,
            openingIndex: openingIndex,
            openingRunLength: opening.length
        )
    }

    guard let closingStart = reviewMathUnescapedDollarIndex(line: openingLine, from: opening.contentStart),
          reviewMathDollarRunLength(line: openingLine, from: closingStart) == opening.length else {
        return nil
    }

    let afterClosing = openingLine.index(closingStart, offsetBy: opening.length)
    guard openingLine[afterClosing...].allSatisfy({ character in reviewMathCharacterIsSpace(character) }),
          openingIndex == lines.count - 1 || reviewMathLineIsBlank(line: lines[openingIndex + 1].content) else {
        return nil
    }

    return ReviewMathDisplayConstruct(
        closingIndex: openingIndex,
        latex: String(openingLine[opening.contentStart..<closingStart])
    )
}

private func reviewMathMultipleLineDisplayConstruct(
    lines: [ReviewMathSourceLine],
    openingIndex: Int,
    openingRunLength: Int
) -> ReviewMathDisplayConstruct? {
    var index = openingIndex + 1

    while index < lines.count {
        if let closingRunLength = reviewMathDisplayClosingRunLength(line: lines[index].content) {
            guard closingRunLength == openingRunLength else {
                return nil
            }

            return ReviewMathDisplayConstruct(
                closingIndex: index,
                latex: lines[(openingIndex + 1)..<index].map(\.content).joined(separator: "\n")
            )
        }
        index += 1
    }
    return nil
}

private func reviewMathDisplaySource(
    lines: [ReviewMathSourceLine],
    openingIndex: Int,
    closingIndex: Int
) -> String {
    var source = ""
    var index = openingIndex

    while index <= closingIndex {
        source += lines[index].content
        if index < closingIndex {
            source += lines[index].separator
        }
        index += 1
    }
    return source
}

private func reviewMathLineStartsContainer(line: String) -> Bool {
    reviewMathBlockquoteExpression.matches(line) || reviewMathListExpression.matches(line)
}

private func reviewMathContainerContent(line: String) -> String {
    var content = line
    while true {
        let strippedContent = reviewMathContainerPrefixExpression.replacingMatches(in: content, with: "")
        guard strippedContent != content else {
            return content
        }
        content = strippedContent
    }
}

private func reviewMathLineContinuesContainerAfterBlank(line: String) -> Bool {
    guard let firstCharacter = line.first else {
        return false
    }

    return firstCharacter == " " || firstCharacter == "\t" || reviewMathLineStartsContainer(line: line)
}

// A display opening run must be preceded by a blank line, so it never interrupts a paragraph.
private func reviewMathLineStartsParagraphBoundary(line: String) -> Bool {
    if reviewMathLineIsIndentedCode(line: line)
        || reviewMathFence(line: line) != nil {
        return true
    }

    return reviewMathReferenceDefinitionExpression.matches(line)
        || reviewMathHeadingExpression.matches(line)
        || reviewMathThematicBreakExpression.matches(line)
        || reviewMathLineStartsContainer(line: line)
        || reviewMathHTMLExpression.matches(line)
}

private func splitReviewMathParagraph(lines: [ReviewMathSourceLine]) -> [ReviewMathBlock]? {
    if lines.contains(where: { line in
        reviewMathSetextHeadingExpression.matches(line.content)
            || reviewMathTableSeparatorExpression.matches(line.content)
            || reviewMathThematicBreakExpression.matches(line.content)
    }) {
        return nil
    }
    if lines.dropLast().contains(where: { line in
        reviewMathLineHasHardBreak(line: line.content)
    }) {
        return nil
    }

    let parsedLines = lines.map { line in
        splitReviewInlineMathLine(line: line.content)
    }

    guard parsedLines.contains(where: \.containsFormula) else {
        return nil
    }

    // Intentional V1 cross-client behavior: ambiguous Markdown stays literal.
    guard reviewMathParagraphIsEligible(lines: parsedLines) else {
        return nil
    }

    var blocks: [ReviewMathBlock] = []
    var pendingMarkdown = ""

    for (lineIndex, parsedLine) in parsedLines.enumerated() {
        for part in parsedLine.parts {
            switch part {
            case .text(let text):
                pendingMarkdown += text
            case .formula(let formula):
                if pendingMarkdown.isEmpty == false {
                    blocks.append(.markdown(pendingMarkdown))
                    pendingMarkdown = ""
                }
                blocks.append(.formula(formula))
            }
        }
        pendingMarkdown += lines[lineIndex].separator
    }

    if pendingMarkdown.isEmpty == false {
        blocks.append(.markdown(pendingMarkdown))
    }
    return blocks
}

private func reviewMathParagraphIsEligible(lines: [ReviewInlineMathLine]) -> Bool {
    lines.allSatisfy { line in
        line.parts.allSatisfy { part in
            switch part {
            case .text(let text):
                return reviewMathContainsUnsupportedInlineSyntax(text: text) == false
                    && reviewMathBareURLExpression.matches(text) == false
                    && reviewMathBareEmailExpression.matches(text) == false
            case .formula:
                return true
            }
        }
    }
}

private func splitReviewInlineMathLine(line: String) -> ReviewInlineMathLine {
    var parts: [ReviewInlineMathPart] = []
    var pendingTextStart = line.startIndex
    var index = line.startIndex
    var didFindFormula = false

    while index < line.endIndex {
        guard line[index] == "$", reviewMathCharacterIsUnescaped(text: line, index: index) else {
            index = line.index(after: index)
            continue
        }

        // A run of two or more `$` is always a display fence sequence, never an inline delimiter.
        let openingRunLength = reviewMathDollarRunLength(line: line, from: index)
        if openingRunLength >= 2 {
            index = line.index(index, offsetBy: openingRunLength)
            continue
        }

        // Pandoc opening guard: a non-space character immediately to the right.
        let latexStart = line.index(after: index)
        guard latexStart < line.endIndex, reviewMathCharacterIsSpace(line[latexStart]) == false else {
            index = latexStart
            continue
        }

        switch reviewInlineMathClosingScan(line: line, latexStart: latexStart) {
        case .none:
            // No later `$` on this line, so nothing on it is left to scan.
            index = line.endIndex
        case .displayRun(let resumeIndex):
            index = resumeIndex
        case .candidate(let closingIndex):
            guard reviewInlineMathClosingGuardsHold(line: line, closingIndex: closingIndex) else {
                // The `$` that failed as a closer is itself the next candidate opener.
                index = closingIndex
                continue
            }

            if pendingTextStart < index {
                parts.append(.text(String(line[pendingTextStart..<index])))
            }

            let afterClosing = line.index(after: closingIndex)
            parts.append(
                .formula(
                    ReviewFormulaContent(
                        originalSource: String(line[index..<afterClosing]),
                        latex: String(line[latexStart..<closingIndex]),
                        continuesParagraph: true
                    )
                )
            )
            didFindFormula = true
            pendingTextStart = afterClosing
            index = afterClosing
        }
    }

    if pendingTextStart < line.endIndex {
        parts.append(.text(String(line[pendingTextStart..<line.endIndex])))
    }
    if parts.isEmpty {
        parts.append(.text(line))
    }

    return ReviewInlineMathLine(parts: parts, containsFormula: didFindFormula)
}

private func reviewInlineMathClosingScan(line: String, latexStart: String.Index) -> ReviewInlineMathClosingScan {
    var index = latexStart

    while index < line.endIndex {
        guard line[index] == "$", reviewMathCharacterIsUnescaped(text: line, index: index) else {
            index = line.index(after: index)
            continue
        }

        let runLength = reviewMathDollarRunLength(line: line, from: index)
        if runLength >= 2 {
            return .displayRun(line.index(index, offsetBy: runLength))
        }
        return .candidate(index)
    }

    return .none
}

// Pandoc closing guard: a non-space character immediately to the left, and no digit to the right.
private func reviewInlineMathClosingGuardsHold(line: String, closingIndex: String.Index) -> Bool {
    guard reviewMathCharacterIsSpace(line[line.index(before: closingIndex)]) == false else {
        return false
    }

    let afterClosingIndex = line.index(after: closingIndex)
    guard afterClosingIndex < line.endIndex else {
        return true
    }
    return reviewMathCharacterIsDigit(line[afterClosingIndex]) == false
}

private func reviewMathContainsUnsupportedInlineSyntax(text: String) -> Bool {
    text.indices.contains { index in
        reviewMathUnsupportedInlineCharacters.contains(text[index])
            && reviewMathCharacterIsUnescaped(text: text, index: index)
    }
}

private func reviewMathCharacterIsUnescaped(text: String, index: String.Index) -> Bool {
    var backslashCount = 0
    var cursor = index

    while cursor > text.startIndex {
        let previousIndex = text.index(before: cursor)
        guard text[previousIndex] == "\\" else {
            break
        }
        backslashCount += 1
        cursor = previousIndex
    }

    return backslashCount.isMultiple(of: 2)
}

private func reviewMathLineHasHardBreak(line: String) -> Bool {
    if line.reversed().prefix(while: { character in character == " " }).count >= 2 {
        return true
    }
    return line.reversed().prefix(while: { character in character == "\\" }).count.isMultiple(of: 2) == false
}

private func reviewMathSource(lines: [ReviewMathSourceLine]) -> String {
    lines.map { line in
        line.content + line.separator
    }.joined()
}
