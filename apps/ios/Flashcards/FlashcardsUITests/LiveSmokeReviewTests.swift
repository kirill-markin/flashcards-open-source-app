import XCTest

extension LiveSmokeUITests {
    @MainActor
    func testLiveSmokeManualCardReviewFlow() throws {
        try self.launchApplication(resetState: .localGuestSeededManualReviewCard, selectedTab: .review)

        try self.step("review the seeded manual card") {
            try self.reviewCurrentCard(
                expectedFrontText: LiveSmokeSeededData.manualReviewFrontText
            )
        }
    }

    @MainActor
    func testLiveSmokeGuestAiCardReviewFlow() throws {
        try self.launchApplication(resetState: .localGuestSeededAIReviewCard, selectedTab: .review)

        try self.step("review the seeded AI card") {
            try self.reviewCurrentCard(
                expectedFrontText: LiveSmokeSeededData.aiReviewFrontText
            )
        }
    }
}
