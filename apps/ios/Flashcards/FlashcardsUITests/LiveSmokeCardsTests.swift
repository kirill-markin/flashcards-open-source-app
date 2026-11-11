import XCTest

final class LiveSmokeCardsTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeManualCardCreationFlow() throws {
        let context = self.makeRunContext()
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)

        try self.step("create one guest manual card without login") {
            try self.createManualCard(frontText: context.manualFrontText, backText: context.manualBackText)
        }
    }

    @MainActor
    func testLiveSmokeCreateAndReviewCardAcrossRelaunch() throws {
        let context = self.makeRunContext()
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)

        try self.step("create one manual card without signing in") {
            try self.createManualCard(frontText: context.manualFrontText, backText: context.manualBackText)
        }

        try self.step("relaunch without resetting the workspace, then review the saved card") {
            self.app.terminate()
            try self.launchApplication(launchScenario: nil, selectedTab: .review)
            try self.reviewCurrentCard(expectedFrontText: context.manualFrontText)
            try self.tapTabBarItem(selectedTab: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForSavedLocalReviewRatings(goodCount: 1, easyCount: 0)
        }

        try self.step("relaunch and confirm the saved rating remains in local Progress") {
            self.app.terminate()
            try self.launchApplication(launchScenario: nil, selectedTab: .progress)
            try self.waitForSavedLocalReviewRatings(goodCount: 1, easyCount: 0)
        }
    }

    @MainActor
    func testLiveSmokeUnsavedCardDraftSurvivesInteractiveDismissal() throws {
        let frontText = "Unsaved card draft \(UUID().uuidString)"
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)

        try self.step("keep an unsaved card draft after interactive dismissal") {
            try self.assertUnsavedCardDraftSurvivesInteractiveDismissal(frontText: frontText)
        }
    }

    @MainActor
    func testLiveSmokeCardsEditorAiHandoffFlow() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)

        try self.step("open the guest manual card editor and hand off to AI") {
            try self.openFirstCardForEditing()
            try self.handoffEditedCardToAIAndAssertDraftAttachment()
        }
    }
}
