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
    func testLiveSmokeCardsEditorAiHandoffFlow() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)

        try self.step("open the guest manual card editor and hand off to AI") {
            try self.openFirstCardForEditing()
            try self.handoffEditedCardToAIAndAssertDraftAttachment()
        }
    }
}
