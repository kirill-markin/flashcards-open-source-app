#if targetEnvironment(macCatalyst)
import XCTest

final class LiveSmokeMacCatalystTests: LiveSmokeTestCase {
    // XCTest synthesizes .enter as HID 52 in this Catalyst runner; cover physical keypad Enter manually.
    @MainActor
    func testMacPointerRatingRestoresSpaceAndAllRatingKeys() throws {
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)
        try self.step("create seven cards through the shared editor") {
            for index in 1...7 {
                try self.createManualCard(
                    frontText: "Mac smoke question \(index)",
                    backText: "Answer \(index): inline $x^2$ and display math:\n\n$$\\frac{1}{2} + \\frac{1}{2} = 1$$"
                )
            }
        }
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds)
        self.app.activate()
        let expectedQuestions = (1...7).map { "Mac smoke question \($0)" }
        let reviewFront = self.app.descendants(matching: .any)
            .matching(identifier: "review.frontSelectableText").firstMatch
        let expectedCard = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND (value IN %@ OR label IN %@)", expectedQuestions, expectedQuestions),
            object: reviewFront
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectedCard], timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds),
            .completed,
            "Review must show a card created by this smoke before synthesizing pointer events."
        )

        try self.step("reveal using Space and rate with the pointer") {
            self.hoverMacShortcutButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, expectedHelp: "Press Space / Enter")
            self.attachMacScreenshot(name: "mac-show-answer-shortcut-help")
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            self.attachMacScreenshot(name: "mac-review-formulas")
            for (identifier, key) in [
                ("review.rating.0", "1"),
                ("review.rating.1", "2"),
                (LiveSmokeIdentifier.reviewRateGoodButton, "3"),
                ("review.rating.3", "4")
            ] {
                self.hoverMacShortcutButton(identifier: identifier, expectedHelp: "Press " + key)
                self.attachMacScreenshot(name: "mac-rating-" + key + "-shortcut-help")
            }
            self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton].click()
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("use Space on the next card without clicking to regain focus") {
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            self.app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: [])
            self.app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            self.app.typeKey("1", modifierFlags: [])
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("restore study focus after activation and reveal with Return and Space") {
            self.app.typeKey("h", modifierFlags: .command)
            self.app.activate()
            try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            for (key, revealKey) in [
                ("2", XCUIKeyboardKey.return),
                ("3", XCUIKeyboardKey.return),
                ("4", XCUIKeyboardKey.space)
            ] {
                try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
                self.app.typeKey(key, modifierFlags: [])
                XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "Rating must not submit a hidden answer.")
                self.app.typeKey(revealKey.rawValue, modifierFlags: [])
                try self.waitForReviewAnswerReveal()
                self.app.typeKey(key, modifierFlags: [])
                try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            }
        }

        try self.step("reveal with Space and Return and rate with 1 while the sidebar holds focus") {
            for revealKey in [XCUIKeyboardKey.space, XCUIKeyboardKey.return] {
                try self.tapTabBarItem(identifier: LiveSmokeIdentifier.rootTabReviewItem, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
                self.app.typeKey(revealKey.rawValue, modifierFlags: [])
                try self.waitForReviewAnswerReveal()
                self.app.typeKey("1", modifierFlags: [])
                try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            }
        }
    }

    @MainActor
    func testMacReviewHoverPreservesAICompanionTypingFocus() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)
        try self.createManualCard(frontText: "Mac companion focus smoke", backText: "Second card for focus restoration")
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.step("reveal on first opening Review without clicking for focus") {
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds)
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
        }
        try self.step("open the shared wide AI companion") {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
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
            self.app.typeKey("h", modifierFlags: .command)
            self.app.activate()
            try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.hoverMacShortcutButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, expectedHelp: "Press 3")
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            for key in ["1", "2", "3", "4"] {
                self.app.typeKey(key, modifierFlags: [])
            }
            self.app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: .shift)
            self.app.typeText("Still drafting")
            self.app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: .shift)
            self.app.typeText("Unsent")
            try self.waitForAiComposerValue("Mac draft 1234\nStill drafting\nUnsent", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            self.attachMacScreenshot(name: "mac-ai-companion-focus")
            try self.tapButton(identifier: LiveSmokeIdentifier.aiComposerDismissKeyboardButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.app.typeKey("3", modifierFlags: [])
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("restore study keys immediately after closing the focused companion") {
            let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.focusElementForTextInput(composer, identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("preserve the unsent companion draft across primary sections") {
            for destination in [LiveSmokeSelectedTab.cards, .progress, .review] {
                try self.tapTabBarItem(identifier: destination.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertScreenVisible(screen: destination.screen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.waitForAiComposerValue("Mac draft 1234\nStill drafting\nUnsent", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
            try self.waitForReviewAnswerReveal()
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiMessageRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    private func hoverMacShortcutButton(identifier: String, expectedHelp: String) {
        let hint = self.app.staticTexts["review.shortcutHint"]
        self.app.staticTexts["review.companionTitle"].hover()
        let dismissed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: hint
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [dismissed], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds),
            .completed,
            "Previous shortcut tooltip must disappear before hovering " + identifier
        )
        let button = self.app.buttons[identifier]
        let hittable = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND hittable == true"),
            object: button
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [hittable], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds),
            .completed,
            "Expected a visible shortcut button before hover: " + identifier
        )
        button.hover()
        let appeared = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND label == %@", expectedHelp),
            object: hint
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [appeared], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds),
            .completed,
            "Expected fresh localized shortcut tooltip: " + expectedHelp
        )
        XCTAssertTrue(hint.frame.width > 0 && hint.frame.height > 0, "Shortcut tooltip must have visible bounds.")
        XCTAssertLessThanOrEqual(
            hint.frame.maxY,
            button.frame.minY + 0.5,
            "Shortcut tooltip must float above its button: " + identifier
        )
        XCTAssertTrue(self.app.windows.firstMatch.frame.contains(hint.frame), "Shortcut tooltip must stay inside the app window.")
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
