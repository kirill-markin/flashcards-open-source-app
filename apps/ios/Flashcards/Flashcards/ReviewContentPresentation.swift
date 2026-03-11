import Foundation

enum ReviewContentPresentationMode: Equatable {
    case shortPlain
    case paragraphPlain
    case markdown
}

enum ReviewRenderedContent {
    case shortPlain(String)
    case paragraphPlain(String)
    case markdown(AttributedString)
    case markdownFailure(String)
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

func makeReviewMarkdownAttributedString(text: String) throws -> AttributedString {
    try AttributedString(
        markdown: text,
        options: AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .full,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
    )
}

func makeReviewRenderedContent(text: String) -> ReviewRenderedContent {
    switch classifyReviewContentPresentation(text: text) {
    case .shortPlain:
        return .shortPlain(text)
    case .paragraphPlain:
        return .paragraphPlain(text)
    case .markdown:
        do {
            return .markdown(try makeReviewMarkdownAttributedString(text: text))
        } catch {
            return .markdownFailure(error.localizedDescription)
        }
    }
}

private func hasStrongMarkdownCue(text: String) -> Bool {
    let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
    return reviewContentMarkdownExpressions.contains { expression in
        expression.firstMatch(in: text, options: [], range: fullRange) != nil
    }
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
