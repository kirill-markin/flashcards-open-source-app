import XCTest

extension LiveSmokeUITests {
    @MainActor
    func testLiveSmokeManualCardCreationFlow() throws {
        let context = self.makeRunContext()
        try self.launchApplication(resetState: .localGuest, selectedTab: .cards)

        try self.step("create one local manual card without login") {
            try self.createManualCard(frontText: context.manualFrontText, backText: context.manualBackText)
        }
    }

    @MainActor
    func testLiveSmokeCardsEditorAiHandoffFlow() throws {
        try self.launchApplication(resetState: .localGuestSeededManualReviewCard, selectedTab: .cards)

        try self.step("open the seeded card editor and hand off to AI") {
            try self.openFirstCardForEditing()
            try self.handoffEditedCardToAIAndAssertDraftAttachment()
        }
    }
}
