import Foundation
import XCTest
@testable import Flashcards

final class AIChatConsentTests: XCTestCase {
    func testAIChatAccessStateRequiresConsentForLinkedUsers() {
        XCTAssertEqual(
            aiChatAccessState(cloudState: .linked, hasExternalProviderConsent: false),
            .consentRequired
        )
        XCTAssertEqual(
            aiChatAccessState(cloudState: .linked, hasExternalProviderConsent: true),
            .ready
        )
        XCTAssertEqual(
            aiChatAccessState(cloudState: .disconnected, hasExternalProviderConsent: true),
            .signInRequired
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
