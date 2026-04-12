import Foundation
import XCTest
@testable import Flashcards

final class AIChatHistoryStoreCompatibilityTests: XCTestCase {
    func testHistoryStoreLoadsLegacyStateWithoutPendingToolRunPostSyncField() {
        let suiteName = "ai-chat-legacy-state-\(UUID().uuidString)"
        let userDefaults = UserDefaults(suiteName: suiteName)!
        defer {
            userDefaults.removePersistentDomain(forName: suiteName)
        }

        let store = AIChatHistoryStore(
            userDefaults: userDefaults,
            encoder: JSONEncoder(),
            decoder: JSONDecoder()
        )
        let legacyPayload = """
        {"messages":[],"chatSessionId":"session-1","lastKnownChatConfig":null}
        """
        userDefaults.set(2, forKey: "ai-chat-history-cleanup-version")
        userDefaults.set(Data(legacyPayload.utf8), forKey: aiChatHistoryStorageKey)

        let loadedState = store.loadState()

        XCTAssertEqual(loadedState.chatSessionId, "session-1")
        XCTAssertFalse(loadedState.pendingToolRunPostSync)
    }
}
