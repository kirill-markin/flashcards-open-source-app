import SwiftUI

func aiChatDictationInsertionSelection(
    text: String,
    selection: TextSelection?
) -> AIChatDictationInsertionSelection? {
    guard let selection else {
        return nil
    }

    switch selection.indices {
    case .selection(let range):
        guard
            let startUtf16Offset = aiChatUtf16Offset(text: text, index: range.lowerBound),
            let endUtf16Offset = aiChatUtf16Offset(text: text, index: range.upperBound)
        else {
            return nil
        }

        return AIChatDictationInsertionSelection(
            startUtf16Offset: startUtf16Offset,
            endUtf16Offset: endUtf16Offset
        )
    case .multiSelection:
        return nil
    @unknown default:
        return nil
    }
}

private func aiChatUtf16Offset(text: String, index: String.Index) -> Int? {
    guard let utf16Index = index.samePosition(in: text.utf16) else {
        return nil
    }

    return text.utf16.distance(from: text.utf16.startIndex, to: utf16Index)
}

func aiChatTextSelection(
    text: String,
    selection: AIChatDictationInsertionSelection
) -> TextSelection {
    let insertionIndex = String.Index(utf16Offset: selection.endUtf16Offset, in: text)
    return TextSelection(insertionPoint: insertionIndex)
}
