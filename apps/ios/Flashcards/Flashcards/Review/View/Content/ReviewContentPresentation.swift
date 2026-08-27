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
    /// A Markdown fragment together with only the accepted inline formulas it references.
    case markdown(MarkdownContent, inlineMath: [ReviewInlineMathReference])
    case formula(ReviewFormulaContent)
    case managedMedia(ReviewManagedMediaReference)
}

/// An accepted inline formula together with the `fcmath:` source that addresses it from the
/// Markdown fragment it lives in.
struct ReviewInlineMathReference {
    let source: String
    let formula: ReviewFormulaContent
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
        var preservesNextOpeningBlockPrefix = false
        var speakableSegments: [String] = []
        for block in mathBlocks {
            switch block {
            case .markdown(let source):
                let segment = makeReviewSpeakableTextWithoutMath(
                    text: source,
                    preservesOpeningBlockPrefix: preservesNextOpeningBlockPrefix
                )
                if segment.isEmpty == false {
                    speakableSegments.append(segment)
                }
                preservesNextOpeningBlockPrefix = false
            case .formula(let formula):
                if formula.latex.isEmpty == false {
                    speakableSegments.append(formula.latex)
                }
                preservesNextOpeningBlockPrefix = formula.continuesParagraph
            }
        }
        return speakableSegments.joined(separator: "\n")
    case .literalMarkdown:
        return makeReviewSpeakableTextWithoutMath(
            text: text,
            preservesOpeningBlockPrefix: false
        )
    case .none:
        if classifyReviewContentPresentation(text: text) != .markdown {
            let plainText = normalizeReviewPlainTextEscapedDollars(text: text)
            return normalizeReviewSpeakableLines(lines: plainText.components(separatedBy: .newlines))
        }
        return makeReviewSpeakableTextWithoutMath(
            text: text,
            preservesOpeningBlockPrefix: false
        )
    }
}

private func makeReviewSpeakableTextWithoutMath(
    text: String,
    preservesOpeningBlockPrefix: Bool
) -> String {
    if classifyReviewContentPresentation(text: text) != .markdown {
        return normalizeReviewSpeakableLines(lines: text.components(separatedBy: .newlines))
    }

    var activeFence: ReviewMathFence? = nil
    var speakableLines: [String] = []

    for (lineIndex, line) in text.components(separatedBy: .newlines).enumerated() {
        if let openingFence = activeFence {
            if reviewMathFenceCloses(line: line, openingFence: openingFence) {
                activeFence = nil
            }

            continue
        }

        if let openingFence = reviewMathFence(line: line) {
            activeFence = openingFence
            continue
        }

        let normalizedLine = preservesOpeningBlockPrefix && lineIndex == 0
            ? normalizeReviewSpeakableInlineText(text: line)
            : normalizeReviewSpeakableMarkdownLine(line: line)
        if normalizedLine.isEmpty == false {
            speakableLines.append(normalizedLine)
        }
    }

    return normalizeReviewSpeakableLines(lines: speakableLines)
}

/// Private scheme for accepted inline formulas routed through the Markdown inline image path.
/// It never reaches card storage, and managed media parsing ignores it because
/// `managedMediaAssetId(reference:)` requires the `fcasset:` prefix.
let reviewInlineMathImageScheme = "fcmath"

