import XCTest

private enum ReviewFilterToggleValue: String {
    case off = "0"
    case on = "1"
}

final class LiveSmokeReviewTests: LiveSmokeTestCase {
    #if !targetEnvironment(macCatalyst)
    @MainActor
    func testLiveSmokeReviewAndComposerNativeSizing() throws {
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .review)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds)
        func capture(_ name: String) {
            let image = XCTAttachment(screenshot: self.app.screenshot())
            image.name = name
            image.lifetime = .keepAlways
            self.add(image)
        }
        capture("mobile-native-review-tag-row")
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.progress.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertTrue(self.app.staticTexts["Streak"].firstMatch.waitForExistence(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds))
        capture("mobile-native-progress-top")
        self.app.scrollViews[LiveSmokeIdentifier.progressScreen].firstMatch.swipeUp()
        capture("mobile-native-progress-scrolled")
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.ai.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        if self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].waitForExistence(timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds) {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
        let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        capture("mobile-native-composer-idle")
        try self.typeTextSafely("Unsent native control sizing check", intoElement: composer,
            identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        capture("mobile-native-composer-focused")
        try self.tapButton(identifier: LiveSmokeIdentifier.aiComposerDismissKeyboardButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForAiComposerValue("Unsent native control sizing check", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        capture("mobile-native-composer-dismissed")
        let geometry = XCTAttachment(string: self.app.debugDescription)
        geometry.name = "mobile-native-control-hierarchy"
        geometry.lifetime = .keepAlways
        self.add(geometry)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiMessageRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }
    #endif

    @MainActor
    func testLiveSmokeManualCardReviewFlow() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)

        try self.step("review the guest manual card") {
            try self.reviewCurrentCard(
                expectedFrontText: LiveSmokeLaunchFixtureData.manualReviewFrontText
            )
        }
    }

    @MainActor
    func testLiveSmokeReviewReminderTabBadgeClearsAfterReview() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCardWithReminderAttention, selectedTab: .review)

        try self.step("verify review reminder tab badge is visible") {
            try self.assertReviewReminderTabBadgeVisible(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("review the reminded guest manual card") {
            try self.reviewCurrentCard(
                expectedFrontText: LiveSmokeLaunchFixtureData.manualReviewFrontText
            )
        }

        try self.step("verify review reminder tab badge is gone") {
            try self.assertReviewReminderTabBadgeHidden(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    func testLiveSmokeGuestAiCardReviewFlow() throws {
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .review)

        try self.step("review the guest AI card") {
            try self.reviewCurrentCard(
                expectedFrontText: LiveSmokeLaunchFixtureData.aiReviewFrontText
            )
        }
    }

    @MainActor
    func testLiveSmokeReviewFilterMenuSupportsEmptyTagAndAllCardsStates() throws {
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .review)
        let tagToggleIdentifier = LiveSmokeIdentifier.reviewFilterTagTogglePrefix + "smoke-guest-ai-review"
        let lowerTagToggleIdentifier = LiveSmokeIdentifier.reviewFilterTagTogglePrefix + "smoke-overflow-12"

        try self.step("keep a lower review filter row visible after changing its draft selection") {
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewFilterMenu,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.tapReviewFilterButtonScrollingIntoView(identifier: lowerTagToggleIdentifier)
            try self.assertReviewFilterToggleValue(
                identifier: lowerTagToggleIdentifier,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            let lowerTagToggle = self.app.buttons[lowerTagToggleIdentifier].firstMatch
            guard lowerTagToggle.isHittable else {
                throw LiveSmokeFailure.unexpectedReviewState(
                    message: "The toggled lower review filter row moved out of view.",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            lowerTagToggle.clickOrTap()
            try self.assertReviewFilterToggleValue(
                identifier: lowerTagToggleIdentifier,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.scrollReviewFilterToTop()
        }

        try self.step("clear all review filters without dismissing the menu") {
            try self.assertReviewFilterToggleValue(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: tagToggleIdentifier,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle)
                .firstMatch
                .clickOrTap()

            try self.assertReviewFilterToggleValue(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: tagToggleIdentifier,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }

        try self.step("dismiss the empty review filter menu with an outside tap") {
            try self.dismissReviewFilterPopoverWithOutsideTap()
            try self.assertElementDoesNotExist(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementDoesNotExist(
                identifier: tagToggleIdentifier,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementDoesNotExist(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
        }

        try self.step("select one review tag from empty without dismissing the menu") {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewFilterMenu,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: tagToggleIdentifier,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            self.app.descendants(matching: .any).matching(identifier: tagToggleIdentifier).firstMatch.clickOrTap()

            try self.assertReviewFilterToggleValue(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: tagToggleIdentifier,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }

        try self.step("verify the tagged card returns after dismissing the menu") {
            try self.dismissReviewFilterPopoverWithOutsideTap()
            try self.assertElementDoesNotExist(
                identifier: tagToggleIdentifier,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
        }

        try self.step("restore all cards without dismissing the menu") {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewFilterMenu,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle)
                .firstMatch
                .clickOrTap()

            try self.assertReviewFilterToggleValue(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: tagToggleIdentifier,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }

        try self.step("verify the all cards review returns after dismissing the menu") {
            try self.dismissReviewFilterPopoverWithOutsideTap()
            try self.assertElementDoesNotExist(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
        }
    }

    @MainActor
    private func assertReviewFilterToggleValue(
        identifier: String,
        expectedValue: ReviewFilterToggleValue,
        timeout: TimeInterval
    ) throws {
        let toggle = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        try self.assertElementExists(identifier: identifier, timeout: timeout)

        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if self.elementValue(element: toggle) == expectedValue.rawValue {
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        throw LiveSmokeFailure.unexpectedReviewState(
            message: "Expected review filter toggle '\(identifier)' to have value '\(expectedValue.rawValue)', found '\(self.elementValue(element: toggle))'.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func tapReviewFilterButtonScrollingIntoView(identifier: String) throws {
        let scrollSurface = self.app.scrollViews[LiveSmokeIdentifier.reviewFilterScrollSurface].firstMatch
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.reviewFilterScrollSurface,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )

        let button = self.app.buttons[identifier].firstMatch
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            if button.exists && button.isHittable {
                button.clickOrTap()
                return
            }

            scrollSurface.scrollTowardLaterContent()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        throw LiveSmokeFailure.missingElement(
            identifier: identifier,
            timeoutSeconds: LiveSmokeConfiguration.shortUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func scrollReviewFilterToTop() throws {
        let scrollSurface = self.app.scrollViews[LiveSmokeIdentifier.reviewFilterScrollSurface].firstMatch
        let allCardsButton = self.app.buttons[LiveSmokeIdentifier.reviewFilterAllCardsToggle].firstMatch
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            if allCardsButton.exists && allCardsButton.isHittable {
                return
            }

            scrollSurface.scrollTowardEarlierContent()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        throw LiveSmokeFailure.missingElement(
            identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
            timeoutSeconds: LiveSmokeConfiguration.shortUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func dismissReviewFilterPopoverWithOutsideTap() throws {
        let dismissRegion = self.app.otherElements[LiveSmokeIdentifier.popoverDismissRegion].firstMatch
        guard dismissRegion.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) else {
            throw LiveSmokeFailure.unexpectedReviewState(
                message: "The review filter popover dismiss region was not present, so the popover could not be dismissed.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        dismissRegion.clickOrTap()
    }
}
