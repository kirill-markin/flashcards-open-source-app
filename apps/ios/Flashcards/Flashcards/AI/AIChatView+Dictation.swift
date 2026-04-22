import SwiftUI

extension AIChatView {
    func handleDictationButtonTap() {
        if self.chatStore.dictationState == .idle, self.ensureExternalAIConsent() == false {
            return
        }

        self.chatStore.toggleDictation()
    }

    func handleCompletedDictationTranscript(_ completedTranscript: AIChatCompletedDictationTranscript) {
        let insertionSelection = aiChatDictationInsertionSelection(
            text: self.chatStore.inputText,
            selection: self.composerSelection
        )
        let insertionResult = insertAIChatDictationTranscript(
            draft: self.chatStore.inputText,
            transcript: completedTranscript.transcript,
            selection: insertionSelection
        )
        self.chatStore.inputText = insertionResult.text
        self.composerSelection = aiChatTextSelection(
            text: insertionResult.text,
            selection: insertionResult.selection
        )
        self.chatStore.consumeCompletedDictationTranscript(id: completedTranscript.id)
    }
}