/// ASCII punctuation, which CommonMark lets a backslash escape back to the literal character.
/// Escaping all of it keeps a LaTeX alt text from breaking out of the `![alt](url)` syntax.
private let reviewMarkdownEscapableCharacters: Set<Character> = Set(##"!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~"##)

/// The reference is content-derived so that two cards whose only difference is the formula parse
/// to different inline nodes. Equal nodes would keep MarkdownUI's view identity, its cached
/// `inlineImages` state, and its `.task(id:)`, and the previous card's formula would keep showing.
private func reviewInlineMathImageSource(index: Int, latex: String) -> String {
    "\(reviewInlineMathImageScheme):\(index)-\(reviewInlineMathDigest(latex: latex))"
}

/// FNV-1a over UTF-8. Deterministic across process launches, unlike Swift's seeded `Hasher`.
private func reviewInlineMathDigest(latex: String) -> String {
    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in latex.utf8 {
        hash ^= UInt64(byte)
        hash = hash &* 0x0000_0100_0000_01b3
    }

    let hexDigest = String(hash, radix: 16)
    return String(repeating: "0", count: max(0, 16 - hexDigest.count)) + hexDigest
}

/// The alt text carries the LaTeX because a paragraph holding nothing but the formula reaches
/// MarkdownUI's `ImageView`, which overrides the image label with `.accessibilityLabel(alt)`.
private func makeReviewInlineMathImageReference(source: String, latex: String) -> String {
    "![\(reviewMarkdownEscapedAltText(text: latex))](\(source))"
}

private func reviewMarkdownEscapedAltText(text: String) -> String {
    var escapedText = ""
    escapedText.reserveCapacity(text.count * 2)

    for character in text {
        if reviewMarkdownEscapableCharacters.contains(character) {
            escapedText.append("\\")
        }
        escapedText.append(character)
    }

    return escapedText
}

private func makeReviewSegmentedMarkdownContent(
    mathBlocks: [ReviewMathBlock]
) -> ReviewManagedMarkdownContent {
    var blocks: [ReviewManagedMarkdownBlock] = []
    var inlineMath: [ReviewInlineMathReference] = []
    var pendingMarkdown = ""

    func flushPendingMarkdown() {
        let markdownText = pendingMarkdown
        pendingMarkdown = ""
        guard markdownText.isEmpty == false else {
            return
        }

        if let managedMarkdownContent = makeReviewManagedMarkdownContent(
            text: markdownText,
            inlineMath: inlineMath
        ) {
            blocks.append(contentsOf: managedMarkdownContent.blocks)
        } else {
            appendReviewMarkdownBlock(text: markdownText, inlineMath: inlineMath, blocks: &blocks)
        }
    }

    for mathBlock in mathBlocks {
        switch mathBlock {
        case .markdown(let text):
            pendingMarkdown += text
        case .formula(let formula) where formula.continuesParagraph:
            // An accepted inline formula stays inside its paragraph as an inline image reference.
            let source = reviewInlineMathImageSource(index: inlineMath.count, latex: formula.latex)
            pendingMarkdown += makeReviewInlineMathImageReference(source: source, latex: formula.latex)
            inlineMath.append(ReviewInlineMathReference(source: source, formula: formula))
        case .formula(let formula):
            flushPendingMarkdown()
            blocks.append(.formula(formula))
        }
    }
    flushPendingMarkdown()

    return ReviewManagedMarkdownContent(blocks: blocks)
}

/// Each Markdown block gets only the formulas its own fragment addresses, so a render failure is
/// reported once, under the block that actually holds the broken formula.
private func reviewInlineMathReferences(
    text: String,
    inlineMath: [ReviewInlineMathReference]
) -> [ReviewInlineMathReference] {
    guard inlineMath.isEmpty == false else {
        return []
    }

    return inlineMath.filter { reference in
        text.contains(reference.source)
    }
}

private func hasStrongMarkdownCue(text: String) -> Bool {
    let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
    return reviewContentMarkdownExpressions.contains { expression in
        expression.firstMatch(in: text, options: [], range: fullRange) != nil
    }
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

private func makeReviewManagedMarkdownContent(
    text: String,
    inlineMath: [ReviewInlineMathReference] = []
) -> ReviewManagedMarkdownContent? {
    var activeFence: ReviewMathFence? = nil
    var pendingMarkdownLines: [String] = []
    var blocks: [ReviewManagedMarkdownBlock] = []
    var didFindManagedMedia = false

    for line in text.components(separatedBy: .newlines) {
        if let openingFence = activeFence {
            pendingMarkdownLines.append(line)
            if reviewMathFenceCloses(line: line, openingFence: openingFence) {
                activeFence = nil
            }
            continue
        }

        if let openingFence = reviewMathFence(line: line) {
            activeFence = openingFence
            pendingMarkdownLines.append(line)
            continue
        }

        let lineBlocks = splitReviewManagedMediaLine(line: line, inlineMath: inlineMath)
        if lineBlocks.contains(where: { block in
            if case .managedMedia = block {
                return true
            }
            return false
        }) == false {
            pendingMarkdownLines.append(line)
            continue
        }

        appendReviewPendingMarkdownBlocks(
            lines: &pendingMarkdownLines,
            inlineMath: inlineMath,
            blocks: &blocks
        )
        blocks.append(contentsOf: lineBlocks)
        didFindManagedMedia = true
    }

    appendReviewPendingMarkdownBlocks(
        lines: &pendingMarkdownLines,
        inlineMath: inlineMath,
        blocks: &blocks
    )
    guard didFindManagedMedia else {
        return nil
    }

    return ReviewManagedMarkdownContent(blocks: blocks)
}

private func splitReviewManagedMediaLine(
    line: String,
    inlineMath: [ReviewInlineMathReference]
) -> [ReviewManagedMarkdownBlock] {
    let fullRange = NSRange(line.startIndex..<line.endIndex, in: line)
    let matches = reviewManagedMediaReferenceExpression.matches(in: line, options: [], range: fullRange)
    guard matches.isEmpty == false else {
        return makeReviewMarkdownOnlyBlocks(text: line, inlineMath: inlineMath)
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
        appendReviewMarkdownBlock(text: precedingText, inlineMath: inlineMath, blocks: &blocks)

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
        return makeReviewMarkdownOnlyBlocks(text: line, inlineMath: inlineMath)
    }

    appendReviewMarkdownBlock(
        text: String(line[currentIndex..<line.endIndex]),
        inlineMath: inlineMath,
        blocks: &blocks
    )
    return blocks
}

private func makeReviewMarkdownOnlyBlocks(
    text: String,
    inlineMath: [ReviewInlineMathReference]
) -> [ReviewManagedMarkdownBlock] {
    [
        .markdown(
            makeReviewMarkdownContent(text: text),
            inlineMath: reviewInlineMathReferences(text: text, inlineMath: inlineMath)
        )
    ]
}

private func appendReviewPendingMarkdownBlocks(
    lines: inout [String],
    inlineMath: [ReviewInlineMathReference],
    blocks: inout [ReviewManagedMarkdownBlock]
) {
    let markdownText = lines.joined(separator: "\n")
    lines.removeAll()
    appendReviewMarkdownBlock(text: markdownText, inlineMath: inlineMath, blocks: &blocks)
}

private func appendReviewMarkdownBlock(
    text: String,
    inlineMath: [ReviewInlineMathReference],
    blocks: inout [ReviewManagedMarkdownBlock]
) {
    guard text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
        return
    }

    blocks.append(
        .markdown(
            makeReviewMarkdownContent(text: text),
            inlineMath: reviewInlineMathReferences(text: text, inlineMath: inlineMath)
        )
    )
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
