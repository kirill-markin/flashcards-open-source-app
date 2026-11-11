import UIKit
import XCTest

final class LiveSmokeIPadTests: LiveSmokeTestCase {
    @MainActor
    func testIPadCompanionPreservesDraftAndRevealedReviewAcrossSections() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke requires an iPad.")
#if !targetEnvironment(macCatalyst)
        defer { XCUIDevice.shared.orientation = .portrait }
#endif
        // The tagged card gives the filter a tag row, the only choice that keeps the menu open with a pending draft.
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .review)
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
        #if targetEnvironment(macCatalyst)
        let draft = "1"
        self.app.typeKey(draft, modifierFlags: [])
        self.app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
        #else
        let draft = "Keep this unsent companion draft"
        composer.typeText(draft)
        try self.tapButton(identifier: LiveSmokeIdentifier.aiComposerDismissKeyboardButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        #endif

        #if targetEnvironment(macCatalyst)
        let libraryDestination: LiveSmokeSelectedTab = .cards
        #else
        let libraryDestination: LiveSmokeSelectedTab = .library
        #endif
        for destination in [libraryDestination, .progress, .review] {
            try self.tapTabBarItem(identifier: destination.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: destination.screen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerValue(draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        try self.waitForReviewAnswerReveal()
        try self.assertTextExists("Smoke guest AI review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiMessageRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForAiComposerValue(draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
#if !targetEnvironment(macCatalyst)
        try self.assertReviewFilterLifetimeAcrossCompanionLayouts()
#endif
    }

#if !targetEnvironment(macCatalyst)
    @MainActor
    private func assertReviewFilterLifetimeAcrossCompanionLayouts() throws {
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCUIDevice.shared.orientation = .portrait
        try self.waitForReviewAnswerReveal()
        let allCards = self.app.buttons[LiveSmokeIdentifier.reviewFilterAllCardsToggle].firstMatch
        let tagToggleIdentifier = LiveSmokeIdentifier.reviewFilterTagTogglePrefix + "smoke-guest-ai-review"

        try self.step("retain a pending filter and revealed card through popup rotation") {
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: tagToggleIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertEqual(self.elementValue(element: allCards), "0")
            for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
                XCUIDevice.shared.orientation = orientation
                try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                XCTAssertEqual(self.elementValue(element: allCards), "0", "Rotation must preserve the pending filter while its control stays in place.")
                try self.waitForReviewAnswerReveal()
            }
            self.recordReviewFilterLayout(name: "review-filter-portrait")
            try self.tapButton(identifier: tagToggleIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertEqual(self.elementValue(element: allCards), "1", "Removing the last tag must select All cards.")
            try self.dismissReviewFilterWithOutsideTap()
            try self.waitForReviewAnswerReveal()
        }

        try self.step("commit the pending filter when rotation removes its companion toolbar control") {
            XCUIDevice.shared.orientation = .landscapeLeft
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerValue("Keep this unsent companion draft", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertEqual(self.elementValue(element: allCards), "1")
            try self.tapButton(identifier: tagToggleIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertEqual(self.elementValue(element: allCards), "0")
            self.recordReviewFilterLayout(name: "review-filter-companion-landscape")

            XCUIDevice.shared.orientation = .portrait
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertEqual(self.elementValue(element: allCards), "0", "Relocating the control must commit its pending filter.")
            XCTAssertEqual(self.elementValue(element: self.app.buttons[tagToggleIdentifier].firstMatch), "1")
            try self.tapButton(identifier: tagToggleIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.dismissReviewFilterWithOutsideTap()
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("reopen the native popup after hiding the companion") {
            XCUIDevice.shared.orientation = .landscapeLeft
            try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertEqual(self.elementValue(element: allCards), "1")
            try self.dismissReviewFilterWithOutsideTap()
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertEqual(self.elementValue(element: allCards), "1")
            try self.dismissReviewFilterWithOutsideTap()
        }
    }

    @MainActor
    private func dismissReviewFilterWithOutsideTap() throws {
        let dismissRegion = self.app.otherElements[LiveSmokeIdentifier.popoverDismissRegion].firstMatch
        try self.tapButton(button: dismissRegion, identifier: LiveSmokeIdentifier.popoverDismissRegion, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    private func recordReviewFilterLayout(name: String) {
        let screenshot = XCTAttachment(screenshot: self.app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        self.add(screenshot)
        self.add(self.makeTextAttachment(name: name + "-hierarchy", text: self.app.debugDescription))
    }
#endif

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
            studySurface.clickOrTap()
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
            studySurface.clickOrTap()
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
            studySurface.clickOrTap()
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
