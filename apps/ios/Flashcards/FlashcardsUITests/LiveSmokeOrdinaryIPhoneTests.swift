import UIKit
import XCTest

final class LiveSmokeOrdinaryIPhoneTests: LiveSmokeTestCase {
    @MainActor
    func testOrdinaryPhoneReviewAIHandoffPreservesRevealedAnswer() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "This smoke requires a phone.")
        XCUIDevice.shared.orientation = .portrait
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.reviewAiButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertAiEntrySurfaceVisible()
        let consent = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(consent, identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds) {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiMessageRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.aiComposerDismissKeyboardButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }
}
