import XCTest

final class LiveSmokeAiTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeGuestAiCardCreationFlow() throws {
        try self.launchApplication(resetState: .localGuest, selectedTab: .ai)

        try self.step("create one guest AI card and confirm the insert completed") {
            try self.createAiCardWithConfirmation()
        }
    }

    @MainActor
    func testLiveSmokeGuestAiChatResetFlow() throws {
        try self.launchApplication(resetState: .localGuest, selectedTab: .ai)

        try self.step("create one guest AI conversation before reset") {
            try self.createGuestAiConversationForReset()
        }

        try self.step("start a new chat and confirm the conversation resets cleanly") {
            try self.startNewAiChatAndAssertConversationReset()
        }
    }

    @MainActor
    func testLiveSmokeSeededLongAiConversationScrollsUpwardWithKeyboardClosedAndOpen() throws {
        try self.launchApplication(resetState: .localGuestSeededLongAIConversation, selectedTab: .ai)

        try self.step("confirm the seeded AI chat starts at the latest messages") {
            try self.assertSeededLongAiConversationStartsAtBottom()
        }

        try self.step("reveal older seeded AI messages with the keyboard closed") {
            try self.revealOlderSeededAiMessagesWithKeyboardClosed()
        }

        try self.step("reveal older seeded AI messages with the keyboard open") {
            try self.revealOlderSeededAiMessagesWithKeyboardOpen()
        }
    }
}
