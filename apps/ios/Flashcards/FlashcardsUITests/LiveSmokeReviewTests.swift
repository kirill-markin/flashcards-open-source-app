import XCTest

private enum ReviewFilterToggleValue: String {
    case off = "0"
    case on = "1"
}

final class LiveSmokeReviewTests: LiveSmokeTestCase {
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

        try self.step("clear all review filters without dismissing the menu") {
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewFilterMenu,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
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
                .tap()

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
        }

        try self.step("dismiss the empty review filter menu with an outside tap") {
            self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.reviewScreen)
                .firstMatch
                .tap()
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

            self.app.descendants(matching: .any).matching(identifier: tagToggleIdentifier).firstMatch.tap()

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
            self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.reviewScreen)
                .firstMatch
                .tap()
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
                .tap()

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
            self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.reviewScreen)
                .firstMatch
                .tap()
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
}
