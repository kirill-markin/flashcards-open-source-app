import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func createManualCard(frontText: String, backText: String) throws {
        try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.cardsAddButton, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.cardEditorScreen,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.typeTextSafely(
            frontText,
            intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorBackRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.typeTextSafely(
            backText,
            intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorBackTextEditor,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertTextExists(frontText, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
    }

    @MainActor
    func openFirstCardForEditing() throws {
        try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.cardsCardRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.cardEditorEditWithAIButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
    }

    @MainActor
    func handoffEditedCardToAIAndAssertDraftAttachment() throws {
        try self.tapButton(
            identifier: LiveSmokeIdentifier.cardEditorEditWithAIButton,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertAiEntrySurfaceVisible()

        let consentButton = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(
            consentButton,
            identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
            timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
        ) {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.waitForAiComposerAfterConsent()
        }

        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerTextField,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )

        let cardAttachmentChipCount = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip)
            .count
        if cardAttachmentChipCount != 1 {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected exactly one AI card attachment chip, found \(cardAttachmentChipCount).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        let messageRows = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiMessageRow)
            .count
        if messageRows != 0 {
            throw LiveSmokeFailure.unexpectedAiConversationState(
                message: "Expected no sent AI user messages after card handoff, found \(messageRows).",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func reviewCurrentCard(expectedFrontText: String) throws {
        try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists(
            expectedFrontText,
            timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
        )
        if self.app.buttons[LiveSmokeIdentifier.reviewAiButton].exists {
            throw LiveSmokeFailure.unexpectedReviewState(
                message: "Review AI button should not be visible before the answer is revealed.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        try self.tapButton(
            identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
            timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
        )
        try self.waitForReviewAnswerReveal()
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.reviewAiButton,
            timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
        )
        try self.tapButton(
            identifier: LiveSmokeIdentifier.reviewRateGoodButton,
            timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
        )
    }

    @MainActor
    func waitForReviewAnswerReveal() throws {
        let showAnswerButton = self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton]
        let rateGoodButton = self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton]
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)

        while Date() < deadline {
            _ = self.dismissKnownBlockingAlertIfVisible()

            if showAnswerButton.exists == false && rateGoodButton.exists {
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        if showAnswerButton.exists {
            throw LiveSmokeFailure.unexpectedReviewState(
                message: "Review answer did not reveal after tapping Show answer.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        throw LiveSmokeFailure.missingElement(
            identifier: LiveSmokeIdentifier.reviewRateGoodButton,
            timeoutSeconds: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }
}
