import SwiftUI

extension AIChatView {
    func startComposerDictation() {
        guard self.ensureExternalAIConsent() else {
            return
        }

        self.chatStore.startDictation(restoresComposerFocus: self.isComposerFocused)
        guard self.chatStore.dictationState != .idle else {
            return
        }
        // The draft locks while dictating; closing the keyboard also ends any system dictation running beside it.
        self.dismissComposerFocus()
    }

    func handleCompletedDictationTranscript(_ completedTranscript: AIChatCompletedDictationTranscript) {
        // A dismissed/cached presentation can still receive a queued callback. Only the
        // current presentation may claim the transcript, and each ID is claimed once.
        guard self.isPresentationActive,
              self.chatStore.consumeCompletedDictationTranscript(id: completedTranscript.id) else {
            return
        }
        self.chatStore.editorDiagnosticPresentation = self.composerDiagnosticPresentation
        self.composerSelection = aiChatTextSelection(
            text: self.chatStore.inputText,
            selection: completedTranscript.selection
        )
        self.isComposerFocused = true
    }
}
