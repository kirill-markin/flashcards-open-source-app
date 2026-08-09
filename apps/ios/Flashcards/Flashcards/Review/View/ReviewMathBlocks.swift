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

private struct ReviewMathFence {
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

private let reviewMathReferenceDefinitionExpression = makeReviewContentRegularExpression(pattern: #"^ {0,3}\[[^\]]+\]:"#)
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

        if line.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
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

                if reviewMathFenceCloses(line: fencedLine.content, fence: fence) {
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

        if reviewMathLineIsDisplayDelimiter(line: line.content) {
            guard let closingIndex = reviewMathDisplayClosingIndex(lines: lines, openingIndex: lineIndex) else {
                pendingMarkdown += line.content + line.separator
                lineIndex += 1
                continue
            }

            if pendingMarkdown.isEmpty == false {
                blocks.append(.markdown(pendingMarkdown))
                pendingMarkdown = ""
            }

            let originalSource = reviewMathDisplaySource(
                lines: lines,
                openingIndex: lineIndex,
                closingIndex: closingIndex
            )
            let latex = reviewMathDisplayLatex(
                lines: lines,
                openingIndex: lineIndex,
                closingIndex: closingIndex
            )
            blocks.append(
                .formula(
                    ReviewFormulaContent(
                        originalSource: originalSource,
                        latex: latex,
                        continuesParagraph: false
                    )
                )
            )
            pendingMarkdown += lines[closingIndex].separator
            didFindFormula = true
            lineIndex = closingIndex + 1
            continue
        }

        if reviewMathLineStartsContainer(line: line.content) || reviewMathHTMLExpression.matches(line.content) {
            let detectsContainerReferences = reviewMathLineStartsContainer(line: line.content)
            var containerFence: ReviewMathFence?

            while lineIndex < lines.count {
                while lineIndex < lines.count
                    && lines[lineIndex].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                    let containerLine = lines[lineIndex]
                    pendingMarkdown += containerLine.content + containerLine.separator

                    if detectsContainerReferences {
                        let containerContent = reviewMathContainerContent(line: containerLine.content)
                        if let fence = containerFence {
                            if reviewMathFenceCloses(line: containerContent, fence: fence) {
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
                    && lines[lineIndex].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
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
            && lines[lineIndex].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
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

private func reviewMathFence(line: String) -> ReviewMathFence? {
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

    return ReviewMathFence(marker: marker, minimumLength: markerLength)
}

private func reviewMathFenceCloses(line: String, fence: ReviewMathFence) -> Bool {
    let content = line.dropFirst(min(reviewMathLeadingSpaceCount(line: line), 3))
    let markerLength = content.prefix(while: { character in
        character == fence.marker
    }).count
    guard markerLength >= fence.minimumLength else {
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

private func reviewMathLineIsDisplayDelimiter(line: String) -> Bool {
    guard reviewMathLineIsIndentedCode(line: line) == false else {
        return false
    }

    return line.trimmingCharacters(in: .whitespacesAndNewlines) == "$$"
}

private func reviewMathDisplayClosingIndex(
    lines: [ReviewMathSourceLine],
    openingIndex: Int
) -> Int? {
    var index = openingIndex + 1
    while index < lines.count {
        if reviewMathLineIsDisplayDelimiter(line: lines[index].content) {
            return index
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

private func reviewMathDisplayLatex(
    lines: [ReviewMathSourceLine],
    openingIndex: Int,
    closingIndex: Int
) -> String {
    guard closingIndex > openingIndex + 1 else {
        return ""
    }

    return lines[(openingIndex + 1)..<closingIndex]
        .map(\.content)
        .joined(separator: "\n")
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

private func reviewMathLineStartsParagraphBoundary(line: String) -> Bool {
    if reviewMathLineIsIndentedCode(line: line)
        || reviewMathLineIsDisplayDelimiter(line: line)
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

    var parsedLines: [ReviewInlineMathLine] = []
    for line in lines {
        guard let parsedLine = splitReviewInlineMathLine(line: line.content) else {
            return nil
        }
        parsedLines.append(parsedLine)
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

private func splitReviewInlineMathLine(line: String) -> ReviewInlineMathLine? {
    var parts: [ReviewInlineMathPart] = []
    var pendingTextStart = line.startIndex
    var index = line.startIndex
    var didFindFormula = false

    while index < line.endIndex {
        guard line[index] == "$", reviewMathCharacterIsUnescaped(text: line, index: index) else {
            index = line.index(after: index)
            continue
        }

        let afterDollar = line.index(after: index)
        if afterDollar < line.endIndex, line[afterDollar] == "$" {
            index = line.index(after: afterDollar)
            continue
        }

        guard let closingIndex = reviewInlineMathClosingIndex(line: line, openingIndex: index) else {
            return nil
        }

        if pendingTextStart < index {
            parts.append(.text(String(line[pendingTextStart..<index])))
        }

        let latexStart = line.index(after: index)
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

    if pendingTextStart < line.endIndex {
        parts.append(.text(String(line[pendingTextStart..<line.endIndex])))
    }
    if parts.isEmpty {
        parts.append(.text(line))
    }

    return ReviewInlineMathLine(parts: parts, containsFormula: didFindFormula)
}

private func reviewInlineMathClosingIndex(line: String, openingIndex: String.Index) -> String.Index? {
    var index = line.index(after: openingIndex)

    while index < line.endIndex {
        guard line[index] == "$", reviewMathCharacterIsUnescaped(text: line, index: index) else {
            index = line.index(after: index)
            continue
        }

        let afterDollar = line.index(after: index)
        if afterDollar < line.endIndex, line[afterDollar] == "$" {
            index = line.index(after: afterDollar)
            continue
        }
        return index
    }

    return nil
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

func normalizeReviewInlineMathParagraphContinuation(markdown: String) -> String {
    guard let firstCharacter = markdown.first, firstCharacter != "\r", firstCharacter != "\n" else {
        return markdown
    }

    // A mid-paragraph fragment must not acquire document-level block syntax after splitting.
    let leadingWhitespaceCount = markdown.prefix(while: { character in
        character == " " || character == "\t"
    }).count
    let content = String(markdown.dropFirst(leadingWhitespaceCount))
    let normalizedPrefix = leadingWhitespaceCount == 0 ? "" : " "
    let startsHeading = makeReviewContentRegularExpression(
        pattern: #"^#{1,6}(?:[ \t]+|$)"#
    ).matches(content)
    let startsUnorderedList = makeReviewContentRegularExpression(
        pattern: #"^[-+*](?:[ \t]+|$)"#
    ).matches(content)
    let startsThematicBreak = makeReviewContentRegularExpression(
        pattern: #"^(?:-[ \t]*){3,}(?:\r?\n|$)"#
    ).matches(content)
    if startsHeading || startsUnorderedList || startsThematicBreak {
        return normalizedPrefix + "\\" + content
    }

    let digitCount = content.prefix(while: { character in
        "0123456789".contains(character)
    }).count
    guard digitCount > 0, digitCount <= 9, digitCount < content.count else {
        return normalizedPrefix + content
    }
    let punctuationIndex = content.index(content.startIndex, offsetBy: digitCount)
    let afterPunctuationIndex = content.index(after: punctuationIndex)
    guard (content[punctuationIndex] == "." || content[punctuationIndex] == ")"),
          afterPunctuationIndex == content.endIndex
            || " \t\r\n".contains(content[afterPunctuationIndex]) else {
        return normalizedPrefix + content
    }

    var escapedContent = content
    escapedContent.insert("\\", at: punctuationIndex)
    return normalizedPrefix + escapedContent
}

private func reviewMathSource(lines: [ReviewMathSourceLine]) -> String {
    lines.map { line in
        line.content + line.separator
    }.joined()
}
