#if targetEnvironment(macCatalyst)
import XCTest

final class LiveSmokeMacCatalystTests: LiveSmokeTestCase {
    @MainActor
    func testMacPointerRatingRestoresSpaceAndAllRatingKeys() throws {
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)
        try self.step("create five cards through the shared editor") {
            for index in 1...5 {
                try self.createManualCard(
                    frontText: "Mac smoke question \(index)",
                    backText: "Answer \(index): inline $x^2$ and display math:\n\n$$\\frac{1}{2} + \\frac{1}{2} = 1$$"
                )
            }
        }
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds)
        self.app.activate()

        try self.step("reveal using Space and rate with the pointer") {
            self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].hover()
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            self.attachMacScreenshot(name: "mac-review-formulas")
            self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton].click()
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("use Space on the next card without clicking to regain focus") {
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            self.app.typeKey("1", modifierFlags: [])
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("review the remaining cards using keys 2 through 4") {
            for key in ["2", "3", "4"] {
                try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
                self.app.typeKey(key, modifierFlags: [])
                XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "Rating must not submit a hidden answer.")
                self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
                try self.waitForReviewAnswerReveal()
                self.app.typeKey(key, modifierFlags: [])
                try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            }
        }
    }

    @MainActor
    func testMacReviewHoverPreservesAICompanionTypingFocus() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.step("open the shared wide AI companion") {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewAiButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertAiEntrySurfaceVisible()
            let consent = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
            if consent.exists {
                try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.waitForAiComposerAfterConsent()
            }
            try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        }

        try self.step("type rating keys and Space after hovering review controls") {
            let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            try self.focusElementForTextInput(composer, identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            composer.typeText("Mac draft")
            self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton].hover()
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            for key in ["1", "2", "3", "4"] {
                self.app.typeKey(key, modifierFlags: [])
            }
            try self.waitForAiComposerValue("Mac draft 1234", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            self.attachMacScreenshot(name: "mac-ai-companion-focus")
            try self.tapButton(identifier: LiveSmokeIdentifier.aiComposerDismissKeyboardButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("preserve the unsent companion draft across primary sections") {
            for destination in [LiveSmokeSelectedTab.cards, .progress, .review] {
                try self.tapTabBarItem(identifier: destination.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertScreenVisible(screen: destination.screen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.waitForAiComposerValue("Mac draft 1234", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
            try self.waitForReviewAnswerReveal()
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiMessageRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    private func attachMacScreenshot(name: String) {
        let windowAttachment = XCTAttachment(screenshot: self.app.screenshot())
        windowAttachment.name = name + "-window"
        windowAttachment.lifetime = .keepAlways
        self.add(windowAttachment)
        let screenAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenAttachment.name = name + "-screen"
        screenAttachment.lifetime = .keepAlways
        self.add(screenAttachment)
    }
}
#endif
