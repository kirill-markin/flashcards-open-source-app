import Foundation

extension AIChatStore {
    var canSendMessage: Bool {
        self.isChatInteractive
            && self.composerPhase == .idle
            && self.dictationState == .idle
            && self.hasExternalProviderConsent
            && (self.trimmedInputText().isEmpty == false || self.pendingAttachments.isEmpty == false)
    }

    var canStopResponse: Bool {
        self.isChatInteractive
            && (self.composerPhase == .startingRun || self.composerPhase == .running)
    }

    var isComposerBusy: Bool {
        self.bootstrapPhase == .loading || self.composerPhase != .idle
    }

    var visibleComposerSuggestions: [AIChatComposerSuggestion] {
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

    var bootstrapFailureMessage: String? {
        guard case .failed(let message) = self.bootstrapPhase else {
            return nil
        }

        return message
    }

    func appendAttachment(_ attachment: AIChatAttachment) {
        guard self.isChatInteractive else {
            return
        }
        guard self.serverChatConfig.features.attachmentsEnabled else {
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
        let trimmedInputText = self.inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedInputText.isEmpty {
            self.inputText = suggestion.text
            return
        }

        let separator = self.inputText.hasSuffix(" ") ? "" : " "
        self.inputText += separator + suggestion.text
    }

    func removeAttachment(id: String) {
        guard self.isChatInteractive else {
            return
        }
        self.pendingAttachments.removeAll { attachment in
            attachment.id == id
        }
    }

    func showAlert(_ alert: AIChatAlert) {
        self.activeAlert = alert
    }

    func showGeneralError(message: String) {
        self.activeResumeErrorAttemptSequence = nil
        self.activeAlert = .generalError(
            title: aiSettingsLocalized("ai.error.title", "Error"),
            message: message
        )
    }

    func showGeneralError(error: Error) {
        self.activeResumeErrorAttemptSequence = nil
        self.activeAlert = aiChatGeneralErrorAlert(
            error: error,
            resumeAttemptSequence: self.activeLiveResumeAttemptSequence
        )
    }

    func showResumeGeneralError(message: String, resumeAttemptSequence: Int) {
        self.activeResumeErrorAttemptSequence = resumeAttemptSequence
        self.activeAlert = .generalError(
            title: aiSettingsLocalized("ai.error.title", "Error"),
            message: message
        )
    }

    func showMicrophoneSettingsAlert() {
        self.activeAlert = .microphoneSettings
    }

    func showAttachmentSettingsAlert(source: AIChatAttachmentSettingsSource) {
        self.activeAlert = .attachmentSettings(source: source)
    }

    func dismissAlert() {
        self.activeAlert = nil
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

func logAIChatStoreEvent(action: String, metadata: [String: String]) {
    logFlashcardsError(domain: "ios_ai_store", action: action, metadata: metadata)
}

private struct AIChatAlertPresentation {
    let title: String
    let message: String
}

func aiChatGeneralErrorAlert(
    error: Error,
    resumeAttemptSequence: Int?
) -> AIChatAlert {
    let presentation = aiChatAlertPresentation(
        error: error,
        resumeAttemptSequence: resumeAttemptSequence
    )
    return .generalError(title: presentation.title, message: presentation.message)
}

private func aiChatAlertPresentation(
    error: Error,
    resumeAttemptSequence: Int?
) -> AIChatAlertPresentation {
    if let liveError = error as? AIChatLiveStreamError {
        return aiChatAlertPresentation(
            liveError: liveError,
            resumeAttemptSequence: resumeAttemptSequence
        )
    }

    if let diagnosticError = error as? AIChatFailureDiagnosticProviding {
        return aiChatAlertPresentation(
            diagnostics: diagnosticError.diagnostics,
            summary: aiChatFailureSummary(error: error),
            rawDetails: nil,
            code: nil,
            statusCode: nil,
            requestId: nil,
            resumeAttemptSequence: resumeAttemptSequence
        )
    }

    return AIChatAlertPresentation(
        title: aiSettingsLocalized("ai.error.title", "Error"),
        message: Flashcards.errorMessage(error: error)
    )
}

private func aiChatAlertPresentation(
    liveError: AIChatLiveStreamError,
    resumeAttemptSequence: Int?
) -> AIChatAlertPresentation {
    switch liveError {
    case .invalidStatusCode(let httpStatusCode, let errorDetails, _):
        let summary = aiSettingsLocalized(
            "ai.error.summary.couldNotContinue",
            "Couldn't Continue the AI Response"
        )
        let rawDetails = errorDetails.message
        return aiChatAlertPresentation(
            diagnostics: nil,
            summary: summary,
            rawDetails: rawDetails,
            code: errorDetails.code,
            statusCode: httpStatusCode,
            requestId: errorDetails.requestId,
            resumeAttemptSequence: resumeAttemptSequence
        )
    case .invalidResponse:
        return aiChatAlertPresentation(
            diagnostics: nil,
            summary: aiSettingsLocalized(
                "ai.error.summary.couldNotContinue",
                "Couldn't Continue the AI Response"
            ),
            rawDetails: aiSettingsLocalized(
                "ai.error.live.invalidHttpResponse",
                "The AI live stream did not receive an HTTP response."
            ),
            code: nil,
            statusCode: nil,
            requestId: nil,
            resumeAttemptSequence: resumeAttemptSequence
        )
    case .staleStream:
        return aiChatAlertPresentation(
            diagnostics: nil,
            summary: aiSettingsLocalized(
                "ai.error.summary.couldNotContinue",
                "Couldn't Continue the AI Response"
            ),
            rawDetails: aiSettingsLocalized(
                "ai.error.live.staleStream",
                "The AI response stopped updating before the run finished."
            ),
            code: nil,
            statusCode: nil,
            requestId: nil,
            resumeAttemptSequence: resumeAttemptSequence
        )
    case .invalidUrl:
        return aiChatAlertPresentation(
            diagnostics: nil,
            summary: aiSettingsLocalized(
                "ai.error.summary.configuration",
                "AI Configuration Error"
            ),
            rawDetails: aiSettingsLocalized(
                "ai.error.live.invalidUrl",
                "The AI live stream URL is invalid."
            ),
            code: nil,
            statusCode: nil,
            requestId: nil,
            resumeAttemptSequence: resumeAttemptSequence
        )
    }
}

private func aiChatAlertPresentation(
    diagnostics: AIChatFailureDiagnostics?,
    summary: String,
    rawDetails: String?,
    code: String?,
    statusCode: Int?,
    requestId: String?,
    resumeAttemptSequence: Int?
) -> AIChatAlertPresentation {
    var detailLines: [String] = []

    if let rawDetails, rawDetails.isEmpty == false {
        detailLines.append(rawDetails)
    }

    let effectiveRequestId = requestId ?? diagnostics?.backendRequestId
    if let effectiveRequestId, effectiveRequestId.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.reference",
                "Reference: %@",
                effectiveRequestId
            )
        )
    } else if let clientRequestId = diagnostics?.clientRequestId, clientRequestId.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.debug",
                "Debug: %@",
                clientRequestId
            )
        )
    }

    let effectiveStatusCode = statusCode ?? diagnostics?.statusCode
    if let effectiveStatusCode {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.status",
                "Status: %d",
                effectiveStatusCode
            )
        )
    }

    let effectiveCode = code
    if let effectiveCode, effectiveCode.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.code",
                "Code: %@",
                effectiveCode
            )
        )
    }

    if let stage = diagnostics?.stage {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.stage",
                "Stage: %@",
                stage.rawValue
            )
        )
    }

    if let resumeAttemptSequence {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.resumeAttempt",
                "Resume Attempt: %d",
                resumeAttemptSequence
            )
        )
    }

    if let decoderSummary = diagnostics?.decoderSummary, decoderSummary.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.details",
                "Details: %@",
                decoderSummary
            )
        )
    }

    if let rawSnippet = diagnostics?.rawSnippet, rawSnippet.isEmpty == false {
        detailLines.append(
            aiSettingsLocalizedFormat(
                "ai.error.detail.payload",
                "Payload: %@",
                rawSnippet
            )
        )
    }

    return AIChatAlertPresentation(
        title: summary,
        message: detailLines.joined(separator: "\n")
    )
}

private func aiChatFailureSummary(error: Error) -> String {
    if error is AIChatLiveStreamSetupError {
        return aiSettingsLocalized(
            "ai.error.summary.couldNotContinue",
            "Couldn't Continue the AI Response"
        )
    }

    if error is AIChatLiveStreamContractError {
        return aiSettingsLocalized(
            "ai.error.summary.invalidResponse",
            "Received an Invalid AI Response"
        )
    }

    if let serviceError = error as? AIChatServiceError {
        switch serviceError {
        case .invalidBaseUrl:
            return aiSettingsLocalized(
                "ai.error.summary.configuration",
                "AI Configuration Error"
            )
        case .invalidHttpResponse, .invalidResponse:
            return aiSettingsLocalized(
                "ai.error.summary.couldNotContinue",
                "Couldn't Continue the AI Response"
            )
        case .invalidPayload:
            return aiSettingsLocalized(
                "ai.error.summary.invalidResponse",
                "Received an Invalid AI Response"
            )
        }
    }

    return aiSettingsLocalized("ai.error.title", "Error")
}
