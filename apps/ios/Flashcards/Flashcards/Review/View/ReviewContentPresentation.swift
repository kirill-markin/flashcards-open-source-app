import Foundation
// `MarkdownUI` pulls in `NetworkImage` transitively:
// https://github.com/gonzalezreal/NetworkImage
// The package is relatively niche, but it is maintained by the same author as `MarkdownUI`,
// which is why we accept it as part of the iOS markdown rendering stack.
import MarkdownUI

/*
 Keep review content presentation heuristics aligned with:
 - apps/web/src/screens/reviewContentPresentation.ts
 - apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/presentation/ReviewContentParser.kt
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
    case managedMarkdown(ReviewManagedMarkdownContent)
}

struct ReviewManagedMarkdownContent {
    let blocks: [ReviewManagedMarkdownBlock]

    init(blocks: [ReviewManagedMarkdownBlock]) {
        self.blocks = blocks
    }
}

enum ReviewManagedMarkdownBlock {
    case markdown(MarkdownContent)
    case formula(ReviewFormulaContent)
    case managedMedia(ReviewManagedMediaReference)
}

struct ReviewFormulaContent {
    let originalSource: String
    let latex: String
    let continuesParagraph: Bool

    init(originalSource: String, latex: String, continuesParagraph: Bool) {
        self.originalSource = originalSource
        self.latex = latex
        self.continuesParagraph = continuesParagraph
    }
}

struct ReviewManagedMediaReference: Hashable {
    let mediaAssetId: String
    let state: ManagedMediaAssetReferenceState
    let label: String?
    let isImageSyntax: Bool

    init(
        mediaAssetId: String,
        state: ManagedMediaAssetReferenceState,
        label: String?,
        isImageSyntax: Bool
    ) {
        self.mediaAssetId = mediaAssetId
        self.state = state
        self.label = label
        self.isImageSyntax = isImageSyntax
    }
}

private let reviewShortPlainWordLimit: Int = 4
private let reviewShortPlainVisibleCharacterLimit: Int = 48
private let reviewContentMarkdownExpressions: [NSRegularExpression] = [
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}#{1,6}\s+\S"#),
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}>\s+\S"#),
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}[-*+]\s+\S"#),
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}\d+\.\s+\S"#),
    makeReviewContentRegularExpression(pattern: #"^\s{0,3}(?:```|~~~)"#),
    makeReviewContentRegularExpression(pattern: #"!?\[[^\]]*\]\([^)]+\)"#),
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
private let reviewManagedMediaReferenceExpression = makeReviewContentRegularExpression(
    pattern: #"(!)?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#
)

func classifyReviewContentPresentation(text: String) -> ReviewContentPresentationMode {
    let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)

    if trimmedText.contains("`") {
        return .markdown
    }

    if hasStrongMarkdownCue(text: trimmedText) {
        return .markdown
    }

    switch extractReviewMathBlocks(text: text) {
    case .literalMarkdown, .segmented:
        return .markdown
    case .none:
        break
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
    switch extractReviewMathBlocks(text: text) {
    case .segmented(let mathBlocks):
        return .managedMarkdown(makeReviewSegmentedMarkdownContent(mathBlocks: mathBlocks))
    case .literalMarkdown:
        if let managedMarkdownContent = makeReviewManagedMarkdownContent(text: text) {
            return .managedMarkdown(managedMarkdownContent)
        }
        return .markdown(makeReviewMarkdownContent(text: text))
    case .none:
        break
    }

    if let managedMarkdownContent = makeReviewManagedMarkdownContent(text: text) {
        return .managedMarkdown(managedMarkdownContent)
    }

    switch classifyReviewContentPresentation(text: text) {
    case .shortPlain:
        return .shortPlain(normalizeReviewPlainTextEscapedDollars(text: text))
    case .paragraphPlain:
        return .paragraphPlain(normalizeReviewPlainTextEscapedDollars(text: text))
    case .markdown:
        return .markdown(makeReviewMarkdownContent(text: text))
    }
}

func parseManagedMediaAssetId(reference: String) -> String? {
    managedMediaAssetId(reference: reference)
}

func makeReviewSpeakableText(text: String) -> String {
    let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmedText.isEmpty {
        return ""
    }

    switch extractReviewMathBlocks(text: text) {
    case .segmented(let mathBlocks):
        return mathBlocks.map { block in
            switch block {
            case .markdown(let source):
                return makeReviewSpeakableTextWithoutMath(text: source)
            case .formula(let formula):
                return formula.latex
            }
        }.filter { segment in
            segment.isEmpty == false
        }.joined(separator: "\n")
    case .literalMarkdown:
        return makeReviewSpeakableTextWithoutMath(text: text)
    case .none:
        if classifyReviewContentPresentation(text: text) != .markdown {
            let plainText = normalizeReviewPlainTextEscapedDollars(text: text)
            return normalizeReviewSpeakableLines(lines: plainText.components(separatedBy: .newlines))
        }
        return makeReviewSpeakableTextWithoutMath(text: text)
    }
}

private func makeReviewSpeakableTextWithoutMath(text: String) -> String {
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

private func makeReviewSegmentedMarkdownContent(
    mathBlocks: [ReviewMathBlock]
) -> ReviewManagedMarkdownContent {
    var blocks: [ReviewManagedMarkdownBlock] = []
    var normalizesNextMarkdownFragment = false

    for mathBlock in mathBlocks {
        switch mathBlock {
        case .markdown(let text):
            let renderedText = normalizesNextMarkdownFragment
                ? normalizeReviewInlineMathParagraphContinuation(markdown: text)
                : text
            if let managedMarkdownContent = makeReviewManagedMarkdownContent(text: renderedText) {
                blocks.append(contentsOf: managedMarkdownContent.blocks)
            } else {
                appendReviewMarkdownBlock(text: renderedText, blocks: &blocks)
            }
            normalizesNextMarkdownFragment = false
        case .formula(let formula):
            blocks.append(.formula(formula))
            normalizesNextMarkdownFragment = formula.continuesParagraph
        }
    }

    return ReviewManagedMarkdownContent(blocks: blocks)
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
    reviewSpeakableTextReplacingManagedMediaReferences(text: text)
        .replacingOccurrences(of: "`", with: "")
        .replacingOccurrences(of: "|", with: " ")
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func makeReviewManagedMarkdownContent(text: String) -> ReviewManagedMarkdownContent? {
    var activeFenceMarker: String? = nil
    var pendingMarkdownLines: [String] = []
    var blocks: [ReviewManagedMarkdownBlock] = []
    var didFindManagedMedia = false

    for line in text.components(separatedBy: .newlines) {
        let fenceMarker = reviewFenceMarker(line: line)

        if let currentFenceMarker = activeFenceMarker {
            pendingMarkdownLines.append(line)
            if fenceMarker == currentFenceMarker {
                activeFenceMarker = nil
            }
            continue
        }

        if let fenceMarker {
            activeFenceMarker = fenceMarker
            pendingMarkdownLines.append(line)
            continue
        }

        let lineBlocks = splitReviewManagedMediaLine(line: line)
        if lineBlocks.contains(where: { block in
            if case .managedMedia = block {
                return true
            }
            return false
        }) == false {
            pendingMarkdownLines.append(line)
            continue
        }

        appendReviewPendingMarkdownBlocks(lines: &pendingMarkdownLines, blocks: &blocks)
        blocks.append(contentsOf: lineBlocks)
        didFindManagedMedia = true
    }

    appendReviewPendingMarkdownBlocks(lines: &pendingMarkdownLines, blocks: &blocks)
    guard didFindManagedMedia else {
        return nil
    }

    return ReviewManagedMarkdownContent(blocks: blocks)
}

private func splitReviewManagedMediaLine(line: String) -> [ReviewManagedMarkdownBlock] {
    let fullRange = NSRange(line.startIndex..<line.endIndex, in: line)
    let matches = reviewManagedMediaReferenceExpression.matches(in: line, options: [], range: fullRange)
    guard matches.isEmpty == false else {
        return [.markdown(makeReviewMarkdownContent(text: line))]
    }

    var blocks: [ReviewManagedMarkdownBlock] = []
    var currentIndex = line.startIndex
    var didFindManagedMedia = false

    for match in matches {
        guard let urlRange = Range(match.range(at: 3), in: line) else {
            continue
        }
        let rawReference = String(line[urlRange])
        guard let mediaAssetId = parseManagedMediaAssetId(reference: rawReference),
              let state = managedMediaAssetReferenceState(reference: rawReference),
              let matchRange = Range(match.range, in: line) else {
            continue
        }

        let precedingText = String(line[currentIndex..<matchRange.lowerBound])
        appendReviewMarkdownBlock(text: precedingText, blocks: &blocks)

        let label = reviewManagedMediaLabel(line: line, match: match)
        let isImageSyntax = match.range(at: 1).location != NSNotFound
        blocks.append(
            .managedMedia(
                ReviewManagedMediaReference(
                    mediaAssetId: mediaAssetId,
                    state: state,
                    label: label,
                    isImageSyntax: isImageSyntax
                )
            )
        )
        currentIndex = matchRange.upperBound
        didFindManagedMedia = true
    }

    guard didFindManagedMedia else {
        return [.markdown(makeReviewMarkdownContent(text: line))]
    }

    appendReviewMarkdownBlock(text: String(line[currentIndex..<line.endIndex]), blocks: &blocks)
    return blocks
}

private func appendReviewPendingMarkdownBlocks(
    lines: inout [String],
    blocks: inout [ReviewManagedMarkdownBlock]
) {
    let markdownText = lines.joined(separator: "\n")
    lines.removeAll()
    appendReviewMarkdownBlock(text: markdownText, blocks: &blocks)
}

private func appendReviewMarkdownBlock(text: String, blocks: inout [ReviewManagedMarkdownBlock]) {
    guard text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
        return
    }

    blocks.append(.markdown(makeReviewMarkdownContent(text: text)))
}

private func reviewManagedMediaLabel(line: String, match: NSTextCheckingResult) -> String? {
    guard let labelRange = Range(match.range(at: 2), in: line) else {
        return nil
    }

    let label = String(line[labelRange]).trimmingCharacters(in: .whitespacesAndNewlines)
    return label.isEmpty ? nil : label
}

private func reviewSpeakableTextReplacingManagedMediaReferences(text: String) -> String {
    let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
    let matches = reviewManagedMediaReferenceExpression.matches(in: text, options: [], range: fullRange).reversed()
    var output = text

    for match in matches {
        guard let urlRange = Range(match.range(at: 3), in: output) else {
            continue
        }
        let rawReference = String(output[urlRange])
        guard parseManagedMediaAssetId(reference: rawReference) != nil,
              managedMediaAssetReferenceState(reference: rawReference) != nil,
              let matchRange = Range(match.range, in: output) else {
            continue
        }

        let label = reviewManagedMediaLabel(line: output, match: match) ?? ""
        output.replaceSubrange(matchRange, with: label)
    }

    return output
}

func makeReviewContentRegularExpression(pattern: String) -> NSRegularExpression {
    do {
        return try NSRegularExpression(
            pattern: pattern,
            options: [.anchorsMatchLines]
        )
    } catch {
        fatalError("Invalid review content regex pattern: \(pattern)")
    }
}

extension NSRegularExpression {
    func matches(_ text: String) -> Bool {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return self.firstMatch(in: text, options: [], range: range) != nil
    }

    func replacingMatches(in text: String, with replacement: String) -> String {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return self.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: replacement)
    }
}
