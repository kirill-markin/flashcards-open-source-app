import XCTest

final class LiveSmokeAiTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeGuestAiCardCreationFlow() throws {
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .ai)

        try self.step("grant guest consent and confirm a live AI card insert") {
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.aiConsentAcceptButton,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
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

        try self.step("open the previous chat read-only from chat history") {
            try self.openPreviousAiChatFromHistoryAndAssertReadOnly()
        }
    }
}
