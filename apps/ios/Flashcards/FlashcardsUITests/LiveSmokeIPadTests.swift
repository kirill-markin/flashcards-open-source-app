import UIKit
import XCTest

final class LiveSmokeIPadTests: LiveSmokeTestCase {
    @MainActor
    func testIPadCompanionPreservesDraftAndRevealedReviewAcrossSections() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke requires an iPad.")
#if !targetEnvironment(macCatalyst)
        defer { XCUIDevice.shared.orientation = .portrait }
#endif
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
#if !targetEnvironment(macCatalyst)
        XCUIDevice.shared.orientation = .landscapeLeft
#endif
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewAiButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.acceptCompanionConsentIfPresented()
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.focusElementForTextInput(composer, identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        composer.typeText("Keep this unsent companion draft")
        try self.tapButton(identifier: LiveSmokeIdentifier.aiComposerDismissKeyboardButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

        for destination in [LiveSmokeSelectedTab.cards, .progress, .review] {
            try self.tapTabBarItem(identifier: destination.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: destination.screen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerValue("Keep this unsent companion draft", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        try self.waitForReviewAnswerReveal()
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiMessageRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForAiComposerValue("Keep this unsent companion draft", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func testIPadReviewHardwareKeysRespectFilterAndRateCards() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke requires an iPad hardware-key surface.")
        for key in ["1", "2", "3", "4"] {
            try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .review)
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
#if targetEnvironment(macCatalyst)
            self.app.activate()
#else
            let studySurface = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.reviewScreen).firstMatch
            studySurface.tap()
#endif
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewCardTagChipPrefix + "smoke-guest-ai-review", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
#if targetEnvironment(macCatalyst)
            try self.waitForNativeTagFilterSheet(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
#endif
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            self.app.typeKey(key, modifierFlags: [])
#if targetEnvironment(macCatalyst)
            try self.cancelNativeTagFilterSheet(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
#else
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewTagFilterCancelButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
#endif
#if targetEnvironment(macCatalyst)
            self.app.activate()
#else
            studySurface.tap()
#endif
            self.app.typeKey(key, modifierFlags: [])
            XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "A rating key must not submit a hidden answer.")
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.app.typeKey(key, modifierFlags: [])
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            let dismissRegion = self.app.otherElements[LiveSmokeIdentifier.popoverDismissRegion].firstMatch
            try self.tapButton(button: dismissRegion, identifier: LiveSmokeIdentifier.popoverDismissRegion, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewCardTagChipPrefix + "smoke-guest-ai-review", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
#if targetEnvironment(macCatalyst)
            try self.waitForNativeTagFilterSheet(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
#endif
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            self.app.typeKey(key, modifierFlags: [])
#if targetEnvironment(macCatalyst)
            try self.cancelNativeTagFilterSheet(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
#else
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewTagFilterCancelButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
#endif
            try self.waitForReviewAnswerReveal()
#if targetEnvironment(macCatalyst)
            self.app.activate()
#else
            studySurface.tap()
#endif
            self.app.typeKey(key, modifierFlags: [])
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

#if targetEnvironment(macCatalyst)
    @MainActor
    private func waitForNativeTagFilterSheet(timeout: TimeInterval) throws {
        let sheet = self.app.sheets.firstMatch
        if self.waitForOptionalElement(sheet, identifier: "review.tagFilter.nativeSheet", timeout: timeout) == false {
            throw LiveSmokeFailure.missingElement(identifier: "review.tagFilter.nativeSheet", timeoutSeconds: timeout, screen: self.currentScreenSummary(), step: self.currentStepTitle)
        }
    }

    @MainActor
    private func cancelNativeTagFilterSheet(timeout: TimeInterval) throws {
        let sheet = self.app.sheets.firstMatch
        self.app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
        if sheet.waitForNonExistence(timeout: timeout) == false {
            throw LiveSmokeFailure.elementDidNotDisappear(identifier: "review.tagFilter.nativeSheet", timeoutSeconds: timeout, screen: self.currentScreenSummary(), step: self.currentStepTitle)
        }
    }
#endif

    @MainActor
    private func acceptCompanionConsentIfPresented() throws {
        let consent = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if self.waitForOptionalElement(consent, identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds) {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
    }
}
