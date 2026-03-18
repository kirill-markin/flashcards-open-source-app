import Foundation
import XCTest
@testable import Flashcards

final class AIChatConsentTests: XCTestCase {
    func testAIChatAccessStateRequiresConsentBeforeAIChatUnlocks() {
        XCTAssertEqual(
            aiChatAccessState(hasExternalProviderConsent: false),
            .consentRequired
        )
        XCTAssertEqual(
            aiChatAccessState(hasExternalProviderConsent: true),
            .ready
        )
    }

    func testAIChatConsentPersistsInUserDefaultsSuite() throws {
        let suiteName = "ai-chat-consent-tests-\(UUID().uuidString)"
        let initialDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        initialDefaults.removePersistentDomain(forName: suiteName)
        defer {
            initialDefaults.removePersistentDomain(forName: suiteName)
        }

        XCTAssertFalse(hasAIChatExternalProviderConsent(userDefaults: initialDefaults))
        grantAIChatExternalProviderConsent(userDefaults: initialDefaults)

        let reloadedDefaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        XCTAssertTrue(hasAIChatExternalProviderConsent(userDefaults: reloadedDefaults))
    }
}
