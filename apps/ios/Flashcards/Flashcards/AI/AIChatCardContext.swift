import Foundation

func aiChatCardAttachmentLabel(card: AIChatCardReference) -> String {
    let snippet = aiChatTruncatedSnippet(card.frontText)
    return snippet.isEmpty ? "Card" : "Card · \(snippet)"
}

func buildAIChatCardContextXML(card: AIChatCardReference) -> String {
    let tagsXML = card.tags.map { tag in
        "<tag>\(escapeAIChatCardXMLValue(tag))</tag>"
    }.joined()

    // Keep this byte-for-byte aligned with apps/backend/src/chat/cardContext.ts::buildCardContextXml.
    return [
        "<attached_card>",
        "<card_id>\(escapeAIChatCardXMLValue(card.cardId))</card_id>",
        "<effort_level>\(escapeAIChatCardXMLValue(card.effortLevel.rawValue))</effort_level>",
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
