import Foundation

struct AIChatRenderFootprint: Hashable, Sendable {
    let messageCount: Int
    let contentPartCount: Int
    let renderedTextCharacterCount: Int
    let renderedTextUTF8ByteCount: Int
    let largestRenderedTextPartCharacterCount: Int
    let largestRenderedTextPartUTF8ByteCount: Int
    let hasOlderMessages: Bool
}

func makeAIChatRenderFootprint(
    messages: [AIChatMessage],
    hasOlderMessages: Bool
) -> AIChatRenderFootprint {
    var contentPartCount = 0
    var renderedTextCharacterCount = 0
    var renderedTextUTF8ByteCount = 0
    var largestRenderedTextPartCharacterCount = 0
    var largestRenderedTextPartUTF8ByteCount = 0

    for message in messages {
        for contentPart in message.content {
            contentPartCount += 1
            let textSize = aiChatRenderedTextSize(contentPart: contentPart)
            renderedTextCharacterCount += textSize.characterCount
            renderedTextUTF8ByteCount += textSize.utf8ByteCount
            largestRenderedTextPartCharacterCount = max(
                largestRenderedTextPartCharacterCount,
                textSize.characterCount
            )
            largestRenderedTextPartUTF8ByteCount = max(
                largestRenderedTextPartUTF8ByteCount,
                textSize.utf8ByteCount
            )
        }
    }

    return AIChatRenderFootprint(
        messageCount: messages.count,
        contentPartCount: contentPartCount,
        renderedTextCharacterCount: renderedTextCharacterCount,
        renderedTextUTF8ByteCount: renderedTextUTF8ByteCount,
        largestRenderedTextPartCharacterCount: largestRenderedTextPartCharacterCount,
        largestRenderedTextPartUTF8ByteCount: largestRenderedTextPartUTF8ByteCount,
        hasOlderMessages: hasOlderMessages
    )
}

private struct AIChatRenderedTextSize {
    let characterCount: Int
    let utf8ByteCount: Int
}

private func aiChatRenderedTextSize(contentPart: AIChatContentPart) -> AIChatRenderedTextSize {
    switch contentPart {
    case .text(let text):
        return aiChatRenderedTextSize(value: text)
    case .image:
        return AIChatRenderedTextSize(characterCount: 0, utf8ByteCount: 0)
    case .file(let fileName, _, _):
        return aiChatRenderedTextSize(value: fileName)
    case .card(let card):
        let cardTextSize = aiChatCombinedRenderedTextSize(
            first: aiChatRenderedTextSize(value: card.cardId),
            second: aiChatRenderedTextSize(value: card.frontText)
        )
        let cardBodyTextSize = aiChatCombinedRenderedTextSize(
            first: cardTextSize,
            second: aiChatRenderedTextSize(value: card.backText)
        )
        return card.tags.reduce(cardBodyTextSize) { textSize, tag in
            aiChatCombinedRenderedTextSize(
                first: textSize,
                second: aiChatRenderedTextSize(value: tag)
            )
        }
    case .toolCall(let toolCall):
        let summaryTextSize = aiChatCombinedRenderedTextSize(
            first: aiChatRenderedTextSize(value: toolCall.name),
            second: aiChatRenderedTextSize(value: toolCall.input)
        )
        return aiChatCombinedRenderedTextSize(
            first: summaryTextSize,
            second: aiChatRenderedTextSize(value: toolCall.output)
        )
    case .reasoningSummary(let reasoningSummary):
        return aiChatRenderedTextSize(value: reasoningSummary.summary)
    case .accountUpgradePrompt(let message, let buttonTitle):
        return aiChatCombinedRenderedTextSize(
            first: aiChatRenderedTextSize(value: message),
            second: aiChatRenderedTextSize(value: buttonTitle)
        )
    case .unknown(let unknownContent):
        return aiChatRenderedTextSize(value: unknownContent.originalType)
    }
}

private func aiChatRenderedTextSize(value: String?) -> AIChatRenderedTextSize {
    guard let value else {
        return AIChatRenderedTextSize(characterCount: 0, utf8ByteCount: 0)
    }

    return AIChatRenderedTextSize(
        characterCount: value.count,
        utf8ByteCount: value.utf8.count
    )
}

private func aiChatCombinedRenderedTextSize(
    first: AIChatRenderedTextSize,
    second: AIChatRenderedTextSize
) -> AIChatRenderedTextSize {
    AIChatRenderedTextSize(
        characterCount: first.characterCount + second.characterCount,
        utf8ByteCount: first.utf8ByteCount + second.utf8ByteCount
    )
}
