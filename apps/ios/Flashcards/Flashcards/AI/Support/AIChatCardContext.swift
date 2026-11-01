import Foundation

func aiChatCardAttachmentLabel(card: AIChatCardReference) -> String {
    let snippet = aiChatCardAttachmentSnippet(card.frontText)
    if snippet.isEmpty {
        return aiSettingsLocalized("ai.attachment.card.title", "Card")
    }

    return aiSettingsLocalizedFormat("ai.attachment.card.withSnippet", "Card · %@", snippet)
}

func aiChatCardAttachmentMathBlocks(card: AIChatCardReference) -> [ReviewMathBlock]? {
    let snippet = aiChatCardAttachmentSnippet(card.frontText)
    guard containsReviewMathDelimiter(text: snippet),
          case .segmented(let blocks) = extractReviewMathBlocks(text: snippet) else { return nil }
    let label = aiChatCardAttachmentLabel(card: card)
    guard let range = label.range(of: snippet) else { return nil }
    // Parse before adding the localized label, and keep display formulas inline in compact chips.
    return [.markdown(String(label[..<range.lowerBound]))] + blocks.map { block in
        guard case .formula(let formula) = block else { return block }
        return .formula(ReviewFormulaContent(originalSource: formula.originalSource, latex: formula.latex, continuesParagraph: true))
    } + [.markdown(String(label[range.upperBound...]))]
}

private func aiChatCardAttachmentSnippet(_ text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count > 240 else { return trimmed }
    return reviewMathTextPrefix(text: trimmed, characterLimit: 240) + "..."
}

func buildAIChatCardContextXML(card: AIChatCardReference) -> String {
    let tagsXML = card.tags.map { tag in
        "<tag>\(escapeAIChatCardXMLValue(tag))</tag>"
    }.joined()

    // Keep this byte-for-byte aligned with apps/backend/src/chat/cardContext.ts::buildCardContextXml.
    return [
        "<attached_card>",
        "<card_id>\(escapeAIChatCardXMLValue(card.cardId))</card_id>",
        "<front_text>",
        escapeAIChatCardXMLValue(card.frontText),
        "</front_text>",
        "<back_text>",
        escapeAIChatCardXMLValue(card.backText),
        "</back_text>",
        "<tags>\(tagsXML)</tags>",
        "</attached_card>",
    ].joined(separator: "\n")
}

private func escapeAIChatCardXMLValue(_ value: String) -> String {
    value
        .replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
        .replacingOccurrences(of: "\"", with: "&quot;")
        .replacingOccurrences(of: "'", with: "&apos;")
}
