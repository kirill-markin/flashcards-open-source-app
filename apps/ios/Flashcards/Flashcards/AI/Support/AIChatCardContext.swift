import Foundation

private let aiChatCardAttachmentSnippetCharacterLimit: Int = 240

func aiChatCardAttachmentLabel(card: AIChatCardReference) -> String {
    let snippet = aiChatCardAttachmentSnippet(card.frontText)
    if snippet.text.isEmpty {
        return aiSettingsLocalized("ai.attachment.card.title", "Card")
    }

    return aiSettingsLocalizedFormat("ai.attachment.card.withSnippet", "Card · %@", snippet.text)
}

func aiChatCardAttachmentMathBlocks(card: AIChatCardReference) -> [ReviewMathBlock] {
    let snippet = aiChatCardAttachmentSnippet(card.frontText)
    let label = aiChatCardAttachmentLabel(card: card)
    guard snippet.text.isEmpty == false, let range = label.range(of: snippet.text) else {
        return [.markdown(label)]
    }
    // The snippet is parsed before the localized label wraps it.
    return [.markdown(String(label[..<range.lowerBound]))] + snippet.mathBlocks + [.markdown(String(label[range.upperBound...]))]
}

private func aiChatCardAttachmentSnippet(_ text: String) -> ReviewPreviewText {
    let preview = makeReviewPreviewText(text: text)
    guard preview.text.count > aiChatCardAttachmentSnippetCharacterLimit else { return preview }

    // Truncation may omit a formula, but must never turn accepted TeX into a partial source.
    var remainingCharacterCount = aiChatCardAttachmentSnippetCharacterLimit
    var mathBlocks: [ReviewMathBlock] = []
    for block in preview.mathBlocks {
        let sourceCount = block.source.count
        if sourceCount <= remainingCharacterCount {
            mathBlocks.append(block)
            remainingCharacterCount -= sourceCount
            continue
        }
        if case .markdown(let value) = block {
            mathBlocks.append(.markdown(String(value.prefix(remainingCharacterCount))))
        }
        break
    }
    mathBlocks.append(.markdown("..."))
    return ReviewPreviewText(text: mathBlocks.map(\.source).joined(), mathBlocks: mathBlocks)
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
