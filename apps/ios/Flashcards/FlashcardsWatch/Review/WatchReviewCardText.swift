import Foundation

/// A card side as the watch shows it: plain text, plus whether an image or formula was left out.
struct WatchReviewCardSideText: Hashable {
    let text: String
    let hasOmittedContent: Bool
}

private struct WatchPlainText {
    let text: String
    let hasOmittedImage: Bool
}

private let watchHeadingPrefixExpression = makeReviewContentRegularExpression(pattern: #"^\s{0,3}#{1,6}\s+"#)
private let watchBlockquotePrefixExpression = makeReviewContentRegularExpression(pattern: #"^\s{0,3}>\s?"#)

/// The watch renders no images or LaTeX; it leaves them out and tells the person to open the card on
/// iPhone. Formulas are the ones the iPhone renders, so code, escaped `\$` and prices stay text.
func makeWatchReviewCardSideText(markdown: String) -> WatchReviewCardSideText {
    var formulaFreeMarkdown = markdown
    var hasFormula = false
    if containsReviewMathDelimiter(text: markdown), case .segmented(let blocks) = extractReviewMathBlocks(text: markdown) {
        formulaFreeMarkdown = blocks.map { block in
            switch block {
            case .markdown(let source): source
            case .formula: ""
            }
        }.joined()
        hasFormula = true
    }

    let plainText = makeWatchPlainText(markdown: formulaFreeMarkdown)
    return WatchReviewCardSideText(
        text: plainText.text.trimmingCharacters(in: .whitespacesAndNewlines),
        hasOmittedContent: hasFormula || plainText.hasOmittedImage
    )
}

/// Code fences keep their lines verbatim; other lines lose heading and quote markers and inline formatting.
private func makeWatchPlainText(markdown: String) -> WatchPlainText {
    var openFence: ReviewMathFence?
    var hasOmittedImage = false
    var lines: [String] = []
    for rawLine in markdown.components(separatedBy: "\n") {
        let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : rawLine
        if let fence = openFence {
            if reviewMathFenceCloses(line: line, openingFence: fence) {
                openFence = nil
            } else {
                lines.append(line)
            }
            continue
        }
        if let fence = reviewMathFence(line: line) {
            openFence = fence
            continue
        }

        let blockText = watchBlockquotePrefixExpression.replacingMatches(
            in: watchHeadingPrefixExpression.replacingMatches(in: line, with: ""),
            with: ""
        )
        let inlineText = makeWatchInlinePlainText(markdown: blockText)
        hasOmittedImage = hasOmittedImage || inlineText.hasOmittedImage
        lines.append(inlineText.text)
    }
    return WatchPlainText(text: lines.joined(separator: "\n"), hasOmittedImage: hasOmittedImage)
}

/// Images and `fcasset:` media links are left out; inline code stays as typed.
/// Text that is not valid inline Markdown is shown as typed, with `\$` shown as `$` as on iPhone.
private func makeWatchInlinePlainText(markdown: String) -> WatchPlainText {
    guard let attributedText = try? AttributedString(
        markdown: markdown,
        options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    ) else {
        return WatchPlainText(text: normalizeReviewPlainTextEscapedDollars(text: markdown), hasOmittedImage: false)
    }

    var text = ""
    var hasOmittedImage = false
    for run in attributedText.runs {
        let isManagedMediaLink = run.link.flatMap { link in managedMediaAssetId(reference: link.absoluteString) } != nil
        if run.imageURL != nil || isManagedMediaLink {
            hasOmittedImage = true
            continue
        }
        text += String(attributedText[run.range].characters)
    }
    return WatchPlainText(text: text, hasOmittedImage: hasOmittedImage)
}
