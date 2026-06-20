import Foundation

extension AIChatStore {
    var canSendMessage: Bool {
        self.isChatInteractive
            && self.composerPhase == .idle
            && self.dictationState == .idle
            && self.hasExternalProviderConsent
            && (self.trimmedInputText().isEmpty == false || self.pendingAttachments.isEmpty == false)
    }

    var canEditDraft: Bool {
        self.canEditDraftText
            && self.dictationState == .idle
    }

    /// Text editing intentionally stays available during dictation so the keyboard and cursor remain active.
    var canEditDraftText: Bool {
        guard self.isChatInteractive else {
            return false
        }
        if aiChatDictationStateKeepsDraftTextEditable(self.dictationState) {
            return true
        }
        return aiChatComposerPhaseAllowsDraftPreparation(self.composerPhase)
    }

    var canModifyDraftAttachments: Bool {
        self.canEditDraft
    }

    var canAttachToDraft: Bool {
        self.canModifyDraftAttachments
            && self.serverChatConfig.features.attachmentsEnabled
    }

    var canAttachCardToDraft: Bool {
        self.canModifyDraftAttachments
    }

    var canStartDictation: Bool {
        self.isChatInteractive
            && self.serverChatConfig.features.dictationEnabled
            && self.dictationState == .idle
            && aiChatComposerPhaseAllowsDraftPreparation(self.composerPhase)
    }

    var canUseDictation: Bool {
        switch self.dictationState {
        case .idle:
            return self.canStartDictation
        case .recording:
            return self.isChatInteractive
        case .requestingPermission, .transcribing:
            return false
        }
    }

    var canStopResponse: Bool {
        self.isChatInteractive
            && (self.composerPhase == .startingRun || self.composerPhase == .running)
    }

    var canStartNewChat: Bool {
        guard self.isChatInteractive else {
            return false
        }
        guard self.dictationState == .idle else {
            return false
        }
        return self.messages.isEmpty == false
            || self.pendingAttachments.isEmpty == false
            || self.trimmedInputText().isEmpty == false
            || self.isStreaming
    }

    var hasLocalTranscriptDuringBootstrap: Bool {
        self.bootstrapPhase == .loading && self.messages.isEmpty == false
    }

    var shouldShowComposerAccessory: Bool {
        self.isChatInteractive || self.bootstrapPhase == .loading
    }

    var isComposerBusy: Bool {
        self.bootstrapPhase == .loading || self.composerPhase != .idle
    }

    var visibleComposerSuggestions: [AIChatComposerSuggestion] {
        guard self.areComposerSuggestionsEnabled else {
            return []
        }
        guard self.isChatInteractive else {
            return []
        }
        guard self.composerPhase == .idle else {
            return []
        }
        guard self.dictationState == .idle else {
            return []
        }
        guard self.pendingAttachments.isEmpty else {
            return []
        }
        guard self.trimmedInputText().isEmpty else {
            return []
        }
        return self.composerSuggestions
    }

    var isStreaming: Bool {
        self.composerPhase == .startingRun || self.composerPhase == .running || self.composerPhase == .stopping
    }

    var usesGuestAIRestrictions: Bool {
        self.flashcardsStore.cloudSettings?.cloudState != .linked
    }

    var isChatInteractive: Bool {
        self.bootstrapPhase == .ready
    }

    var bootstrapFailurePresentation: AIChatBootstrapErrorPresentation? {
        guard case .failed(let presentation) = self.bootstrapPhase else {
            return nil
        }

        return presentation
    }

    func appendAttachment(_ attachment: AIChatAttachment) {
        guard self.canAttachToDraft else {
            return
        }
        guard self.hasExternalProviderConsent else {
            self.showGeneralError(message: aiChatExternalProviderConsentRequiredMessage)
            return
        }

        self.pendingAttachments.append(attachment)
    }

    func applyComposerSuggestions(_ suggestions: [AIChatComposerSuggestion]) {
        self.composerSuggestions = suggestions
    }

    func applyComposerSuggestion(_ suggestion: AIChatComposerSuggestion) {
        guard self.areComposerSuggestionsEnabled else {
            return
        }
        guard self.canEditDraft else {
            return
        }

        let trimmedInputText = self.inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedInputText.isEmpty {
            self.inputText = suggestion.text
            return
        }

        let separator = self.inputText.hasSuffix(" ") ? "" : " "
        self.inputText += separator + suggestion.text
    }

    func removeAttachment(id: String) {
        guard self.canModifyDraftAttachments else {
            return
        }
        self.pendingAttachments.removeAll { attachment in
            attachment.id == id
        }
    }

    func consumeCompletedDictationTranscript(id: String) {
        guard self.completedDictationTranscript?.id == id else {
            return
        }

        self.completedDictationTranscript = nil
    }

    func applyPresentationRequest(request: AIChatPresentationRequest) -> Bool {
        switch request {
        case .createCard:
            guard self.canEditDraft else {
                return false
            }
            self.inputText = aiChatCreateCardDraftPrompt
            return true
        case .attachCard(let card):
            return self.prepareCardHandoff(card: card)
        }
    }

    func trimmedInputText() -> String {
        self.inputText.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

func aiChatComposerPhaseAllowsDraftPreparation(_ phase: AIChatComposerPhase) -> Bool {
    switch phase {
    case .idle, .running:
        return true
    case .preparingSend, .startingRun, .stopping:
        return false
    }
}

func aiChatDictationStateKeepsDraftTextEditable(_ state: AIChatDictationState) -> Bool {
    switch state {
    case .idle:
        return false
    case .requestingPermission, .recording, .transcribing:
        return true
    }
}
