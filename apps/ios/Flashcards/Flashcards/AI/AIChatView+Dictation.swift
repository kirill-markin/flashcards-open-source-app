import SwiftUI

extension AIChatView {
    func handleDictationButtonTap() {
        if self.chatStore.dictationState == .idle {
            guard self.ensureExternalAIConsent() else {
                return
            }
            self.shouldRestoreComposerFocusAfterDictation = self.isComposerFocused
            self.composerDictationInsertionSelection = aiChatDictationInsertionSelection(
                text: self.chatStore.inputText,
                selection: self.composerSelection
            )
            if self.isComposerFocused == false {
                self.composerSelection = nil
                self.composerDictationInsertionSelection = nil
            }
        }

        self.chatStore.toggleDictation()
        self.restoreComposerFocusIfNeeded()
    }

    func handleDictationStateChange(_ nextState: AIChatDictationState) {
        guard self.shouldRestoreComposerFocusAfterDictation else {
            return
        }

        self.restoreComposerFocusIfNeeded()

        if nextState == .idle {
            self.shouldRestoreComposerFocusAfterDictation = false
        }
    }

    func restoreComposerFocusIfNeeded() {
        guard self.shouldRestoreComposerFocusAfterDictation else {
            return
        }

        Task { @MainActor in
            self.isComposerFocused = true
        }
    }

    func handleCompletedDictationTranscript(_ completedTranscript: AIChatCompletedDictationTranscript) {
        let insertionResult = insertAIChatDictationTranscript(
            draft: self.chatStore.inputText,
            transcript: completedTranscript.transcript,
            selection: self.composerDictationInsertionSelection
        )
        self.chatStore.inputText = insertionResult.text
        self.composerSelection = aiChatTextSelection(
            text: insertionResult.text,
            selection: insertionResult.selection
        )
        self.composerDictationInsertionSelection = insertionResult.selection
        self.chatStore.consumeCompletedDictationTranscript(id: completedTranscript.id)
        self.restoreComposerFocusIfNeeded()
    }
}
