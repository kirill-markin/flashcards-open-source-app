import Foundation
// `MarkdownUI` pulls in `NetworkImage` transitively:
// https://github.com/gonzalezreal/NetworkImage
// The package is relatively niche, but it is maintained by the same author as `MarkdownUI`,
// which is why we accept it as part of the iOS markdown rendering stack.
import MarkdownUI

/*
 Keep review content presentation heuristics aligned with:
 - apps/web/src/screens/reviewContentPresentation.ts
 - apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewPresentation.kt
 */

enum ReviewContentPresentationMode: Equatable {
    case shortPlain
    case paragraphPlain
    case markdown
}

enum ReviewRenderedContent {
    case shortPlain(String)
    case paragraphPlain(String)
    case markdown(MarkdownContent)
}

private let reviewShortPlainWordLimit: Int = 4
private let reviewShortPlainVisibleCharacterLimit: Int = 48
private let reviewContentMarkdownExpressions: [NSRegularExpression] = [
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}#{1,6}\s+\S"#),
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}>\s+\S"#),
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}[-*+]\s+\S"#),
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}\d+\.\s+\S"#),
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}(?:```|~~~)"#),
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$"#),
    makeReviewContentRegularExpression(pattern: #"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$"#)
]
private let reviewContentFenceExpression = makeReviewContentRegularExpression(pattern: #"^\s{0,3}(`{3,}|~{3,})"#)
private let reviewContentHeadingExpression = makeReviewContentRegularExpression(pattern: #"^\s{0,3}#{1,6}\s+"#)
private let reviewContentBlockquoteExpression = makeReviewContentRegularExpression(pattern: #"^\s{0,3}>\s?"#)
private let reviewContentUnorderedListExpression = makeReviewContentRegularExpression(pattern: #"^\s{0,3}[-*+]\s+"#)
private let reviewContentOrderedListExpression = makeReviewContentRegularExpression(pattern: #"^\s{0,3}\d+\.\s+"#)
private let reviewContentThematicBreakExpression = makeReviewContentRegularExpression(pattern: #"^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$"#)
private let reviewContentTableSeparatorExpression = makeReviewContentRegularExpression(pattern: #"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$"#)

func classifyReviewContentPresentation(text: String) -> ReviewContentPresentationMode {
    let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)

    if trimmedText.contains("`") {
        return .markdown
    }

    if hasStrongMarkdownCue(text: trimmedText) {
        return .markdown
    }

    if trimmedText.isEmpty {
        return .paragraphPlain
    }

    if trimmedText.contains("\n") || trimmedText.contains("\r") {
        return .paragraphPlain
    }

    let wordCount = trimmedText.split(whereSeparator: \.isWhitespace).count
    if wordCount < 1 || wordCount > reviewShortPlainWordLimit {
        return .paragraphPlain
    }

    if trimmedText.count > reviewShortPlainVisibleCharacterLimit {
        return .paragraphPlain
    }

    return .shortPlain
}

func makeReviewMarkdownContent(text: String) -> MarkdownContent {
    MarkdownContent(text)
}

func makeReviewRenderedContent(text: String) -> ReviewRenderedContent {
    switch classifyReviewContentPresentation(text: text) {
    case .shortPlain:
        return .shortPlain(text)
    case .paragraphPlain:
        return .paragraphPlain(text)
    case .markdown:
        return .markdown(makeReviewMarkdownContent(text: text))
    }
}

func makeReviewSpeakableText(text: String) -> String {
    let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedText.isEmpty {
        return ""
    }

    if classifyReviewContentPresentation(text: text) != .markdown {
        return normalizeReviewSpeakableLines(lines: text.components(separatedBy: .newlines))
    }

    var activeFenceMarker: String? = nil
    var speakableLines: [String] = []

    for line in text.components(separatedBy: .newlines) {
        let fenceMarker = reviewFenceMarker(line: line)

        if let currentFenceMarker = activeFenceMarker {
            if fenceMarker == currentFenceMarker {
                activeFenceMarker = nil
            }

            continue
        }

        if let fenceMarker {
            activeFenceMarker = fenceMarker
            continue
        }

        let normalizedLine = normalizeReviewSpeakableMarkdownLine(line: line)
        if normalizedLine.isEmpty == false {
            speakableLines.append(normalizedLine)
        }
    }

    return normalizeReviewSpeakableLines(lines: speakableLines)
}

private func hasStrongMarkdownCue(text: String) -> Bool {
    let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
    return reviewContentMarkdownExpressions.contains { expression in
        expression.firstMatch(in: text, options: [], range: fullRange) != nil
    }
}

private func reviewFenceMarker(line: String) -> String? {
    let range = NSRange(line.startIndex..<line.endIndex, in: line)
    guard let match = reviewContentFenceExpression.firstMatch(in: line, options: [], range: range),
          let markerRange = Range(match.range(at: 1), in: line) else {
        return nil
    }

    return String(line[markerRange])
}

private func normalizeReviewSpeakableMarkdownLine(line: String) -> String {
    let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedLine.isEmpty {
        return ""
    }

    if reviewContentThematicBreakExpression.matches(trimmedLine) || reviewContentTableSeparatorExpression.matches(trimmedLine) {
        return ""
    }

    let withoutHeading = reviewContentHeadingExpression.replacingMatches(in: trimmedLine, with: "")
    let withoutQuote = reviewContentBlockquoteExpression.replacingMatches(in: withoutHeading, with: "")
    let withoutUnorderedList = reviewContentUnorderedListExpression.replacingMatches(in: withoutQuote, with: "")
    let withoutOrderedList = reviewContentOrderedListExpression.replacingMatches(in: withoutUnorderedList, with: "")

    return normalizeReviewSpeakableInlineText(text: withoutOrderedList)
}

private func normalizeReviewSpeakableLines(lines: [String]) -> String {
    lines.map { line in
        normalizeReviewSpeakableInlineText(text: line)
    }.filter { line in
        line.isEmpty == false
    }.joined(separator: "\n")
}

private func normalizeReviewSpeakableInlineText(text: String) -> String {
    text.replacingOccurrences(of: "`", with: "")
        .replacingOccurrences(of: "|", with: " ")
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func makeReviewContentRegularExpression(pattern: String) -> NSRegularExpression {
    do {
        return try NSRegularExpression(
            pattern: pattern,
            options: [.anchorsMatchLines]
        )
    } catch {
        fatalError("Invalid review content regex pattern: \(pattern)")
    }
}

private extension NSRegularExpression {
    func matches(_ text: String) -> Bool {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return self.firstMatch(in: text, options: [], range: range) != nil
    }

    func replacingMatches(in text: String, with replacement: String) -> String {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return self.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: replacement)
    }
}
