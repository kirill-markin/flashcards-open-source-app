import XCTest

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
    func testLiveSmokeReviewTagMenuAppliesImmediatelyAndStaysOpenUntilOutsideTap() throws {
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .review)
        let tagToggleIdentifier = LiveSmokeIdentifier.reviewFilterTagTogglePrefix + "smoke-guest-ai-review"

        try self.step("toggle the review tag without dismissing the menu") {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewFilterMenu,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: tagToggleIdentifier,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            self.app.descendants(matching: .any).matching(identifier: tagToggleIdentifier).firstMatch.tap()
            try self.assertElementExists(
                identifier: tagToggleIdentifier,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            self.app.descendants(matching: .any).matching(identifier: tagToggleIdentifier).firstMatch.tap()
            try self.assertElementExists(
                identifier: tagToggleIdentifier,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }

        try self.step("dismiss the review tag menu with an outside tap") {
            self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.reviewScreen).firstMatch.tap()
            try self.assertElementDoesNotExist(
                identifier: tagToggleIdentifier,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertTextExists(
                LiveSmokeLaunchFixtureData.aiReviewFrontText,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
        }
    }
}
