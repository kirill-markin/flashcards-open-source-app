import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func createManualCard(frontText: String, backText: String) throws {
        try self.assertScreenVisible(screen: .cards, timeout: self.shortUiTimeoutSeconds)
        try self.tapElement(identifier: LiveSmokeIdentifier.cardsAddButton, timeout: self.longUiTimeoutSeconds)
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.cardEditorScreen,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: self.longUiTimeoutSeconds)
        try self.typeTextSafely(
            frontText,
            intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorBackRow, timeout: self.longUiTimeoutSeconds)
        try self.typeTextSafely(
            backText,
            intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorBackTextEditor,
            timeout: self.longUiTimeoutSeconds
        )
        try self.tapFirstNavigationBackButton()
        try self.tapElement(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: self.longUiTimeoutSeconds)
        try self.assertTextExists(frontText, timeout: self.longUiTimeoutSeconds)
    }

    @MainActor
    func reviewCurrentCard(expectedFrontText: String) throws {
        try self.assertScreenVisible(screen: .review, timeout: self.shortUiTimeoutSeconds)
        try self.assertTextExists(
            expectedFrontText,
            timeout: self.reviewInitialProbeTimeoutSeconds
        )
        try self.tapElement(
            identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
            timeout: self.reviewInteractionTimeoutSeconds
        )
        try self.waitForReviewAnswerReveal()
        try self.tapElement(
            identifier: LiveSmokeIdentifier.reviewRateGoodButton,
            timeout: self.reviewInteractionTimeoutSeconds
        )
    }

    @MainActor
    func waitForReviewAnswerReveal() throws {
        let showAnswerButton = self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton]
        let rateGoodButton = self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton]
        let deadline = Date().addingTimeInterval(self.reviewInteractionTimeoutSeconds)

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
            timeoutSeconds: self.reviewInteractionTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }
}
