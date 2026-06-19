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
}
