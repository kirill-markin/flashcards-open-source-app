import Foundation

// Inline, full, collapsed and shortcut forms; a label never spans `[`, so a linked image matches its inner image.
private let reviewCopyMediaExpression = makeReviewContentRegularExpression(
    pattern: #"(!)?\[([^\[\]]*)\](?:\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\[\]]*)\])?"#
)
private let reviewCopyReferenceDefinitionExpression = makeReviewContentRegularExpression(
    pattern: #"^ {0,3}\[((?:\\.|[^\\\]])+)\]:[ \t]*<?([^\s>]+)>?.*$"#
)

private struct ReviewCopyReferenceDefinition {
    let label: String
    let destination: String
    let range: Range<String.Index>
}

/// The readable text of a card side, shared by the Copy button and the Select text sheet: the source Markdown with
/// each managed media reference replaced by its label, or removed when it has none, as the in-card selection copies.
func reviewCardSideCopyText(sourceText: String) throws -> String {
    let markdownSource = reviewCopyMarkdownSource(sourceText: sourceText)
    let codeRanges = try reviewCopyCodeRanges(sourceText: sourceText, markdownSource: markdownSource)
    let definitions = reviewCopyReferenceDefinitions(
        sourceText: sourceText,
        markdownSource: markdownSource,
        codeRanges: codeRanges
    )
    var destinationsByLabel: [String: String] = [:]
    for definition in definitions where destinationsByLabel[definition.label] == nil {
        destinationsByLabel[definition.label] = definition.destination
    }
    // Definition lines stay as written, so their `[label]` is never read as a shortcut reference.
    let verbatimRanges = codeRanges + definitions.map(\.range)
    var result = ""
    var removedMediaOffsets: [Int] = []
    var index = sourceText.startIndex

    while index < sourceText.endIndex {
        if let verbatimRange = verbatimRanges.first(where: { $0.contains(index) }) {
            result.append(contentsOf: sourceText[index..<verbatimRange.upperBound])
            index = verbatimRange.upperBound
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
           let matchRange = Range(match.range, in: sourceText),
           let labelRange = Range(match.range(at: 2), in: sourceText),
           let destination = reviewCopyMediaDestination(
               match: match,
               sourceText: sourceText,
               labelRange: labelRange,
               destinationsByLabel: destinationsByLabel
           ),
           managedMediaAssetId(reference: destination) != nil {
            let label = sourceText[labelRange].trimmingCharacters(in: .whitespacesAndNewlines)
            if label.isEmpty || label == destination {
                removedMediaOffsets.append(result.utf8.count)
            } else {
                result.append(label)
            }
            index = matchRange.upperBound
            continue
        }

        result.append(character)
        index = sourceText.index(after: index)
    }

    return reviewCopyTextRemovingEmptiedLines(text: result, removedMediaOffsets: removedMediaOffsets)
}

private func reviewCopyMediaDestination(
    match: NSTextCheckingResult,
    sourceText: String,
    labelRange: Range<String.Index>,
    destinationsByLabel: [String: String]
) -> String? {
    if let destinationRange = Range(match.range(at: 3), in: sourceText) {
        return String(sourceText[destinationRange])
    }
    let reference = Range(match.range(at: 4), in: sourceText).map { sourceText[$0] } ?? ""
    // A collapsed `[label][]` and a shortcut `[label]` both use their own label as the reference.
    let label = reference.isEmpty ? sourceText[labelRange] : reference
    return destinationsByLabel[reviewCopyNormalizedReferenceLabel(label: label)]
}

/// CommonMark matches reference labels case-insensitively with inner whitespace collapsed.
private func reviewCopyNormalizedReferenceLabel(label: Substring) -> String {
    label.split(whereSeparator: \.isWhitespace)
        .joined(separator: " ")
        .folding(options: .caseInsensitive, locale: nil)
}

private func reviewCopyReferenceDefinitions(
    sourceText: String,
    markdownSource: String,
    codeRanges: [Range<String.Index>]
) -> [ReviewCopyReferenceDefinition] {
    // Math is masked in markdownSource, which keeps the source offsets, so a definition inside math never matches.
    let matches = reviewCopyReferenceDefinitionExpression.matches(
        in: markdownSource,
        options: [],
        range: NSRange(markdownSource.startIndex..<markdownSource.endIndex, in: markdownSource)
    )
    return matches.compactMap { match in
        guard let range = Range(match.range, in: sourceText),
              let labelRange = Range(match.range(at: 1), in: sourceText),
              let destinationRange = Range(match.range(at: 2), in: sourceText),
              codeRanges.contains(where: { $0.contains(range.lowerBound) }) == false else {
            return nil
        }
        let label = reviewCopyNormalizedReferenceLabel(label: sourceText[labelRange])
        guard label.isEmpty == false else { return nil }
        return ReviewCopyReferenceDefinition(
            label: label,
            destination: String(sourceText[destinationRange]),
            range: range
        )
    }
}

private struct ReviewCopyLine {
    let content: Substring
    let lineBreak: Substring
    let hasRemovedMedia: Bool

    var isBlank: Bool {
        self.content.allSatisfy(\.isWhitespace)
    }
}

/// A run of blank lines that includes a line emptied by removed media becomes one paragraph break,
/// or none inside a paragraph and at the text edges, so `Question\n\n![](fcasset:x)` copies `Question`.
private func reviewCopyTextRemovingEmptiedLines(text: String, removedMediaOffsets: [Int]) -> String {
    let lines = reviewCopyLines(text: text, removedMediaOffsets: removedMediaOffsets)
    var keptLines: [ReviewCopyLine] = []
    var dropsFinalLineBreak = false
    var index = 0

    while index < lines.count {
        guard lines[index].isBlank else {
            keptLines.append(lines[index])
            index += 1
            continue
        }

        let runEnd = lines[index...].firstIndex(where: { $0.isBlank == false }) ?? lines.count
        let run = lines[index..<runEnd]
        if run.contains(where: \.hasRemovedMedia) == false {
            keptLines.append(contentsOf: run)
        } else if runEnd == lines.count {
            dropsFinalLineBreak = true
        } else if index > 0, let paragraphBreak = run.first(where: { $0.hasRemovedMedia == false }) {
            keptLines.append(paragraphBreak)
        }
        index = runEnd
    }

    return keptLines.enumerated().map { offset, line in
        let isFinalLine = offset == keptLines.count - 1
        return String(line.content) + (dropsFinalLineBreak && isFinalLine ? "" : String(line.lineBreak))
    }.joined()
}

private func reviewCopyLines(text: String, removedMediaOffsets: [Int]) -> [ReviewCopyLine] {
    var lines: [ReviewCopyLine] = []
    var remainingOffsets = removedMediaOffsets[...]
    var lineStart = text.startIndex

    while true {
        let contentEnd = text[lineStart...].firstIndex(where: \.isNewline) ?? text.endIndex
        let lineEnd = contentEnd < text.endIndex ? text.index(after: contentEnd) : contentEnd
        let contentEndOffset = text.utf8.distance(from: text.startIndex, to: contentEnd)
        var hasRemovedMedia = false
        while let offset = remainingOffsets.first, offset <= contentEndOffset {
            hasRemovedMedia = true
            remainingOffsets.removeFirst()
        }
        lines.append(ReviewCopyLine(
            content: text[lineStart..<contentEnd],
            lineBreak: text[contentEnd..<lineEnd],
            hasRemovedMedia: hasRemovedMedia
        ))
        if contentEnd == text.endIndex {
            return lines
        }
        lineStart = lineEnd
    }
}

private enum ReviewCopySourceError: LocalizedError {
    case codeSourceRangeUnavailable

    var errorDescription: String? {
        String(localized: "Could not locate a Markdown code example in the card source. Edit the card and try copying again.", table: "ReviewCards")
    }
}

private func reviewCopyCodeRanges(sourceText: String, markdownSource: String) throws -> [Range<String.Index>] {
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
