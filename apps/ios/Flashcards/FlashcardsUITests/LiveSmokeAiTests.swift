import XCTest

final class LiveSmokeAiTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeGuestAiCardCreationFlow() throws {
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .ai)

        try self.step("create one guest AI card and confirm the insert completed") {
            try self.createAiCardWithConfirmation()
        }
    }

    @MainActor
    func testLiveSmokeGuestAiChatResetFlow() throws {
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .ai)

        try self.step("create one guest AI conversation before reset") {
            try self.createGuestAiConversationForReset()
        }

        try self.step("start a new chat and confirm the conversation resets cleanly") {
            try self.startNewAiChatAndAssertConversationReset()
        }
    }
}
