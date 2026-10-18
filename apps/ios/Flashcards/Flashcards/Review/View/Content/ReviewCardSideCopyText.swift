import Foundation

private let reviewCopyMediaExpression = makeReviewContentRegularExpression(
    pattern: #"(!)?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#
)

func reviewCardSideCopyText(sourceText: String) throws -> String {
    let codeRanges = try reviewCopyCodeRanges(sourceText: sourceText)
    var result = ""
    var index = sourceText.startIndex

    while index < sourceText.endIndex {
        if let codeRange = codeRanges.first(where: { $0.contains(index) }) {
            result.append(contentsOf: sourceText[index..<codeRange.upperBound])
            index = codeRange.upperBound
            continue
        }

        let character = sourceText[index]
        if character == "$" {
            let runEnd = sourceText[index...].firstIndex(where: { $0 != character }) ?? sourceText.endIndex
            let delimiter = String(sourceText[index..<runEnd])
            if let end = reviewCopyDelimitedEnd(text: sourceText, from: runEnd, delimiter: delimiter) {
                result.append(contentsOf: sourceText[index..<end])
                index = end
                continue
            }
            result.append(contentsOf: sourceText[index..<runEnd])
            index = runEnd
            continue
        }

        if character == "\\" {
            let nextIndex = sourceText.index(after: index)
            if nextIndex < sourceText.endIndex {
                let nextCharacter = sourceText[nextIndex]
                if nextCharacter == "(" || nextCharacter == "[" {
                    let closingDelimiter = nextCharacter == "(" ? "\\)" : "\\]"
                    let contentStart = sourceText.index(after: nextIndex)
                    if let closing = sourceText.range(of: closingDelimiter, range: contentStart..<sourceText.endIndex) {
                        result.append(contentsOf: sourceText[index..<closing.upperBound])
                        index = closing.upperBound
                        continue
                    }
                }
                let escapeEnd = sourceText.index(after: nextIndex)
                result.append(contentsOf: sourceText[index..<escapeEnd])
                index = escapeEnd
                continue
            }
        }

        if character == "!" || character == "[",
           let match = reviewCopyMediaExpression.firstMatch(
               in: sourceText,
               options: [.anchored],
               range: NSRange(index..<sourceText.endIndex, in: sourceText)
           ),
           let destinationRange = Range(match.range(at: 3), in: sourceText),
           managedMediaAssetId(reference: String(sourceText[destinationRange])) != nil,
           let matchRange = Range(match.range, in: sourceText),
           let labelRange = Range(match.range(at: 2), in: sourceText) {
            let kind = match.range(at: 1).location == NSNotFound
                ? String(localized: "Attachment", table: "ReviewCards")
                : String(localized: "Managed image", table: "ReviewCards")
            let label = sourceText[labelRange].trimmingCharacters(in: .whitespacesAndNewlines)
            result.append(label.isEmpty ? "[\(kind)]" : "[\(kind): \(label)]")
            index = matchRange.upperBound
            continue
        }

        result.append(character)
        index = sourceText.index(after: index)
    }

    return result
}

private enum ReviewCopySourceError: LocalizedError {
    case codeSourceRangeUnavailable

    var errorDescription: String? {
        String(localized: "Could not locate a Markdown code example in the card source. Edit the card and try copying again.", table: "ReviewCards")
    }
}

private func reviewCopyCodeRanges(sourceText: String) throws -> [Range<String.Index>] {
    let markdownSource = reviewCopyMarkdownSource(sourceText: sourceText)
    let markdown = try AttributedString(
        markdown: markdownSource,
        options: .init(interpretedSyntax: .full, appliesSourcePositionAttributes: true)
    )
    let codeRanges: [Range<String.Index>] = try markdown.runs.compactMap { run in
        let isCodeBlock = run.presentationIntent?.components.contains { component in
            if case .codeBlock = component.kind { return true }
            return false
        } == true
        guard isCodeBlock || run.inlinePresentationIntent?.contains(.code) == true else { return nil }
        guard let position = run.markdownSourcePosition,
              let range = Range<String.Index>(position, in: sourceText) else {
            throw ReviewCopySourceError.codeSourceRangeUnavailable
        }
        // Foundation classifies containers and code; clipboard text always comes from the original source.
        return range
    }
    return codeRanges + reviewCopyEmptyFenceRanges(sourceText: sourceText, markdownSource: markdownSource)
}

private func reviewCopyMarkdownSource(sourceText: String) -> String {
    guard case .segmented(let blocks) = extractReviewMathBlocks(text: sourceText) else {
        return sourceText
    }

    var bytes = Array(sourceText.utf8)
    var offset = 0
    for block in blocks {
        switch block {
        case .markdown(let source):
            offset += source.utf8.count
        case .formula(let formula):
            let end = offset + formula.originalSource.utf8.count
            // Mask ASCII syntax only, preserving newlines, UTF-8 columns and UTF-16 lengths.
            for index in offset..<end where bytes[index] < 128 && bytes[index] != 10 && bytes[index] != 13 {
                bytes[index] = 32
            }
            offset = end
        }
    }
    return String(decoding: bytes, as: UTF8.self)
}

private func reviewCopyEmptyFenceRanges(sourceText: String, markdownSource: String) -> [Range<String.Index>] {
    var ranges: [Range<String.Index>] = []
    var lineStart = sourceText.startIndex
    let markdown = markdownSource as NSString

    while lineStart < sourceText.endIndex {
        let lineEnd = sourceText[lineStart...].firstIndex(where: \.isNewline) ?? sourceText.endIndex
        let nextLine = lineEnd < sourceText.endIndex ? sourceText.index(after: lineEnd) : lineEnd
        let line = markdown.substring(with: NSRange(lineStart..<lineEnd, in: sourceText))
        if nextLine < sourceText.endIndex, let fence = reviewMathFence(line: line) {
            let closingEnd = sourceText[nextLine...].firstIndex(where: \.isNewline) ?? sourceText.endIndex
            let closingLine = markdown.substring(with: NSRange(nextLine..<closingEnd, in: sourceText))
            // Empty fences may have no attributed run to protect their info string.
            if reviewMathFenceCloses(line: closingLine, openingFence: fence) {
                ranges.append(lineStart..<closingEnd)
            }
        }
        lineStart = nextLine
    }
    return ranges
}

private func reviewCopyDelimitedEnd(text: String, from start: String.Index, delimiter: String) -> String.Index? {
    var searchStart = start
    while let closing = text.range(of: delimiter, range: searchStart..<text.endIndex) {
        let hasLongerRunBefore = closing.lowerBound > text.startIndex
            && text[text.index(before: closing.lowerBound)] == delimiter.first
        let hasLongerRunAfter = closing.upperBound < text.endIndex
            && text[closing.upperBound] == delimiter.first
        if hasLongerRunBefore == false && hasLongerRunAfter == false {
            var backslashCount = 0
            var escapeIndex = closing.lowerBound
            while escapeIndex > text.startIndex {
                let previous = text.index(before: escapeIndex)
                guard text[previous] == "\\" else { break }
                backslashCount += 1
                escapeIndex = previous
            }
            if backslashCount.isMultiple(of: 2) {
                if delimiter == "$" {
                    guard start < closing.lowerBound,
                          text[start].isWhitespace == false,
                          text[text.index(before: closing.lowerBound)].isWhitespace == false,
                          text[start..<closing.lowerBound].contains(where: \.isNewline) == false,
                          closing.upperBound == text.endIndex || text[closing.upperBound].isNumber == false else {
                        return nil
                    }
                }
                return closing.upperBound
            }
        }
        searchStart = closing.upperBound
    }
    return nil
}
