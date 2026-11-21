import Foundation
import UIKit
import XCTest

private struct LiveAIConsentReceipt: Equatable {
    let eventId: String
    let occurredAt: String
    let receivedAt: String
}

final class LiveSmokeAIConsentTests: LiveSmokeTestCase {
    @MainActor
    func testFreshGuestConsentDeclineRelaunchWithdrawalAndRegrant() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .ai)
        try self.assertConsentBlocksProducingControls()
        try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentNotNowButton, timeout: 10)
        try self.assertScreenVisible(screen: .review, timeout: 10)
        try self.tapTabBarItem(selectedTab: .ai, timeout: 10)
        try self.assertConsentBlocksProducingControls()
        try self.allowAIConsent()
        try self.createGuestAiConversationForReset()
        try self.openAIConsentLegalSettings()
        let grant = try self.readConsentReceipt()

        self.app.terminate()
        try self.launchApplication(launchScenario: nil, selectedTab: .ai)
        _ = try self.waitForAiComposerUsable(timeout: 30)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: 10)
        try self.openAIConsentLegalSettings()
        XCTAssertEqual(try self.readConsentReceipt(), grant)

        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentWithdrawButton, timeout: 10)
        let withdrawal = try self.readConsentReceiptDifferentFrom(grant.eventId)
        XCTAssertNotEqual(withdrawal.occurredAt, grant.occurredAt)
        try self.tapTabBarItem(selectedTab: .ai, timeout: 10)
        try self.assertConsentBlocksProducingControls()
        try self.tapButton(identifier: LiveSmokeIdentifier.aiHistoryButton, timeout: 10)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiHistoryList, timeout: 30)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiHistoryCurrentSessionRow, timeout: 30)

        self.app.terminate()
        try self.launchApplication(launchScenario: nil, selectedTab: .ai)
        try self.assertConsentBlocksProducingControls()
        try self.openAIConsentLegalSettings()
        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentReviewButton, timeout: 10)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiConsentBody, timeout: 10)
        try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: 10)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentTitle, timeout: 30)
        let regrant = try self.readConsentReceipt()
        XCTAssertNotEqual(regrant.eventId, grant.eventId)
        XCTAssertNotEqual(regrant.eventId, withdrawal.eventId)
        try self.tapTabBarItem(selectedTab: .ai, timeout: 10)
        try self.createGuestAiConversationForReset()
        try self.launchApplication(launchScenario: .marketingGuestSessionCleanup, selectedTab: .settings)
    }

    @MainActor
    func testLegacyTrueRequiresNewConsentWithoutInventedTimestamp() throws {
        self.additionalLaunchArguments = ["-ai-chat-external-provider-consent", "YES"]
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .ai)
        try self.assertConsentBlocksProducingControls()
        try self.openAIConsentLegalSettings()
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentActionTime, timeout: 10)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentReceivedTime, timeout: 10)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentReceiptId, timeout: 10)
        self.additionalLaunchArguments = []
        self.app.terminate()
        try self.launchApplication(launchScenario: nil, selectedTab: .ai)
        try self.assertConsentBlocksProducingControls()
    }

    @MainActor
    func testRealRegistrationFailureBlocksSharingAndRetriesOriginalAction() throws {
        self.additionalLaunchEnvironment = ["FLASHCARDS_UI_TEST_AI_CONSENT_UNREACHABLE": "1"]
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .ai)
        try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: 10)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiConsentFailure, timeout: 30)
        try self.assertConsentBlocksProducingControls()
        try self.openAIConsentLegalSettings()
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentPending, timeout: 10)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentReceiptId, timeout: 10)
        let actionTime = try self.consentValue(identifier: LiveSmokeIdentifier.aiConsentActionTime)

        self.additionalLaunchEnvironment = [:]
        self.app.terminate()
        try self.launchApplication(launchScenario: nil, selectedTab: .settings)
        try self.openAIConsentLegalSettings()
        let receipt = try self.readConsentReceipt()
        XCTAssertEqual(receipt.occurredAt, actionTime)
        try self.tapTabBarItem(selectedTab: .ai, timeout: 10)
        _ = try self.waitForAiComposerUsable(timeout: 30)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: 10)
        self.additionalLaunchEnvironment = ["FLASHCARDS_UI_TEST_AI_CONSENT_UNREACHABLE": "1"]
        self.app.terminate()
        try self.launchApplication(launchScenario: nil, selectedTab: .settings)
        try self.openAIConsentLegalSettings()
        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentWithdrawButton, timeout: 10)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentFailure, timeout: 30)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentPending, timeout: 10)
        let withdrawalTime = try self.consentValue(identifier: LiveSmokeIdentifier.aiConsentActionTime)
        self.app.terminate()
        try self.launchApplication(launchScenario: nil, selectedTab: .ai)
        try self.assertConsentBlocksProducingControls()
        self.additionalLaunchEnvironment = [:]
        self.app.terminate()
        try self.launchApplication(launchScenario: nil, selectedTab: .settings)
        try self.openAIConsentLegalSettings()
        XCTAssertEqual(try self.readConsentReceipt().occurredAt, withdrawalTime)
        try self.tapTabBarItem(selectedTab: .ai, timeout: 10)
        try self.assertConsentBlocksProducingControls()
        try self.launchApplication(launchScenario: .marketingGuestSessionCleanup, selectedTab: .settings)
    }

    @MainActor
    func testGuestReceiptTransfersThroughVerifiedReviewAccountAndLogoutClearsAdmission() throws {
        guard let email = ProcessInfo.processInfo.environment[LiveSmokeConfiguration.reviewEmailEnvironmentKey], !email.isEmpty else {
            throw LiveSmokeFailure.unexpectedAccountState(message: "The linked consent smoke requires the configured review email.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
        }
        var guestReceipt: LiveAIConsentReceipt?
        var cleanupWithdrawalReceipt: LiveAIConsentReceipt?
        try self.runGuestToLinkedWorkspaceScenario(
            context: self.makeRunContext(), reviewEmail: email,
            beforeSignIn: {
                try self.tapTabBarItem(selectedTab: .ai, timeout: 10)
                try self.allowAIConsent()
                try self.openAIConsentLegalSettings()
                guestReceipt = try self.readConsentReceipt()
                try self.tapFirstNavigationBackButton()
            },
            // A guest upgrade can create the workspace in the chooser, where the typed name is not checked.
            afterWorkspaceCreated: {},
            beforeDelete: {
                try self.openAIConsentLegalSettings()
                let grant = try self.readConsentReceipt()
                try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentWithdrawButton, timeout: 10)
                try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentWithdrawButton, timeout: 10)
                cleanupWithdrawalReceipt = try self.readConsentReceiptDifferentFrom(grant.eventId)
                try self.tapFirstNavigationBackButton()
            },
            scenario: {
                try self.openAIConsentLegalSettings()
                XCTAssertEqual(try self.readConsentReceipt(), try XCTUnwrap(guestReceipt))
                try self.tapFirstNavigationBackButton()
                try self.tapTabBarItem(selectedTab: .ai, timeout: 10)
                _ = try self.waitForAiComposerUsable(timeout: 30)
                try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: 10)
                try self.createGuestAiConversationForReset()
                try self.tapTabBarItem(selectedTab: .settings, timeout: 10)
            }
        )
        try self.tapFirstNavigationBackButton()
        try self.scrollSettingsToCurrentWorkspaceRow()
        try self.openAIConsentLegalSettings()
        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentReviewButton, timeout: 10)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiConsentBody, timeout: 10)
        try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: 10)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentTitle, timeout: 30)
        let regrant = try self.readConsentReceiptDifferentFrom(try XCTUnwrap(cleanupWithdrawalReceipt).eventId)
        XCTAssertNotEqual(regrant.eventId, try XCTUnwrap(guestReceipt).eventId)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentWithdrawButton, timeout: 10)
        try self.tapFirstNavigationBackButton()
        try self.openAccountStatus()
        try self.logoutFromAccountStatus()
        try self.tapFirstNavigationBackButton()
        try self.tapTabBarItem(selectedTab: .ai, timeout: 10)
        try self.assertConsentBlocksProducingControls()
        try self.openAIConsentLegalSettings()
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentActionTime, timeout: 10)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentReceiptId, timeout: 10)
    }

    @MainActor
    func testWideCompanionAndCardHandoffStayBlockedAfterWithdrawal() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This flow uses the iPad or Catalyst companion.")
        #if !targetEnvironment(macCatalyst)
        defer { XCUIDevice.shared.orientation = .portrait }
        #endif
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        #if !targetEnvironment(macCatalyst)
        XCUIDevice.shared.orientation = .landscapeLeft
        #endif
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: 10)
        try self.assertConsentBlocksProducingControls()
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: 10)
        try self.waitForReviewAnswerReveal()
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewAiButton, timeout: 10)
        try self.assertConsentBlocksProducingControls()
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip, timeout: 10)
        try self.allowAIConsent()
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip, timeout: 30)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerDictationButton, timeout: 10)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerAttachmentButton, timeout: 10)
        try self.openAIConsentLegalSettings()
        let grant = try self.readConsentReceipt()
        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentWithdrawButton, timeout: 10)
        _ = try self.readConsentReceiptDifferentFrom(grant.eventId)
        try self.tapTabBarItem(selectedTab: .review, timeout: 10)
        try self.assertConsentBlocksProducingControls()
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewAiButton, timeout: 10)
        try self.assertConsentBlocksProducingControls()
        try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentNotNowButton, timeout: 10)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: 10)
        try self.assertScreenVisible(screen: .review, timeout: 10)
        try self.launchApplication(launchScenario: .marketingGuestSessionCleanup, selectedTab: .settings)
    }

    @MainActor
    private func allowAIConsent() throws {
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiConsentBody, timeout: 10)
        let body = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.aiConsentBody).firstMatch.label
        self.add(self.makeTextAttachment(name: "ai-consent-displayed-disclosure", text: body))
        let screenshot = XCTAttachment(screenshot: self.app.screenshot())
        screenshot.name = "ai-consent-disclosure-native-screen"
        screenshot.lifetime = .keepAlways
        self.add(screenshot)
        try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: 10)
        try self.waitForAiComposerAfterConsent()
    }

    @MainActor
    private func assertConsentBlocksProducingControls() throws {
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: 30)
        for identifier in [LiveSmokeIdentifier.aiComposerTextField, LiveSmokeIdentifier.aiComposerSendButton,
                           LiveSmokeIdentifier.aiComposerDictationButton, LiveSmokeIdentifier.aiComposerAttachmentButton,
                           LiveSmokeIdentifier.aiNewChatButton, LiveSmokeIdentifier.aiDictationStatus] {
            try self.assertElementDoesNotExist(identifier: identifier, timeout: 10)
        }
    }

    @MainActor
    private func openAIConsentLegalSettings() throws {
        try self.tapTabBarItem(selectedTab: .settings, timeout: 10)
        try self.tapSettingsButtonScrollingIntoView(identifier: LiveSmokeIdentifier.settingsLegalRow, timeout: 30)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentReviewButton, timeout: 10)
    }

    @MainActor
    private func consentValue(identifier: String) throws -> String {
        try self.assertElementExistsScrollingIntoView(identifier: identifier, timeout: 30)
        let element = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        guard let value = element.value as? String, !value.isEmpty else {
            throw LiveSmokeFailure.unexpectedAiConversationState(message: "Consent metadata has no accessibility value: \(identifier)", screen: self.currentScreenSummary(), step: self.currentStepTitle)
        }
        return value
    }

    @MainActor
    private func readConsentReceipt() throws -> LiveAIConsentReceipt {
        let occurredAt = try self.consentValue(identifier: LiveSmokeIdentifier.aiConsentActionTime)
        let receivedAt = try self.consentValue(identifier: LiveSmokeIdentifier.aiConsentReceivedTime)
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentReceiptId, timeout: 30)
        let eventId = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.aiConsentReceiptId).firstMatch.label
        XCTAssertNotNil(UUID(uuidString: eventId))
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        XCTAssertNotNil(formatter.date(from: occurredAt))
        XCTAssertNotNil(formatter.date(from: receivedAt))
        XCTAssertEqual(try self.consentValue(identifier: LiveSmokeIdentifier.aiConsentVersion), "2026-10-12.1")
        let receipt = LiveAIConsentReceipt(eventId: eventId, occurredAt: occurredAt, receivedAt: receivedAt)
        self.add(self.makeTextAttachment(name: "ai-consent-native-receipt-\(eventId)", text: "eventId=\(eventId)\noccurredAt=\(occurredAt)\nreceivedAt=\(receivedAt)"))
        return receipt
    }

    @MainActor
    private func readConsentReceiptDifferentFrom(_ previousId: String) throws -> LiveAIConsentReceipt {
        let element = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.aiConsentReceiptId).firstMatch
        try self.assertElementExistsScrollingIntoView(identifier: LiveSmokeIdentifier.aiConsentReceiptId, timeout: 30)
        let predicate = NSPredicate(format: "label != %@", previousId)
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: element)], timeout: 30), .completed)
        return try self.readConsentReceipt()
    }
}
