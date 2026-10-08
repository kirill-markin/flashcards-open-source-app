import UIKit
import XCTest

final class LiveSmokeIPadTests: LiveSmokeTestCase {
    @MainActor
    func testIPadReviewedCardAIHandoffKeepsToolbarCompact() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This regression exercises the iPad reviewed-card AI action.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.rotate(to: .landscapeLeft)
        if self.visibleIPadCompanionPane != nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        let sidebar = self.app.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch
        if sidebar.exists && sidebar.isHittable {
            self.app.buttons.matching(NSPredicate(format: "identifier IN %@", ["ToggleSideBar", "ToggleSidebar"])).firstMatch.tap()
        }
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        self.attachIPadScreenshot(name: "Reviewed card before actual AI handoff")
        for attempt in 1...2 {
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewAiButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertVisibleIPadCompanion()
            if self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].exists {
                try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.waitForAiComposerAfterConsent()
            }
            let dismissKeyboard = self.app.buttons[LiveSmokeIdentifier.aiComposerDismissKeyboardButton]
            if dismissKeyboard.exists && dismissKeyboard.isHittable { dismissKeyboard.tap() }
            try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertReviewFilterPlacementBesideChat()
            let toggle = self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle]
            let bar = try XCTUnwrap(self.app.navigationBars.allElementsBoundByIndex.first { $0.buttons[LiveSmokeIdentifier.aiCompanionToggle].exists })
            let bounds = XCTAttachment(string: "attempt=\(attempt), bar=\(bar.frame), toggle=\(toggle.frame), AI=\(String(describing: self.visibleIPadCompanionPane?.frame))")
            bounds.name = "Reviewed-card AI toolbar bounds"
            bounds.lifetime = .keepAlways
            self.add(bounds)
            self.attachIPadScreenshot(name: "Reviewed card actual AI handoff \(attempt)")
            XCTAssertLessThanOrEqual(bar.frame.maxY - toggle.frame.maxY, toggle.frame.height, "Opening AI from a reviewed card must not leave an empty large-title band below the native toolbar.")
            if attempt == 1 {
                try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
        }
    }

    @MainActor
    func testIPadReviewHardwareKeysMatchWebAndRespectFilterAndEditor() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke verifies iPad hardware keys.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.rotate(to: .landscapeLeft)
        if self.visibleIPadCompanionPane != nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        // Tap the question, rather than any action, to give the study surface keyboard focus.
        let question = self.app.staticTexts["Smoke guest manual review question"].firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        question.tap()
        self.app.typeKey("3", modifierFlags: [])
        XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "Ratings cannot submit a hidden answer.")
        self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
        try self.waitForReviewAnswerReveal()

        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.app.typeKey("3", modifierFlags: [])
        XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewFilterAllCardsToggle].exists)
        // An outside tap returns to the same card without changing the filter.
        let edit = self.app.buttons.matching(NSPredicate(format: "label == %@", "Edit card")).firstMatch
        let editPoint = self.app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: edit.frame.midX, dy: edit.frame.midY))
        editPoint.tap()
        XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewFilterAllCardsToggle].waitForNonExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        editPoint.tap()
        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let editor = self.app.textViews[LiveSmokeIdentifier.cardEditorFrontTextEditor].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        editor.tap()
        self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
        self.app.typeKey("3", modifierFlags: [])
        XCTAssertTrue((editor.value as? String)?.contains(" 3") == true, "Study keys must type in the card editor.")
        self.attachIPadScreenshot(name: "iPad hardware study keys suppressed in editor")
        try self.tapFirstNavigationBackButton()
        XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.cardEditorSaveButton].exists)
        let cancel = self.app.buttons.matching(NSPredicate(format: "label == %@", "Cancel")).firstMatch
        XCTAssertTrue(cancel.isHittable)
        cancel.tap()
        try self.assertTextExists("Smoke guest manual review question", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertAllReviewRatingsReachable()
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "Cancelling edits preserves the revealed study state.")
    }

    @MainActor
    func testIPadHardwareRatingKeysSubmitRevealedCards() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke verifies native iPad ratings.")
        defer { XCUIDevice.shared.orientation = .portrait }
        for key in ["1", "2", "3", "4"] {
            try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
            try self.rotate(to: .landscapeLeft)
            if self.visibleIPadCompanionPane != nil {
                try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
            let question = self.app.staticTexts["Smoke guest manual review question"].firstMatch
            XCTAssertTrue(question.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            question.tap()
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            self.app.typeKey(key, modifierFlags: [])
            XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton].waitForNonExistence(timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds), "Key \(key) must enqueue the revealed card and advance Review.")
            try self.assertTextExists("Nothing Due", timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            XCTAssertTrue(self.app.descendants(matching: .any).matching(identifier: LiveSmokeSelectedTab.review.itemIdentifier).firstMatch.isSelected, "Rating key \(key) must keep Review selected.")
        }
        self.attachIPadScreenshot(name: "iPad all four hardware ratings advance review")
    }

    @MainActor
    func testIPadChatHardwareKeysKeepStudyStateAndInsertShiftReturn() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke verifies native iPad composer keys.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.rotate(to: .landscapeLeft)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        if self.visibleIPadCompanionPane == nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        if self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].exists {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
        let composer = self.app.textFields[LiveSmokeIdentifier.aiComposerTextField].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds))
        composer.tap()
        func rawComposerValue() -> String { composer.value as? String ?? "" }
        let emptyValue = rawComposerValue()
        self.app.typeKey(XCUIKeyboardKey.return, modifierFlags: [])
        XCTAssertEqual(rawComposerValue(), emptyValue, "Empty Return must not add a line or submit.")
        self.app.typeKey("1", modifierFlags: [])
        self.app.typeKey(XCUIKeyboardKey.space, modifierFlags: [])
        self.app.typeKey("4", modifierFlags: [])
        XCTAssertEqual(rawComposerValue(), "1 4", "The multiline probe must start with the exact independently typed draft.")
        XCUIElement.perform(withKeyModifiers: .shift) {
            self.app.typeKey(XCUIKeyboardKey.return, modifierFlags: [])
        }
        self.app.typeKey("2", modifierFlags: [])
        XCTAssertEqual(composer.value as? String, "1 4\n2")
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertAllReviewRatingsReachable()
        self.attachIPadScreenshot(name: "iPad composer hardware keys preserve Review and multiline draft")
        try self.selectIPadDestination(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.app.typeKey(XCUIKeyboardKey.space, modifierFlags: [])
        self.app.typeKey("3", modifierFlags: [])
        try self.selectIPadDestination(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func testIPadChatUsesLeadingSideInArabicLayout() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke verifies Arabic iPad chat placement.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review, launchLocalization: .arabic)
        try self.rotate(to: .landscapeLeft)
        if self.visibleIPadCompanionPane != nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        let opener = self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle]
        let filter = self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu]
        XCTAssertTrue(opener.isHittable)
        XCTAssertGreaterThanOrEqual(opener.frame.minX, filter.frame.maxX, "The leading opener mirrors to the right in Arabic.")
        opener.tap()
        try self.assertVisibleIPadCompanion()
        let pane = try XCTUnwrap(self.visibleIPadCompanionPane)
        XCTAssertGreaterThanOrEqual(pane.frame.minX, self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].frame.maxX)
        self.attachIPadScreenshot(name: "iPad Arabic leading pane and pane-owned bubbles")
    }

    @MainActor
    func testIPadLatestReleaseSettingsIncludesSubscriptionAndAccentColor() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke verifies the current iPad settings.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .settings)
        try self.rotate(to: .landscapeLeft)

        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.settingsSubscriptionRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.subscriptionSettingsScreen,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        self.attachIPadScreenshot(name: "iPad 1.32 Subscription settings")
        try self.tapButton(button: self.app.navigationBars.buttons["BackButton"].firstMatch, identifier: "BackButton", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

        try self.tapButtonScrollingIntoView(
            identifier: LiveSmokeIdentifier.settingsAccentColorRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
        )
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.accentColorSettingsScreen,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )
        try self.assertTextExists("Default", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.attachIPadScreenshot(name: "iPad 1.32 Accent color settings")
    }

    @MainActor
    func testIPadCompactCardRowsAndAICompanionPreserveReview() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke exercises iPad layouts.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)
        try self.rotate(to: .landscapeLeft)

        let row = self.app.buttons[LiveSmokeIdentifier.cardsCardRow].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        XCTAssertLessThan(row.frame.height, 180, "A short card and its metadata must not fill most of the iPad screen.")
        self.attachIPadScreenshot(name: "iPad compact card list")

        if self.visibleIPadCompanionPane != nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()
        try self.assertPrimaryElementClearOfCompanion(row)
        XCTAssertEqual(self.app.buttons.matching(identifier: LiveSmokeIdentifier.aiCompanionToggle).count, 1, "One consistent bubbles button must show and hide chat.")
        XCTAssertTrue(row.isHittable, "Cards must remain usable beside AI.")
        self.attachIPadScreenshot(name: "iPad Cards with AI alongside")

        try self.openFirstCardForEditing()
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorEditWithAIButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()
        try self.assertPrimaryElementClearOfCompanion(row)
        XCTAssertTrue(row.isHittable, "The AI handoff must retain Cards as the primary surface.")

        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.selectIPadDestination(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let filter = self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu]
        XCTAssertTrue(filter.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        XCTAssertTrue(filter.label.contains("All cards"), "The glass selector must expose its deck title.")
        XCTAssertGreaterThan(filter.frame.width, 85, "The deck title must have room to render rather than collapse to its chevron.")
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()
        try self.assertPrimaryElementClearOfCompanion(filter)
        try self.assertReviewFilterPlacementBesideChat()
        filter.tap()
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.attachIPadScreenshot(name: "iPad Review column deck popover")
        // Dismiss outside without changing the committed selection or revealed answer.
        self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].tap()
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewFilterAllCardsToggle].exists)
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        if self.visibleIPadCompanionPane == nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        try self.assertVisibleIPadCompanion()
        for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
            try self.assertPrimaryElementClearOfCompanion(self.app.buttons[identifier])
        }
        let selectedReviewTab = self.app.buttons[LiveSmokeSelectedTab.review.itemIdentifier].firstMatch
        let selectedSidebarReview = self.app.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch
        if selectedReviewTab.exists && selectedReviewTab.isSelected && selectedReviewTab.isHittable {
            // The native top-tab branch intentionally renders a compact filter icon.
            XCTAssertEqual(filter.label, "Filters")
            XCTAssertEqual(self.elementValue(element: filter), "All cards", "The compact icon must retain the selected deck's accessibility value.")
            XCTAssertTrue(filter.isHittable && filter.frame.width > 0 && filter.frame.height > 0)
            XCTAssertLessThan(filter.frame.width, 85, "The native top-tab filter remains a compact icon rather than a clipped named selector.")
            XCTAssertTrue(self.app.windows.firstMatch.frame.contains(filter.frame))
            XCTAssertEqual(filter.frame.midY, selectedReviewTab.frame.midY, accuracy: 2)
        } else {
            XCTAssertTrue(selectedSidebarReview.exists && selectedSidebarReview.isSelected && selectedSidebarReview.isHittable, "A named selector requires actual native sidebar placement, not an inferred device width.")
            XCTAssertTrue(filter.label.contains("All cards"))
            XCTAssertGreaterThan(filter.frame.width, 85, "The native sidebar branch must keep the named deck title readable.")
        }
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.attachIPadScreenshot(name: "iPad revealed Review with AI alongside")
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
    }

    @MainActor
    func testIPadReviewFilterPlacementAcrossNativeSidebarAndChat() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke compares native iPad navigation placements.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.rotate(to: .landscapeLeft)
        if self.visibleIPadCompanionPane != nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        let sidebar = self.app.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch
        let navigationToggle = self.app.buttons.matching(NSPredicate(format: "identifier IN %@", ["ToggleSideBar", "ToggleSidebar"])).firstMatch
        var initialCollapsedHeaderY: CGFloat?
        for expanded in [false, true] {
            if (sidebar.exists && sidebar.isHittable) != expanded {
                XCTAssertTrue(navigationToggle.isHittable)
                navigationToggle.tap()
            }
            for chatOpen in [false, true] {
                if (self.visibleIPadCompanionPane != nil) != chatOpen {
                    let toggle = self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle]
                    if chatOpen {
                        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                    } else {
                        // Tap near the lower edge of the action, retaining a full 44-point interaction target.
                        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97)).tap()
                    }
                }
                if chatOpen { try self.assertVisibleIPadCompanion() }
                XCTAssertEqual(self.visibleIPadCompanionPane != nil, chatOpen, "An edge tap must close chat without losing the revealed answer.")
                let filter = self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu]
                XCTAssertTrue(filter.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds), "The filter returns to its native toolbar after the animated chat dismissal.")
                XCTAssertTrue(filter.isHittable)
                XCTAssertEqual(self.app.buttons.matching(identifier: LiveSmokeIdentifier.reviewFilterMenu).count, 1)
                XCTAssertEqual(sidebar.exists && sidebar.isHittable, expanded)
                try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                if chatOpen {
                    try self.assertVisibleIPadCompanion()
                    if self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].exists {
                        try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                        try self.waitForAiComposerAfterConsent()
                    }
                    try self.assertReviewFilterPlacementBesideChat()
                    if !expanded { initialCollapsedHeaderY = filter.frame.minY }
                }
                self.attachIPadScreenshot(name: "Review filter sidebar-\(expanded) chat-\(chatOpen)")
            }
        }
        // Hiding navigation while chat stays open reproduces the reported top-tab spacing.
        navigationToggle.tap()
        try self.assertVisibleIPadCompanion()
        try self.assertReviewFilterPlacementBesideChat()
        XCTAssertEqual(self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu].frame.minY, try XCTUnwrap(initialCollapsedHeaderY), accuracy: 2, "Hiding navigation while chat remains open must not add a second native top-tab inset.")
        let topTab = self.app.buttons[LiveSmokeSelectedTab.review.itemIdentifier].firstMatch
        XCTAssertTrue(topTab.exists && topTab.isHittable, "The native Review top tab remains reachable after collapsing the sidebar.")
        XCTAssertEqual(self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu].frame.midY, topTab.frame.midY, accuracy: 2)
        XCTAssertEqual(self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].frame.midY, topTab.frame.midY, accuracy: 2)
        self.attachIPadScreenshot(name: "Review header top tabs after hiding sidebar with chat open")
        navigationToggle.tap()
        try self.assertVisibleIPadCompanion()
        try self.assertReviewFilterPlacementBesideChat()
        // Change the filter draft through its native popover and commit only on dismissal.
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton].exists)
        self.app.buttons["Done"].firstMatch.tap()
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.app.buttons["Done"].firstMatch.tap()
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.attachIPadScreenshot(name: "Review filter restored All cards beside sidebar and chat")
    }

    @MainActor
    func testIPadCompanionHeaderSupportsAccessibilityText() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke verifies the adaptive Review header.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        self.app.terminate()
        self.app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL", "-ai-chat-external-provider-consent", "YES"]
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForUITestLaunchPreparation(launchScenario: .guestManualReviewCard, timeout: LiveSmokeConfiguration.launchPreparationTimeoutSeconds)
        try self.rotate(to: .landscapeLeft)
        if self.visibleIPadCompanionPane == nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        for (orientation, name) in [(UIDeviceOrientation.landscapeLeft, "landscape"), (.portrait, "portrait")] {
            try self.rotate(to: orientation)
            if orientation == .portrait {
                self.attachIPadScreenshot(name: "Native Review without pairing at largest text portrait")
                XCTAssertNil(self.visibleIPadCompanionPane)
                XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].exists)
                let filter = self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu]
                if filter.isHittable == false {
                    let more = self.app.navigationBars.buttons.matching(NSPredicate(format: "label == %@", "More"))
                    XCTAssertEqual(more.count, 1, "A hidden toolbar filter must be reachable through the native More action.")
                    XCTAssertTrue(more.firstMatch.isHittable)
                    more.firstMatch.tap()
                    self.attachIPadScreenshot(name: "Native toolbar More reveals review filter at largest text portrait")
                    // Native overflow turns the toolbar label into an action without its original identifier.
                    let overflowFilter = self.app.buttons.matching(NSPredicate(format: "label == %@", "All cards"))
                    XCTAssertEqual(overflowFilter.count, 1)
                    XCTAssertTrue(overflowFilter.firstMatch.isHittable)
                    overflowFilter.firstMatch.tap()
                } else {
                    XCTAssertTrue(filter.exists && filter.isHittable)
                    filter.tap()
                }
                try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                self.attachIPadScreenshot(name: "Native portrait review filter popover at largest text")
                self.app.buttons["Done"].firstMatch.tap()
                try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                continue
            }
            try self.assertVisibleIPadCompanion()
            let title = self.app.staticTexts[LiveSmokeIdentifier.reviewCompanionTitle]
            let filter = self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu]
            if title.exists == false {
                self.attachIPadScreenshot(name: "Native compact Review and AI toolbar at largest text")
                let nativeReviewTab = self.app.buttons[LiveSmokeSelectedTab.review.itemIdentifier].firstMatch
                XCTAssertTrue(nativeReviewTab.exists && nativeReviewTab.isHittable && nativeReviewTab.isSelected, "The compact layout retains its selected native Review tab.")
                XCTAssertEqual(self.app.buttons.matching(identifier: LiveSmokeIdentifier.aiCompanionToggle).count, 1)
                if filter.isHittable == false {
                    let more = self.app.navigationBars.buttons.matching(NSPredicate(format: "label == %@", "More"))
                    XCTAssertEqual(more.count, 1, "An overflowed compact filter stays reachable through native More.")
                    XCTAssertTrue(more.firstMatch.isHittable)
                    more.firstMatch.tap()
                    self.attachIPadScreenshot(name: "Native compact More menu at largest text")
                    let overflowFilter = self.app.buttons.matching(NSPredicate(format: "label == %@", "All cards"))
                    XCTAssertEqual(overflowFilter.count, 1)
                    XCTAssertTrue(overflowFilter.firstMatch.isHittable)
                    overflowFilter.firstMatch.tap()
                } else {
                    XCTAssertTrue(filter.exists && filter.isHittable)
                    filter.tap()
                }
                try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                self.attachIPadScreenshot(name: "Native compact review filter popover at largest text")
                self.app.buttons["Done"].firstMatch.tap()
                try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                let navigationToggle = self.app.buttons.matching(NSPredicate(format: "identifier IN %@", ["ToggleSideBar", "ToggleSidebar"])).firstMatch
                XCTAssertTrue(navigationToggle.exists && navigationToggle.isHittable)
                navigationToggle.tap()
                let sidebar = self.app.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch
                XCTAssertTrue(sidebar.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) && sidebar.isHittable)
                XCTAssertTrue(title.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds), "The expanded sidebar restores the adaptive column header.")
            }
            XCTAssertTrue(title.exists && title.isHittable)
            XCTAssertEqual(self.app.buttons.matching(identifier: LiveSmokeIdentifier.reviewFilterMenu).count, 1)
            XCTAssertTrue(filter.isHittable)
            XCTAssertGreaterThan(title.frame.minY, filter.frame.maxY, "Enlarged text adapts without squeezing the title into the single-row header.")
            for identifier in [LiveSmokeIdentifier.reviewLeaderboardShortcut, LiveSmokeIdentifier.reviewProgressBadge] {
                let badge = self.app.buttons[identifier]
                XCTAssertTrue(badge.exists)
                XCTAssertGreaterThanOrEqual(badge.frame.height, 44)
                XCTAssertTrue(self.app.windows.firstMatch.frame.contains(badge.frame), "Header actions stay within the window at largest text.")
                XCTAssertGreaterThan(badge.frame.minY, title.frame.maxY)
            }
            self.attachIPadScreenshot(name: "Adaptive Review header largest text \(name)")
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.app.buttons["Done"].firstMatch.tap()
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    func testIPadCardDraftReviewAndNavigationSurviveRotation() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke exercises iPad layouts.")
        defer { XCUIDevice.shared.orientation = .portrait }

        let frontText = "Which card draft survives an iPad rotation?"
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)

        try self.step("retain an edited card draft while rotating the iPad") {
            try self.rotate(to: .landscapeLeft)
            try self.openFirstCardForEditing()
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.replaceTextSafely(
                frontText,
                inElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )

            try self.rotate(to: .portrait)
            let editor = self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor)
                .firstMatch
            XCTAssertTrue(try self.waitForElementValue(
                editor,
                identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor,
                expectedValue: frontText,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            ), "Rotating must retain the unsaved front text.")
            XCTAssertTrue(editor.isHittable, "The rotated editor must remain reachable with the keyboard visible.")
            self.attachIPadScreenshot(name: "iPad portrait card draft and keyboard")

            try self.tapFirstNavigationBackButton()
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertTextExists(frontText, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("retain the revealed answer while rotating and finish the review") {
            try self.selectIPadDestination(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertTextExists(frontText, timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.waitForReviewAnswerReveal()

            try self.rotate(to: .landscapeLeft)
            try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton].isHittable)
            self.attachIPadScreenshot(name: "iPad landscape revealed review")
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("retain a nested settings destination and reach progress after rotation") {
            try self.selectIPadDestination(selectedTab: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButtonScrollingIntoView(
                identifier: LiveSmokeIdentifier.settingsReviewAnimationsRow,
                timeout: LiveSmokeConfiguration.longUiTimeoutSeconds
            )
            try self.assertScreenVisible(screen: .reviewAnimationsSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.rotate(to: .portrait)
            try self.assertScreenVisible(screen: .reviewAnimationsSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.attachIPadScreenshot(name: "iPad portrait nested settings")
            try self.tapFirstNavigationBackButton()
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

            try self.selectIPadDestination(selectedTab: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.attachIPadScreenshot(name: "iPad portrait progress")
        }

        try self.step("open the card AI handoff and retain its entry surface across rotation") {
            try self.selectIPadDestination(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.openFirstCardForEditing()
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorEditWithAIButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertAiEntrySurfaceVisible()
            try self.rotate(to: .landscapeLeft)
            try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertAiEntrySurfaceVisible()
            self.attachIPadScreenshot(name: "iPad landscape AI entry")
            // Leave consent untouched: this layout smoke does not start a hosted AI session.
        }
    }

    @MainActor
    func testIPadLeadingChatPersistsAcrossSidebarAndSections() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke exercises the iPad leading chat.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.rotate(to: .landscapeLeft)
        if self.visibleIPadCompanionPane != nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        let opener = self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle]
        XCTAssertTrue(opener.isHittable)
        XCTAssertLessThanOrEqual(opener.frame.maxX, self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu].frame.minX, "Closed chat opens from the leading main toolbar.")
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        opener.tap()
        try self.assertVisibleIPadCompanion()
        if self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].exists {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
        try self.replaceTextSafely("draft", inElementWithIdentifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let dismissKeyboard = self.app.buttons[LiveSmokeIdentifier.aiComposerDismissKeyboardButton]
        if dismissKeyboard.exists && dismissKeyboard.isHittable { dismissKeyboard.tap() }
        let initialSidebar = self.app.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch
        if initialSidebar.exists && initialSidebar.isHittable {
            self.app.buttons.matching(NSPredicate(format: "identifier IN %@", ["ToggleSideBar", "ToggleSidebar"])).firstMatch.tap()
        }
        try self.assertVisibleIPadCompanion()
        try self.assertReviewFilterPlacementBesideChat()
        let initialHeaderY = self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu].frame.minY
        try self.assertLeadingChatDraftAndAnswer()
        self.attachIPadScreenshot(name: "iPad leading AI and pane-owned hide button")
        let sidebarToggle = self.app.buttons.matching(NSPredicate(format: "identifier IN %@", ["ToggleSideBar", "ToggleSidebar"])).firstMatch
        XCTAssertTrue(sidebarToggle.exists && sidebarToggle.isHittable)
        sidebarToggle.tap()
        let sidebar = self.app.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch
        XCTAssertTrue(sidebar.exists && sidebar.isHittable)
        let sidebarContainer = try XCTUnwrap(self.app.collectionViews.allElementsBoundByIndex.first { collection in
            collection.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch.exists
        })
        let chatPane = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.aiScreen).firstMatch
        XCTAssertTrue(chatPane.exists, "The existing chat must remain beside navigation.")
        let visibleComposer = self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]
        XCTAssertTrue(visibleComposer.isHittable)
        XCTAssertGreaterThanOrEqual(visibleComposer.frame.minX, sidebarContainer.frame.maxX, "The native sidebar must not clip chat input.")
        XCTAssertLessThanOrEqual(visibleComposer.frame.maxX, chatPane.frame.maxX, "The chat input fits inside the visible chat column.")
        XCTAssertEqual(chatPane.frame.maxX, (sidebarContainer.frame.maxX + self.app.windows.firstMatch.frame.maxX) / 2, accuracy: 8, "Chat and Review divide the available space beside the sidebar equally.")
        XCTAssertLessThan(sidebarContainer.frame.minX, self.app.windows.firstMatch.frame.minX + 80)
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.attachIPadScreenshot(name: "iPad native sidebar with equal chat and Review columns")
        sidebarToggle.tap()
        try self.assertLeadingChatDraftAndAnswer()
        try self.assertReviewFilterPlacementBesideChat()
        XCTAssertEqual(self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu].frame.minY, initialHeaderY, accuracy: 2, "Sidebar transitions preserve the draft, revealed answer and native header spacing together.")

        func assertSingleNativeHeaderRow(selectedTab: LiveSmokeSelectedTab, stage: String) {
            let selected = self.app.buttons[selectedTab.itemIdentifier].firstMatch
            func visibleButtons(identifier: String) -> [XCUIElement] {
                self.app.buttons.matching(identifier: identifier).allElementsBoundByIndex.filter { element in
                    let frame = element.frame
                    return element.exists && frame.width > 0 && frame.height > 0
                        && self.app.windows.firstMatch.frame.contains(frame) && element.isHittable
                }
            }
            let headerSettled = NSPredicate { _, _ in
                guard selected.exists && selected.isSelected,
                      selected.frame.width > 0 && selected.frame.height > 0,
                      self.app.windows.firstMatch.frame.contains(selected.frame), selected.isHittable else { return false }
                let toggles = visibleButtons(identifier: LiveSmokeIdentifier.aiCompanionToggle)
                let newButtons = visibleButtons(identifier: LiveSmokeIdentifier.aiNewChatButton)
                guard toggles.count == 1, newButtons.count == 1 else { return false }
                return abs(toggles[0].frame.midY - selected.frame.midY) <= 8
                    && abs(newButtons[0].frame.midY - selected.frame.midY) <= 8
            }
            let settled = XCTWaiter.wait(
                for: [XCTNSPredicateExpectation(predicate: headerSettled, object: nil)],
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            ) == .completed
            let toggles = visibleButtons(identifier: LiveSmokeIdentifier.aiCompanionToggle)
            let newButtons = visibleButtons(identifier: LiveSmokeIdentifier.aiNewChatButton)
            let bounds = XCTAttachment(string: "\(stage): selected=\(selected.isSelected), native tab=\(selected.frame), visible toggles=\(toggles.map(\.frame)), visible New actions=\(newButtons.map(\.frame)), single row=\(settled)")
            bounds.name = "Native top-tab single-row bounds \(stage)"
            bounds.lifetime = .keepAlways
            self.add(bounds)
            self.attachIPadScreenshot(name: "iPad \(stage) native top-tab single row with retained chat")
            XCTAssertTrue(selected.isSelected, "The actual native \(stage) tab must be selected.")
            XCTAssertEqual(toggles.count, 1, "\(stage) must expose exactly one visible AI toggle.")
            XCTAssertEqual(newButtons.count, 1, "\(stage) must expose exactly one visible New action.")
            XCTAssertTrue(settled, "\(stage) native tab, AI toggle and New action must share one vertical toolbar row.")
        }

        try self.selectIPadDestination(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
        assertSingleNativeHeaderRow(selectedTab: .cards, stage: "Cards")
        let cardsToolbarActions: [(String, () -> [XCUIElement])] = [
            ("Filter", { self.app.buttons.matching(NSPredicate(format: "label == %@", "Filter cards")).allElementsBoundByIndex }),
            ("Add", { self.app.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", LiveSmokeIdentifier.cardsAddButton, "Add card")).allElementsBoundByIndex }),
            ("Search", {
                self.app.searchFields.matching(NSPredicate(format: "label == %@ OR placeholderValue == %@", "Search cards", "Search cards")).allElementsBoundByIndex
                    + self.app.buttons.matching(NSPredicate(format: "label == %@", "Search")).allElementsBoundByIndex
            })
        ]
        func reachableCardsAction(_ candidates: () -> [XCUIElement]) -> Bool {
            candidates().contains { element in
                let frame = element.frame
                return element.exists && element.isHittable && frame.width > 0 && frame.height > 0
                    && self.app.windows.firstMatch.frame.contains(frame)
            }
        }
        // Record direct reachability before a real overflow menu can cover the toolbar.
        let actionBounds = cardsToolbarActions.map { name, candidates in
            "\(name): " + candidates().map { "frame=\($0.frame), exists=\($0.exists), hittable=\($0.isHittable)" }.joined(separator: "; ")
        }.joined(separator: "\n")
        let cardsActionsAttachment = XCTAttachment(string: actionBounds)
        cardsActionsAttachment.name = "Cards native toolbar action reachability"
        cardsActionsAttachment.lifetime = .keepAlways
        self.add(cardsActionsAttachment)
        let nativeCardsTab = self.app.buttons[LiveSmokeSelectedTab.cards.itemIdentifier].firstMatch
        for (name, candidates) in cardsToolbarActions {
            for element in candidates().filter({ $0.exists && $0.isHittable && self.app.windows.firstMatch.frame.contains($0.frame) }) {
                XCTAssertEqual(element.frame.midY, nativeCardsTab.frame.midY, accuracy: 8, "Direct Cards \(name) action must share the native tab row.")
            }
        }
        let overflowActions = cardsToolbarActions.filter { reachableCardsAction($0.1) == false }
        if overflowActions.isEmpty == false {
            let more = self.app.navigationBars.buttons.matching(NSPredicate(format: "label == %@", "More")).allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
            XCTAssertEqual(more.count, 1, "A compact Cards action must remain reachable through exactly one native More control.")
            let nativeMore = try XCTUnwrap(more.first)
            XCTAssertEqual(nativeMore.frame.midY, nativeCardsTab.frame.midY, accuracy: 8, "Native overflow must share the Cards tab row.")
            nativeMore.tap()
            self.attachIPadScreenshot(name: "iPad Cards native toolbar overflow actions")
            for (name, candidates) in overflowActions {
                let actionReachable = NSPredicate { _, _ in reachableCardsAction(candidates) }
                XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: actionReachable, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) == .completed, "Cards \(name) must be reachable in the actual native toolbar overflow when absent from the compact toolbar.")
            }
            // Reselect the actual native tab to dismiss its menu without changing a filter or creating a card.
            let cardsTab = self.app.buttons[LiveSmokeSelectedTab.cards.itemIdentifier].firstMatch
            XCTAssertTrue(cardsTab.isSelected && cardsTab.isHittable)
            cardsTab.tap()
            assertSingleNativeHeaderRow(selectedTab: .cards, stage: "Cards after overflow dismissal")
        }
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft", "Inspecting Cards toolbar actions must preserve the existing chat draft.")
        func tapCardsToolbarAction(name: String) throws {
            let action = try XCTUnwrap(cardsToolbarActions.first { $0.0 == name })
            if reachableCardsAction(action.1) == false {
                let more = self.app.navigationBars.buttons.matching(NSPredicate(format: "label == %@", "More")).allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
                XCTAssertEqual(more.count, 1)
                try XCTUnwrap(more.first).tap()
            }
            let ready = NSPredicate { _, _ in reachableCardsAction(action.1) }
            XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) == .completed)
            try XCTUnwrap(action.1().first { $0.exists && $0.isHittable }).tap()
        }

        // Cancel the actual native filter sheet without applying a different Cards filter.
        try tapCardsToolbarAction(name: "Filter")
        let filtersNavigation = self.app.navigationBars["Filters"]
        XCTAssertTrue(filtersNavigation.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        let cancelFilter = filtersNavigation.buttons["Cancel"]
        XCTAssertTrue(cancelFilter.exists && cancelFilter.isHittable)
        self.attachIPadScreenshot(name: "iPad Cards Filter modal preserves leading chat")
        cancelFilter.tap()
        XCTAssertTrue(filtersNavigation.waitForNonExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        try self.assertVisibleIPadCompanion()
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
        assertSingleNativeHeaderRow(selectedTab: .cards, stage: "Cards after Filter cancellation")

        // Reuse the existing unsaved-card flow's exact editor IDs and native back/dismiss actions.
        try tapCardsToolbarAction(name: "Add")
        try self.assertElementExists(identifier: LiveSmokeIdentifier.cardEditorScreen, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        let unsavedFront = "local"
        try self.typeTextSafely(unsavedFront, intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.tapFirstNavigationBackButton()
        let unsavedEditor = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.cardEditorScreen).firstMatch
        unsavedEditor.swipeDown()
        XCTAssertTrue(unsavedEditor.exists, "Interactive dismissal must preserve the unsaved card editor.")
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        let frontEditor = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor).firstMatch
        XCTAssertTrue(try self.waitForElementValue(frontEditor, identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, expectedValue: unsavedFront, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds))
        self.attachIPadScreenshot(name: "iPad Cards unsaved editor retains local draft")
        try self.tapFirstNavigationBackButton()
        let cancelEditor = self.app.buttons.matching(NSPredicate(format: "label == %@", "Cancel")).firstMatch
        XCTAssertTrue(cancelEditor.exists && cancelEditor.isHittable)
        cancelEditor.tap()
        XCTAssertTrue(unsavedEditor.waitForNonExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        try self.assertVisibleIPadCompanion()
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft", "Cancelling an unsaved Cards editor must retain the AI draft.")
        XCTAssertFalse(self.app.staticTexts[unsavedFront].exists, "Cancelling the local editor must not save a new card.")
        assertSingleNativeHeaderRow(selectedTab: .cards, stage: "Cards after unsaved Add cancellation")
        try tapCardsToolbarAction(name: "Search")
        let searchField = self.app.searchFields.firstMatch
        XCTAssertTrue(searchField.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        XCTAssertTrue(searchField.isHittable && self.app.windows.firstMatch.frame.contains(searchField.frame))
        try self.typeTextSafely("Smoke", intoElement: searchField, identifier: "native Cards Search", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertTrue(try self.waitForElementValue(searchField, identifier: "native Cards Search", expectedValue: "Smoke", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        let searchedCard = self.app.buttons[LiveSmokeIdentifier.cardsCardRow].firstMatch
        XCTAssertTrue(searchedCard.exists && searchedCard.isHittable)
        XCTAssertTrue(searchedCard.label.contains("Smoke guest manual review question"))
        self.attachIPadScreenshot(name: "iPad Cards actual native Search query")
        let clearSearch = searchField.buttons["Clear text"]
        XCTAssertTrue(clearSearch.exists && clearSearch.isHittable)
        clearSearch.tap()
        XCTAssertTrue(searchField.waitForNonExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds), "Clearing the native minimized query restores the compact toolbar.")
        let restoredSearch = self.app.buttons.matching(NSPredicate(format: "label == %@", "Search")).firstMatch
        XCTAssertTrue(restoredSearch.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        XCTAssertGreaterThan(restoredSearch.frame.width, 0)
        XCTAssertGreaterThan(restoredSearch.frame.height, 0)
        XCTAssertTrue(self.app.windows.firstMatch.frame.contains(restoredSearch.frame))
        XCTAssertTrue(restoredSearch.isHittable)
        XCTAssertEqual(restoredSearch.frame.midY, nativeCardsTab.frame.midY, accuracy: 8, "Restored Search must share the selected native Cards tab row.")
        XCTAssertGreaterThan(restoredSearch.frame.minX, nativeCardsTab.frame.maxX, "Restored Search remains in the native trailing toolbar.")
        try self.assertVisibleIPadCompanion()
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
        assertSingleNativeHeaderRow(selectedTab: .cards, stage: "Cards after native Search dismissal")

        // Exercise the actual sidebar layout: top-tab actions cannot prove these inner bars exist.
        sidebarToggle.tap()
        let sidebarCards = self.app.cells.matching(NSPredicate(format: "label == %@", "Cards")).firstMatch
        XCTAssertTrue(sidebarCards.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) && sidebarCards.isHittable)
        sidebarCards.tap()
        func assertSidebarCompanionHeader(stage: String) throws {
            let headerReady = NSPredicate { _, _ in
                let toggle = self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].firstMatch
                let newChat = self.app.buttons[LiveSmokeIdentifier.aiNewChatButton].firstMatch
                let window = self.app.windows.firstMatch.frame
                guard sidebarCards.exists && sidebarCards.isHittable,
                      toggle.exists && newChat.exists,
                      toggle.frame.width > 0 && newChat.frame.width > 0,
                      window.contains(toggle.frame) && window.contains(newChat.frame),
                      toggle.isHittable && newChat.isHittable else { return false }
                return abs(toggle.frame.midY - newChat.frame.midY) <= 8
                    && abs(toggle.frame.midY - sidebarToggle.frame.midY) <= 8
            }
            XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: headerReady, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) == .completed)
            XCTAssertTrue(sidebarCards.exists && sidebarCards.isHittable, "Native sidebar must remain visible during \(stage).")
            let visibleToggles = self.app.buttons.matching(identifier: LiveSmokeIdentifier.aiCompanionToggle).allElementsBoundByIndex.filter {
                $0.exists && $0.frame.width > 0 && $0.frame.height > 0 && self.app.windows.firstMatch.frame.contains($0.frame) && $0.isHittable
            }
            XCTAssertEqual(visibleToggles.count, 1, "Sidebar \(stage) has one reachable chat toggle.")
            let toggle = try XCTUnwrap(visibleToggles.first)
            let newChat = self.app.buttons[LiveSmokeIdentifier.aiNewChatButton].firstMatch
            XCTAssertTrue(newChat.exists && self.app.windows.firstMatch.frame.contains(newChat.frame) && newChat.isHittable)
            let sharedBar = try XCTUnwrap(self.app.navigationBars.allElementsBoundByIndex.first {
                $0.frame.width > 0 && $0.frame.height > 0
                    && self.app.windows.firstMatch.frame.contains($0.frame)
                    && $0.frame.contains(toggle.frame) && $0.frame.contains(newChat.frame)
            }, "Sidebar chat actions belong to one visible native bar.")
            XCTAssertGreaterThanOrEqual(toggle.frame.minX, sidebarContainer.frame.maxX, "The shared native row keeps chat controls clear of the sidebar.")
            XCTAssertEqual(newChat.frame.height, toggle.frame.height, accuracy: 2)
            XCTAssertTrue(sharedBar.isHittable)
            XCTAssertEqual(newChat.frame.midY, toggle.frame.midY, accuracy: 8)
            XCTAssertEqual(toggle.frame.midY, sidebarToggle.frame.midY, accuracy: 8, "Sidebar and paired native controls share the header baseline.")
            XCTAssertLessThan(toggle.frame.maxX, newChat.frame.minX)
            XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
            try self.assertVisibleIPadCompanion()
        }
        func assertSidebarCardsActions(stage: String) throws {
            try assertSidebarCompanionHeader(stage: stage)
            XCTAssertFalse(self.app.navigationBars.staticTexts["Cards"].firstMatch.exists, "The selected sidebar already names Cards; the paired native row must not clip a duplicate title.")
            let newChat = self.app.buttons[LiveSmokeIdentifier.aiNewChatButton].firstMatch
            for (name, candidates) in cardsToolbarActions {
                let action = try XCTUnwrap(candidates().first { $0.exists && $0.frame.width > 0 && $0.frame.height > 0 && self.app.windows.firstMatch.frame.contains($0.frame) && $0.isHittable }, "Sidebar Cards \(name) must remain reachable.")
                XCTAssertGreaterThan(action.frame.minX, newChat.frame.maxX, "Cards \(name) stays in the content column, clear of chat.")
                XCTAssertEqual(action.frame.midY, newChat.frame.midY, accuracy: 8, "Sidebar Cards \(name) must share the native header row.")
            }
            self.attachIPadScreenshot(name: "iPad actual sidebar Cards native actions \(stage)")
        }
        try assertSidebarCardsActions(stage: "initial")
        try tapCardsToolbarAction(name: "Filter")
        XCTAssertTrue(filtersNavigation.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        cancelFilter.tap()
        XCTAssertTrue(filtersNavigation.waitForNonExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        try assertSidebarCardsActions(stage: "after Filter cancellation")
        try tapCardsToolbarAction(name: "Add")
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.typeTextSafely("side", intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapFirstNavigationBackButton()
        XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.cardEditorFrontRow].label.contains("side"), "Sidebar Add must retain the entered draft.")
        self.app.buttons.matching(NSPredicate(format: "label == %@", "Cancel")).firstMatch.tap()
        XCTAssertTrue(unsavedEditor.waitForNonExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        try assertSidebarCardsActions(stage: "after unsaved Add cancellation")
        try tapCardsToolbarAction(name: "Search")
        let sidebarSearch = self.app.searchFields.firstMatch
        XCTAssertTrue(sidebarSearch.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) && sidebarSearch.isHittable)
        let sidebarEmptySearchValue = self.elementValue(element: sidebarSearch)
        try self.typeTextSafely("Smoke", intoElement: sidebarSearch, identifier: "sidebar native Cards Search", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertTrue(try self.waitForElementValue(sidebarSearch, identifier: "sidebar native Cards Search", expectedValue: "Smoke", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        XCTAssertTrue(searchedCard.exists && searchedCard.isHittable && searchedCard.label.contains("Smoke guest manual review question"))
        self.attachIPadScreenshot(name: "iPad actual sidebar Cards Search query")
        sidebarSearch.buttons["Clear text"].tap()
        if sidebarSearch.exists == false {
            try tapCardsToolbarAction(name: "Search")
            XCTAssertTrue(sidebarSearch.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        }
        XCTAssertTrue(try self.waitForElementValue(sidebarSearch, identifier: "cleared sidebar native Cards Search", expectedValue: sidebarEmptySearchValue, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        // Native regular-width Search can stay expanded; dismiss through actual navigation.
        self.app.cells.matching(NSPredicate(format: "label == %@", "Progress")).firstMatch.tap()
        try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try assertSidebarCompanionHeader(stage: "Progress")
        XCTAssertFalse(self.app.navigationBars.staticTexts["Progress"].firstMatch.exists, "The selected sidebar already names Progress; the paired native row has no duplicate title.")
        self.attachIPadScreenshot(name: "iPad actual sidebar Progress native header")
        sidebarCards.tap()
        try assertSidebarCardsActions(stage: "after Progress return")
        sidebarToggle.tap()
        assertSingleNativeHeaderRow(selectedTab: .cards, stage: "Cards after sidebar collapse")
        sidebarToggle.tap()
        try assertSidebarCardsActions(stage: "after sidebar reopening")
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let sidebarChatClosed = NSPredicate { _, _ in self.visibleIPadCompanionPane == nil }
        XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: sidebarChatClosed, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) == .completed)
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try assertSidebarCardsActions(stage: "after chat hide and reopen")
        sidebarToggle.tap()
        try self.selectIPadDestination(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: "review.leaderboardShortcut", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
        assertSingleNativeHeaderRow(selectedTab: .progress, stage: "Progress")
        self.attachIPadScreenshot(name: "iPad Progress leaderboard route with retained chat")
        // Guest fixtures expose the leaderboard route, without live account/profile requests.
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let progressOpener = self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle]
        var lastOpenerFrame: CGRect?
        var openerStableSince = Date()
        let progressClosed = NSPredicate { _, _ in
            guard self.visibleIPadCompanionPane == nil, progressOpener.exists else {
                lastOpenerFrame = nil
                return false
            }
            let frame = progressOpener.frame
            guard frame.width > 0, frame.height > 0, self.app.windows.firstMatch.frame.contains(frame) else {
                lastOpenerFrame = nil
                return false
            }
            if lastOpenerFrame != frame {
                lastOpenerFrame = frame
                openerStableSince = Date()
                return false
            }
            return Date().timeIntervalSince(openerStableSince) >= 0.4 && progressOpener.isHittable
        }
        XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: progressClosed, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) == .completed, "Progress must finish closing chat and expose a stable, reachable leading opener.")
        XCTAssertTrue(progressOpener.isHittable, "Progress must expose its leading opener when closed.")
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()

        try self.selectIPadDestination(selectedTab: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertAiEntrySurfaceVisible()
        XCTAssertTrue(self.app.buttons[LiveSmokeSelectedTab.ai.itemIdentifier].firstMatch.isSelected, "The native AI tab must actually be selected.")
        let fullAI = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.aiScreen).firstMatch
        let scene = self.app.windows.firstMatch.frame
        XCTAssertEqual(self.app.navigationBars["AI"].frame.width, scene.width, accuracy: 1, "Full AI's native host must reclaim the complete scene.")
        XCTAssertEqual(fullAI.frame.midX, scene.midX, accuracy: 1, "The bounded AI reading column must be centered, not retain a side slot.")
        XCTAssertGreaterThan(fullAI.frame.width, 400)
        self.attachIPadScreenshot(name: "iPad full AI selected without companion")
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft", "Full AI uses the same conversation draft.")
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].exists, "Full AI must not have a duplicate companion action.")
        try self.selectIPadDestination(selectedTab: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertNil(self.visibleIPadCompanionPane)
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].exists)
        try self.selectIPadDestination(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertLeadingChatDraftAndAnswer()
        self.attachIPadScreenshot(name: "iPad Review restored after Cards Progress AI and Settings")
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].isHittable)
    }

    @MainActor
    private func assertLeadingChatDraftAndAnswer() throws {
        try self.assertVisibleIPadCompanion()
        let pane = try XCTUnwrap(self.visibleIPadCompanionPane)
        let composer = self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]
        XCTAssertEqual(self.elementValue(element: composer), "draft")
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists)
        let answer = self.app.staticTexts["Smoke guest manual review answer"].firstMatch
        XCTAssertGreaterThanOrEqual(answer.frame.minX, pane.frame.maxX, "Chat must remain on the leading side and reserve actual answer space.")
        for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
            try self.assertPrimaryElementClearOfCompanion(self.app.buttons[identifier])
        }
    }

    @MainActor
    func testIPadNewChatPreservesRevealedReview() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke verifies New Chat beside a revealed iPad review.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.rotate(to: .landscapeLeft)
        if self.visibleIPadCompanionPane != nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()
        if self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].exists {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
        // Enabled native input establishes bootstrapPhase.ready before typing.
        let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.focusElementForTextInput(composer, identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        composer.typeText("new chat draft")
        XCTAssertEqual(composer.value as? String, "new chat draft")
        try self.tapButton(identifier: LiveSmokeIdentifier.aiComposerDismissKeyboardButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let newChat = self.app.buttons[LiveSmokeIdentifier.aiNewChatButton].firstMatch
        XCTAssertTrue(newChat.exists && newChat.isHittable && newChat.isEnabled, "The actual native New Chat control must be enabled by the local draft.")
        self.attachIPadScreenshot(name: "iPad revealed Review before native New Chat")
        newChat.tap()
        // clearHistory starts a ready local session synchronously. Require its
        // enabled input and disabled New action, rather than a loading placeholder.
        let cleared = NSPredicate { _, _ in
            let value = composer.value as? String ?? ""
            return composer.exists && composer.isEnabled && composer.isHittable
                && (value.isEmpty || value == composer.placeholderValue)
                && newChat.exists && !newChat.isEnabled
        }
        XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: cleared, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) == .completed, "Native New Chat must clear the local draft and leave a ready composer without submitting.")
        try self.assertTextExists("Smoke guest manual review question", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertPrimaryElementClearOfCompanion(self.app.staticTexts["Smoke guest manual review question"].firstMatch)
        try self.assertPrimaryElementClearOfCompanion(self.app.staticTexts["Smoke guest manual review answer"].firstMatch)
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "New Chat must preserve the revealed Review state.")
        self.attachIPadScreenshot(name: "iPad native New Chat preserves Review question and answer")
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists("Smoke guest manual review question", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists)
        try self.assertAllReviewRatingsReachable()
        self.attachIPadScreenshot(name: "iPad revealed Review and ratings after closing new chat")
    }

    @MainActor
    func testIPadSidebarChatAndReviewSurvivePortraitRotation() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke verifies iPad pairing eligibility and state retention.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.rotate(to: .landscapeLeft)
        if self.visibleIPadCompanionPane != nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()
        if self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].exists {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
        let composer = self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]
        try self.focusElementForTextInput(composer, identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        composer.typeText("draft")
        XCTAssertEqual(composer.value as? String, "draft")
        let done = self.app.buttons["ai.composerDismissKeyboardButton"]
        if done.exists && done.isHittable { done.tap() }
        try self.rotate(to: .portrait)
        XCTAssertNil(self.visibleIPadCompanionPane)
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].exists, "Portrait has no pairing action or inspector.")
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertAllReviewRatingsReachable()
        self.attachIPadScreenshot(name: "iPad portrait standalone Review retains answer")
        try self.selectIPadDestination(selectedTab: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertAiEntrySurfaceVisible()
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].exists)
        try self.selectIPadDestination(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.rotate(to: .landscapeLeft)
        try self.assertVisibleIPadCompanion()
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertAllReviewRatingsReachable()
        try self.assertReviewFilterPlacementBesideChat()
        self.attachIPadScreenshot(name: "iPad landscape companion restores draft and answer")
        try self.rotate(to: .portrait)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewAiButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertAiEntrySurfaceVisible()
        XCTAssertTrue(self.app.buttons[LiveSmokeSelectedTab.ai.itemIdentifier].firstMatch.isSelected, "An explicit portrait AI handoff opens the full AI tab.")
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].exists)
        self.attachIPadScreenshot(name: "iPad portrait card handoff opens full AI")
    }

    @MainActor
    func testIPadFloatingKeyboardKeepsReviewAndComposerAtBottom() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke exercises iPad keyboards.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.rotate(to: .landscapeLeft)
        // Preserve any restored visible companion while normalizing navigation.
        // Reproduce the reported collapsed-sidebar layout with native top tabs.
        let sidebar = self.app.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch
        let navigationToggle = self.app.buttons.matching(NSPredicate(format: "identifier IN %@", ["ToggleSideBar", "ToggleSidebar"])).firstMatch
        if sidebar.exists && sidebar.isHittable {
            XCTAssertTrue(navigationToggle.isHittable)
            navigationToggle.tap()
        }
        if self.visibleIPadCompanionPane == nil {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        try self.assertAiEntrySurfaceVisible()
        let consent = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if consent.exists {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
        let composer = self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]
        let reveal = self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton]
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        let keyboard = self.app.keyboards.firstMatch
        var stableElements: [(String, XCUIElement)] = [
            ("Review filter", self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu]),
            ("Review question", self.app.staticTexts["Smoke guest manual review question"].firstMatch),
            ("score", self.app.buttons[LiveSmokeIdentifier.reviewLeaderboardShortcut]),
            ("streak", self.app.buttons[LiveSmokeIdentifier.reviewProgressBadge]),
            ("chat toggle", self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle]),
            ("new chat", self.app.buttons[LiveSmokeIdentifier.aiNewChatButton]),
            ("native Review tab", self.app.buttons[LiveSmokeSelectedTab.review.itemIdentifier].firstMatch),
            ("sidebar toggle", navigationToggle),
            ("Review reveal", reveal),
            ("chat composer", composer)
        ]
        let columnTitle = self.app.staticTexts[LiveSmokeIdentifier.reviewCompanionTitle]
        if columnTitle.exists { stableElements.append(("Review column title", columnTitle)) }
        for (name, element) in stableElements {
            XCTAssertTrue(element.exists, "The resting layout must expose \(name).")
        }
        self.attachIPadScreenshot(name: "iPad native top tabs before floating keyboard")
        try self.assertReviewFilterPlacementBesideChat()
        let restingFrames = stableElements.map { $0.1.frame }
        func assertRestingLayout(position: String) {
            let layoutSettled = NSPredicate { _, _ in
                stableElements.enumerated().allSatisfy { index, item in
                    let frame = item.1.frame
                    let resting = restingFrames[index]
                    return abs(frame.minX - resting.minX) <= 8
                        && abs(frame.minY - resting.minY) <= 8
                        && abs(frame.width - resting.width) <= 8
                        && abs(frame.height - resting.height) <= 8
                }
            }
            let settled = XCTWaiter.wait(
                for: [XCTNSPredicateExpectation(predicate: layoutSettled, object: nil)],
                timeout: 10
            ) == .completed
            let actualFrames = stableElements.map { $0.1.frame }
            if !settled {
                var details = "Floating keyboard at \(position): \(keyboard.frame); all components settled within 8pt: \(settled)\n"
                for (index, item) in stableElements.enumerated() {
                    details += "\(item.0): resting=\(restingFrames[index]), actual=\(actualFrames[index])\n"
                }
                // Preserve bounds before stop-on-failure loses the evidence.
                let attachment = XCTAttachment(string: details)
                attachment.name = "Floating keyboard layout bounds \(position)"
                attachment.lifetime = .keepAlways
                self.add(attachment)
            }
            self.attachIPadScreenshot(name: "iPad floating keyboard \(position)")
            XCTAssertTrue(settled, "All components must settle within their original 8pt bounds after floating-keyboard movement to \(position).")
            for (index, item) in stableElements.enumerated() {
                let name = item.0
                let actual = actualFrames[index]
                let resting = restingFrames[index]
                XCTAssertEqual(actual.minX, resting.minX, accuracy: 8, "\(name) must not move horizontally with a floating keyboard at \(position).")
                XCTAssertEqual(actual.minY, resting.minY, accuracy: 8, "\(name) must not move vertically with a floating keyboard at \(position).")
                XCTAssertEqual(actual.width, resting.width, accuracy: 8, "\(name) must not resize with a floating keyboard at \(position).")
                XCTAssertEqual(actual.height, resting.height, accuracy: 8, "\(name) must not resize with a floating keyboard at \(position).")
            }
        }
        let restingReviewBottom = reveal.frame.maxY
        let restingComposerBottom = composer.frame.maxY
        composer.tap()
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
        let letterKey = keyboard.keys.matching(NSPredicate(format: "label IN %@", ["q", "Q"])).firstMatch
        let softwareKeyboardVisible = NSPredicate { _, _ in
            keyboard.exists && keyboard.frame.height > 100
                && letterKey.exists && letterKey.isHittable
        }
        var visibleKeyboard = XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: softwareKeyboardVisible, object: nil)],
            timeout: 10
        ) == .completed
        if visibleKeyboard == false {
            let missingAttachment = XCTAttachment(string: "Before one native focus recovery: window=\(self.app.windows.firstMatch.frame), keyboard=\(keyboard.frame), qExists=\(letterKey.exists), qFrame=\(letterKey.frame), qHittable=\(letterKey.isHittable), composer=\(composer.frame), reveal=\(reveal.frame)")
            missingAttachment.name = "Software keyboard missing before one native focus recovery"
            missingAttachment.lifetime = .keepAlways
            self.add(missingAttachment)
            self.attachIPadScreenshot(name: "iPad software keyboard missing before native Done recovery")
            let done = self.app.buttons[LiveSmokeIdentifier.aiComposerDismissKeyboardButton]
            XCTAssertTrue(done.exists && done.isHittable, "One normal native focus recovery requires the visible Done control.")
            done.tap()
            composer.tap()
            visibleKeyboard = XCTWaiter.wait(
                for: [XCTNSPredicateExpectation(predicate: softwareKeyboardVisible, object: nil)],
                timeout: 10
            ) == .completed
        }
        if !visibleKeyboard {
            let visibilityAttachment = XCTAttachment(string: "Actual software keyboard visible=\(visibleKeyboard), keyboard=\(keyboard.frame), qKeyExists=\(letterKey.exists), composer=\(composer.frame), reveal=\(reveal.frame)")
            visibilityAttachment.name = "Native software keyboard visibility before mode classification"
            visibilityAttachment.lifetime = .keepAlways
            self.add(visibilityAttachment)
            self.attachIPadScreenshot(name: "iPad actual software keyboard before mode classification")
        }
        XCTAssertTrue(visibleKeyboard, "Require a real visible software keyboard with a reachable letter key; an accessibility placeholder cannot establish docked avoidance.")
        let emptyValue = composer.value as? String ?? ""
        XCTAssertTrue(emptyValue.isEmpty || emptyValue == composer.placeholderValue, "The native key proof requires an empty local composer.")
        let inputWindow = self.app.windows.firstMatch.frame
        let deleteCandidates = keyboard.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", ["delete", "Delete", "backspace", "Backspace"])).allElementsBoundByIndex
        func nativeDeleteReachable(_ candidate: XCUIElement) -> Bool {
            guard candidate.exists && candidate.isHittable else { return false }
            let frame = candidate.frame
            guard frame.width > 0, frame.height > 0,
                  inputWindow.contains(CGPoint(x: frame.midX, y: frame.midY)) else { return false }
            let visible = frame.intersection(inputWindow)
            // Native keyboard accessibility frames can extend slightly beyond the window.
            return !visible.isNull && visible.width * visible.height >= frame.width * frame.height * 0.95
        }
        guard let deleteKey = deleteCandidates.first(where: nativeDeleteReachable) else {
            let candidates = deleteCandidates.map { "label=\($0.label), identifier=\($0.identifier), frame=\($0.frame), hittable=\($0.isHittable)" }.joined(separator: "\n")
            let attachment = XCTAttachment(string: "window=\(inputWindow)\nDelete candidates:\n\(candidates)\n\(keyboard.debugDescription)")
            attachment.name = "No reachable native Delete for floating proof"
            attachment.lifetime = .keepAlways
            self.add(attachment)
            XCTFail("The actual native Delete key must be reachable inside the window to restore the empty composer.")
            return
        }
        XCTAssertTrue(letterKey.frame.width > 0 && letterKey.frame.height > 0 && inputWindow.contains(letterKey.frame))
        XCTAssertTrue(nativeDeleteReachable(deleteKey), "The actual native Delete key must have a reachable center and at least 95% of its area inside the window to restore the empty composer.")
        letterKey.tap()
        let qEntered = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (composer.value as? String ?? "").lowercased() == "q"
        }, object: nil)], timeout: 5) == .completed
        if !qEntered {
            let inputAttachment = XCTAttachment(string: "Native Q proof: window=\(inputWindow), keyboard=\(keyboard.frame), Q=\(letterKey.frame), Delete=\(deleteKey.frame), value=\(String(reflecting: composer.value as? String ?? "")), qEntered=\(qEntered)")
            inputAttachment.name = "Native floating keyboard Q input proof"
            inputAttachment.lifetime = .keepAlways
            self.add(inputAttachment)
            self.attachIPadScreenshot(name: "iPad actual software Q entered locally")
        }
        deleteKey.tap()
        let emptyRestored = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (composer.value as? String ?? "") == emptyValue
        }, object: nil)], timeout: 5) == .completed
        if !emptyRestored {
            let restoredAttachment = XCTAttachment(string: "Native Delete restoration: keyboard=\(keyboard.frame), composer=\(composer.frame), value=\(String(reflecting: composer.value as? String ?? "")), emptyRestored=\(emptyRestored)")
            restoredAttachment.name = "Native floating keyboard Delete restoration"
            restoredAttachment.lifetime = .keepAlways
            self.add(restoredAttachment)
            self.attachIPadScreenshot(name: "iPad native Delete restores empty composer")
        }
        XCTAssertTrue(qEntered, "Tapping the actual native Q key must enter Q locally without sending.")
        XCTAssertTrue(emptyRestored, "The native Delete key must restore the empty local composer.")
        // Keyboard mode survives app relaunch. Verify whichever native mode
        // starts first, using the native Hide Keyboard menu to select Floating.
        if keyboard.frame.width >= self.app.frame.width * 0.65 {
            XCTAssertLessThan(composer.frame.maxY, restingComposerBottom - 100, "Docked input must retain normal keyboard avoidance.")
            self.attachIPadScreenshot(name: "iPad companion docked keyboard")
            let hideKeyboard = keyboard.buttons["Hide keyboard"].firstMatch
            XCTAssertTrue(hideKeyboard.exists && hideKeyboard.isHittable)
            if hideKeyboard.exists && hideKeyboard.isHittable {
                // Hold Hide Keyboard and slide to Floating before releasing.
                hideKeyboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                    .press(forDuration: 1, thenDragTo: hideKeyboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: -0.5)))
            }
        }
        let floating = NSPredicate { _, _ in
            keyboard.exists && keyboard.frame.width < self.app.frame.width * 0.65
        }
        XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: floating, object: nil)], timeout: 10) == .completed, "The native keyboard must actually become floating.")
        let bottomAnchored = NSPredicate { _, _ in
            abs(reveal.frame.maxY - restingReviewBottom) < 8
                && abs(composer.frame.maxY - restingComposerBottom) < 8
        }
        XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: bottomAnchored, object: nil)], timeout: 10) == .completed, "Floating input must leave Review and composer at their original bottom positions.")
        assertRestingLayout(position: "initial")
        // The native keyboard AX frame encloses the key grid, excluding the
        // bottom three-dot grabber. The native screenshot places that grabber
        // just below the frame, at 1.14 of the grid height. Move it to a low
        // baseline first so an upward drag is real even when the previous
        // session left the keyboard near the top of the screen.
        let window = self.app.windows.firstMatch
        func dragFloatingKeyboard(minX: CGFloat, minY: CGFloat, name: String) {
            let before = keyboard.frame
            let destination = window.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: minX - window.frame.minX + before.width * 0.5,
                         dy: minY - window.frame.minY + before.height * 1.14)
            )
            keyboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1.14))
                .press(forDuration: 0.1, thenDragTo: destination)
            XCTAssertTrue(keyboard.exists && keyboard.frame.width < window.frame.width * 0.65, "\(name) must leave the native keyboard floating.")
            XCTAssertEqual(keyboard.frame.minX, minX, accuracy: 32, "The native keyboard must reach the requested side for \(name).")
            XCTAssertGreaterThan(hypot(keyboard.frame.minX - before.minX, keyboard.frame.minY - before.minY), 80, "The native keyboard must actually move for \(name), not merely receive a gesture.")
        }
        let lowerY = window.frame.maxY - keyboard.frame.height - 150
        let lowerX = keyboard.frame.midX < window.frame.midX
            ? window.frame.maxX - keyboard.frame.width - 20
            : window.frame.minX + 20
        dragFloatingKeyboard(minX: lowerX, minY: lowerY, name: "lower opposite side")
        assertRestingLayout(position: "lower opposite side")
        let upperY = window.frame.minY + 80
        dragFloatingKeyboard(minX: window.frame.maxX - keyboard.frame.width - 20, minY: upperY, name: "upper right")
        XCTAssertLessThan(keyboard.frame.minY, window.frame.minY + 180, "The floating keyboard must reach the upper edge to reproduce the reported avoidance.")
        assertRestingLayout(position: "upper right")
        dragFloatingKeyboard(minX: window.frame.minX + 20, minY: upperY, name: "upper left")
        XCTAssertLessThan(keyboard.frame.minY, window.frame.minY + 180)
        assertRestingLayout(position: "upper left")
        // Keep the chat action unobscured before verifying dismissal.
        dragFloatingKeyboard(minX: window.frame.midX - keyboard.frame.width * 0.5, minY: lowerY, name: "restored lower center")
        assertRestingLayout(position: "restored lower center")
        // Use Apple's native More > Full action; a synthesized pinch can leave
        // the simulator keyboard floating without changing its actual mode.
        keyboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1.14)).tap()
        let fullKeyboard = self.app.buttons["Full"].firstMatch
        self.attachIPadScreenshot(name: "iPad native keyboard More menu")
        XCTAssertTrue(fullKeyboard.waitForExistence(timeout: 5) && fullKeyboard.isHittable, "The native keyboard menu must expose its Full action.")
        fullKeyboard.tap()
        let dockRecovered = NSPredicate { _, _ in
            keyboard.exists && keyboard.frame.width >= window.frame.width * 0.65
                && composer.frame.maxY < restingComposerBottom - 100
                && reveal.frame.maxY < restingReviewBottom - 100
                && composer.frame.maxY <= keyboard.frame.minY
                && reveal.frame.maxY <= keyboard.frame.minY
        }
        let recovered = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: dockRecovered, object: nil)], timeout: 10) == .completed
        let dockAttachment = XCTAttachment(string: "Docked keyboard=\(keyboard.frame), composer=\(composer.frame), reveal=\(reveal.frame), normal avoidance recovered=\(recovered)")
        dockAttachment.name = "Recovered full-width keyboard avoidance bounds"
        dockAttachment.lifetime = .keepAlways
        self.add(dockAttachment)
        self.attachIPadScreenshot(name: "iPad recovered full-width keyboard normal avoidance")
        XCTAssertTrue(recovered, "Returning to the actual full-width keyboard must restore normal docked avoidance for Review and composer.")
        let done = self.app.buttons[LiveSmokeIdentifier.aiComposerDismissKeyboardButton]
        if done.exists && done.isHittable { done.tap() }
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertTrue(reveal.isHittable)
    }

    @MainActor
    func testIPadStandaloneAIKeepsFloatingKeyboardIndependent() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke verifies the standalone iPad AI keyboard boundary.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .ai)
        try self.rotate(to: .landscapeLeft)
        let navigationToggle = self.app.buttons.matching(NSPredicate(format: "identifier IN %@", ["ToggleSideBar", "ToggleSidebar"])).firstMatch
        let sidebarAI = self.app.cells.matching(NSPredicate(format: "label == %@", "AI")).firstMatch
        if sidebarAI.exists && sidebarAI.isHittable { navigationToggle.tap() }
        try self.assertAiEntrySurfaceVisible()
        if self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].exists {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
        let composer = self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]
        let keyboard = self.app.keyboards.firstMatch
        let window = self.app.windows.firstMatch
        XCTAssertTrue(self.app.buttons[LiveSmokeSelectedTab.ai.itemIdentifier].firstMatch.isSelected, "The native full AI tab must be selected.")
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].exists, "Standalone AI cannot retain a companion control.")
        let elements: [(String, XCUIElement)] = [
            ("composer", composer), ("new chat", self.app.buttons[LiveSmokeIdentifier.aiNewChatButton]),
            ("native AI tab", self.app.buttons[LiveSmokeSelectedTab.ai.itemIdentifier].firstMatch), ("sidebar toggle", navigationToggle)
        ]
        for (name, element) in elements { XCTAssertTrue(element.exists, "Standalone AI must expose \(name).") }
        let resting = elements.map { $0.1.frame }
        func waitFor(_ condition: @escaping () -> Bool) -> Bool {
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)], timeout: 10) == .completed
        }
        func record(_ stage: String) {
            let details = elements.enumerated().map { "\($0.element.0): resting=\(resting[$0.offset]), actual=\($0.element.1.frame)" }.joined(separator: "\n")
            let keyboardDescription = keyboard.exists ? String(describing: keyboard.frame) : "absent"
            let attachment = XCTAttachment(string: "window=\(window.frame), keyboard=\(keyboardDescription)\n\(details)")
            attachment.name = "Standalone AI keyboard bounds \(stage)"; attachment.lifetime = .keepAlways
            self.add(attachment)
            self.attachIPadScreenshot(name: "iPad standalone AI \(stage)")
        }
        record("resting")
        composer.tap()
        let q = keyboard.keys.matching(NSPredicate(format: "label IN %@", ["q", "Q"])).firstMatch
        let visible = waitFor { keyboard.exists && keyboard.frame.height > 100 && q.exists && q.isHittable }
        record("actual software keyboard")
        XCTAssertTrue(visible, "Require an actual reachable software keyboard before classifying its mode.")
        guard visible else { return }
        if keyboard.frame.width >= window.frame.width * 0.65 {
            XCTAssertLessThanOrEqual(composer.frame.maxY, keyboard.frame.minY, "Standalone AI must avoid a docked keyboard.")
            let hideKeyboard = keyboard.buttons["Hide keyboard"].firstMatch
            XCTAssertTrue(hideKeyboard.exists && hideKeyboard.isHittable)
            if hideKeyboard.exists && hideKeyboard.isHittable {
                // Hold Hide Keyboard and slide to Floating before releasing.
                hideKeyboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                    .press(forDuration: 1, thenDragTo: hideKeyboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: -0.5)))
            }
        }
        let floating = waitFor { keyboard.exists && keyboard.frame.height > 100 && keyboard.frame.width < window.frame.width * 0.65 }
        record("floating mode")
        XCTAssertTrue(floating, "The native keyboard must actually become floating.")
        guard floating else { return }
        let lowerX = keyboard.frame.midX < window.frame.midX ? window.frame.maxX - keyboard.frame.width - 20 : window.frame.minX + 20
        let positions: [(String, CGFloat, CGFloat)] = [
            ("lower opposite side", lowerX, window.frame.maxY - keyboard.frame.height - 150),
            ("upper right", window.frame.maxX - keyboard.frame.width - 20, window.frame.minY + 80),
            ("upper left", window.frame.minX + 20, window.frame.minY + 80)
        ]
        for (name, x, y) in positions {
            let before = keyboard.frame
            let target = window.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x - window.frame.minX + before.width * 0.5, dy: y - window.frame.minY + before.height * 1.14))
            keyboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1.14)).press(forDuration: 0.1, thenDragTo: target)
            let settled = waitFor {
                elements.enumerated().allSatisfy { index, item in
                    let frame = item.1.frame, baseline = resting[index]
                    return abs(frame.minX - baseline.minX) <= 8 && abs(frame.minY - baseline.minY) <= 8
                        && abs(frame.width - baseline.width) <= 8 && abs(frame.height - baseline.height) <= 8
                }
            }
            record(name)
            XCTAssertTrue(keyboard.frame.width < window.frame.width * 0.65 && keyboard.frame.height > 100)
            XCTAssertEqual(keyboard.frame.minX, x, accuracy: 32, "The native keyboard must reach \(name).")
            XCTAssertGreaterThan(hypot(keyboard.frame.minX - before.minX, keyboard.frame.minY - before.minY), 80, "The native keyboard must really move.")
            if name.hasPrefix("upper") { XCTAssertLessThan(keyboard.frame.minY, window.frame.minY + 180) }
            XCTAssertTrue(settled, "Standalone AI controls must remain within their original 8pt bounds at \(name).")
        }
        keyboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1.14)).tap()
        let full = self.app.buttons["Full"].firstMatch
        record("native Full menu")
        XCTAssertTrue(full.waitForExistence(timeout: 5) && full.isHittable)
        full.tap()
        let docked = waitFor { keyboard.exists && keyboard.frame.width >= window.frame.width * 0.65 && composer.frame.maxY <= keyboard.frame.minY && composer.frame.maxY < resting[0].maxY - 100 }
        record("recovered docked avoidance")
        XCTAssertTrue(docked, "Returning to a real full-width keyboard must restore normal standalone AI avoidance.")
        try self.tapButton(identifier: LiveSmokeIdentifier.aiComposerDismissKeyboardButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    func testIPadAccessibilityTextKeepsNavigationAndEditorReachable() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke exercises iPad layouts.")
        defer { XCUIDevice.shared.orientation = .portrait }

        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)
        self.app.terminate()
        self.app.launchArguments += [
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL"
        ]
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForUITestLaunchPreparation(
            launchScenario: .guestManualReviewCard,
            timeout: LiveSmokeConfiguration.launchPreparationTimeoutSeconds
        )
        try self.rotate(to: .portrait)

        try self.step("reach the card editor with the largest accessibility text") {
            try self.openFirstCardForEditing()
            try self.tapButtonScrollingIntoView(
                identifier: LiveSmokeIdentifier.cardEditorFrontRow,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementExists(identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.attachIPadScreenshot(name: "iPad portrait accessibility card editor")
            try self.tapFirstNavigationBackButton()
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("reach review actions and nested settings with accessibility text") {
            try self.selectIPadDestination(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds)
            XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].isHittable)
            self.attachIPadScreenshot(name: "iPad portrait accessibility review")

            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            try self.rotate(to: .landscapeLeft)
            try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.scrollAccessibilityReviewElementIntoView(
                self.app.staticTexts["Smoke guest manual review answer"].firstMatch,
                identifier: "revealed answer"
            )
            self.attachIPadScreenshot(name: "iPad landscape largest text readable answer")
            for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
                try self.scrollAccessibilityReviewElementIntoView(self.app.buttons[identifier], identifier: identifier)
            }
            self.attachIPadScreenshot(name: "iPad landscape largest text inline review ratings")
            try self.rotate(to: .portrait)

            try self.selectIPadDestination(selectedTab: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.settingsReviewAnimationsRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .reviewAnimationsSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.attachIPadScreenshot(name: "iPad portrait accessibility settings")
        }
    }

    @MainActor
    func testIPadUnsavedCardDraftSurvivesWindowResize() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke exercises iPad window resizing.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)
        try self.rotate(to: .portrait)
        defer {
            do {
                try self.restoreIPadWindowToFullScreen()
            } catch {
                XCTFail("Could not restore the iPad window after resize smoke: \(error.localizedDescription)")
            }
        }
        try self.restoreIPadWindowToFullScreen()
        let originalFrame = self.app.windows.firstMatch.frame

        try self.step("retain an unsaved card draft in a narrow resized window") {
            try self.openFirstCardForEditing()
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.typeTextSafely(" [resize]", intoElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            let editor = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor).firstMatch
            let draftText = self.elementValue(element: editor)
            try self.tapFirstNavigationBackButton()
            self.attachIPadScreenshot(name: "iPad unsaved card before window resize")

            // The simulator displays the native resize affordance at the screen's
            // bottom-right corner. Drag it while the unsaved editor is presented.
            self.dragIPadWindowResizeHandle(to: CGPoint(
                x: originalFrame.minX + originalFrame.width * 0.44,
                y: originalFrame.minY + originalFrame.height * 0.42
            ))
            try self.waitForIPadWindowSize(description: "narrow") { frame in
                frame.width < originalFrame.width * 0.75
                    && frame.height < originalFrame.height * 0.90
            }
            try self.assertElementExists(identifier: LiveSmokeIdentifier.cardEditorScreen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.attachIPadScreenshot(name: "iPad narrow window unsaved card")
            try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertTrue(try self.waitForElementValue(editor, identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, expectedValue: draftText, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            try self.tapFirstNavigationBackButton()

            self.dragIPadWindowResizeHandle(to: CGPoint(x: originalFrame.maxX - 8, y: originalFrame.maxY - 8))
            try self.waitForIPadWindowSize(description: "restored") { frame in
                frame.width >= originalFrame.width * 0.90
                    && frame.height >= originalFrame.height * 0.90
            }
            try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertTrue(try self.waitForElementValue(editor, identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, expectedValue: draftText, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            try self.tapFirstNavigationBackButton()
            XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.cardEditorSaveButton].isHittable)
            self.attachIPadScreenshot(name: "iPad restored window unsaved card")
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("keep all four review ratings reachable in a narrow short window") {
            try self.selectIPadDestination(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.waitForReviewAnswerReveal()

            self.dragIPadWindowResizeHandle(to: CGPoint(
                x: originalFrame.minX + originalFrame.width * 0.44,
                y: originalFrame.minY + originalFrame.height * 0.42
            ))
            try self.waitForIPadWindowSize(description: "narrow and short") { frame in
                frame.width < originalFrame.width * 0.75
                    && frame.height < originalFrame.height * 0.60
            }
            try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertAllReviewRatingsReachable()
            self.attachIPadScreenshot(name: "iPad narrow short window all four review ratings")
            try self.scrollRevealedAnswerAboveRatings()
            try self.assertAllReviewRatingsReachable()
            self.attachIPadScreenshot(name: "iPad narrow short window readable answer and ratings")

            self.dragIPadWindowResizeHandle(to: CGPoint(x: originalFrame.maxX - 8, y: originalFrame.maxY - 8))
            try self.waitForIPadWindowSize(description: "restored review") { frame in
                frame.width >= originalFrame.width * 0.90
                    && frame.height >= originalFrame.height * 0.90
            }
            try self.assertAllReviewRatingsReachable()
            self.attachIPadScreenshot(name: "iPad restored review after window resize")

            try self.rotate(to: .landscapeLeft)
            let sidebarReview = self.app.cells[LiveSmokeIdentifier.rootTabReviewItem].firstMatch
            if !(sidebarReview.exists && sidebarReview.isHittable) {
                let sidebarToggle = self.app.buttons.matching(NSPredicate(
                    format: "identifier IN %@",
                    ["ToggleSideBar", "ToggleSidebar"]
                )).firstMatch
                if sidebarToggle.exists && sidebarToggle.isHittable
                    && sidebarToggle.label != "Hide Sidebar" {
                    sidebarToggle.tap()
                }
            }
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.attachIPadScreenshot(name: "iPad landscape wide review")
        }
    }

    @MainActor
    private func restoreIPadWindowToFullScreen() throws {
        // SpringBoard can report portrait dimensions after rotating the app.
        // Normalize those physical dimensions for the system resize gesture.
        let systemFrame = XCUIApplication(bundleIdentifier: "com.apple.springboard").frame
        let shortSide = min(systemFrame.width, systemFrame.height)
        let longSide = max(systemFrame.width, systemFrame.height)
        let landscape = XCUIDevice.shared.orientation.isLandscape
        let physicalFrame = CGRect(
            x: 0,
            y: 0,
            width: landscape ? longSide : shortSide,
            height: landscape ? shortSide : longSide
        )
        let currentFrame = self.app.windows.firstMatch.frame
        if currentFrame.width >= physicalFrame.width * 0.90
            && currentFrame.height >= physicalFrame.height * 0.90 {
            return
        }
        self.dragIPadWindowResizeHandle(to: CGPoint(x: physicalFrame.maxX - 8, y: physicalFrame.maxY - 8))
        try self.waitForIPadWindowSize(description: "physical full-screen baseline") { frame in
            frame.width >= physicalFrame.width * 0.90
                && frame.height >= physicalFrame.height * 0.90
        }
    }

    @MainActor
    private func scrollRevealedAnswerAboveRatings() throws {
        let answer = self.app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Smoke guest manual review answer"))
            .firstMatch
        let scrollView = self.app.scrollViews.firstMatch
        let initialScrollFrame = scrollView.frame
        let initialNavigationBottom = self.app.navigationBars.firstMatch.frame.maxY
        let nativeBottomInsetTop = scrollView.otherElements.allElementsBoundByIndex
            .map(\.frame)
            .filter { frame in
                abs(frame.width - initialScrollFrame.width) <= 1
                    && abs(frame.maxY - initialScrollFrame.maxY) <= 1
                    && frame.height < initialScrollFrame.height
                    && frame.minY > initialNavigationBottom
            }
            .map(\.minY)
            .min()
        for attempt in 0...4 {
            let scrollFrame = scrollView.frame
            let navigationBottom = self.app.navigationBars.firstMatch.frame.maxY
            let ratingsTop = min(
                self.app.buttons["review.rating.0"].frame.minY,
                self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton].frame.minY
            )
            let visibleTop = max(scrollFrame.minY, navigationBottom) + 8
            let visibleBottom = min(scrollFrame.maxY, nativeBottomInsetTop ?? ratingsTop, ratingsTop) - 8
            let answerFrame = answer.frame
            if answer.exists && answer.isHittable
                && answerFrame.minY >= visibleTop
                && answerFrame.maxY <= visibleBottom {
                return
            }
            if attempt < 4 && visibleBottom - visibleTop > 40 {
                // The native bottom inset includes padding above its buttons.
                // Keep both the gesture and the answer outside that inset.
                let origin = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                    .coordinate(withNormalizedOffset: .zero)
                let start = origin.withOffset(CGVector(
                    dx: scrollFrame.midX,
                    dy: visibleBottom
                ))
                let end = origin.withOffset(CGVector(dx: scrollFrame.midX, dy: visibleTop))
                start.press(forDuration: 0.1, thenDragTo: end)
            }
        }
        throw LiveSmokeFailure.unexpectedReviewState(
            message: "The revealed answer cannot be read above the rating bar in the short window; answerFrame=\(answer.frame), nativeBottomInsetTop=\(String(describing: nativeBottomInsetTop)).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func dragIPadWindowResizeHandle(to target: CGPoint) {
        // The resize handle is owned by SpringBoard, outside the app's modal hit
        // region. Target the system process for both endpoints of its gesture.
        let frame = self.app.windows.firstMatch.frame
        let screenOrigin = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            .coordinate(withNormalizedOffset: .zero)
        let handle = screenOrigin.withOffset(CGVector(
            dx: frame.minX + frame.width * 0.98,
            dy: frame.minY + frame.height * 0.985
        ))
        let destination = screenOrigin.withOffset(CGVector(dx: target.x, dy: target.y))
        handle.press(forDuration: 0.1, thenDragTo: destination)
    }

    @MainActor
    private func scrollAccessibilityReviewElementIntoView(_ element: XCUIElement, identifier: String) throws {
        let scrollView = self.app.scrollViews.firstMatch
        for attempt in 0...6 {
            let frame = scrollView.frame
            let trackElements: [XCUIElement] = scrollView.otherElements.matching(NSPredicate(
                format: "label BEGINSWITH %@", "Vertical scroll bar"
            )).allElementsBoundByIndex
            let trackFrames: [CGRect] = trackElements.map { $0.frame }
            let validTracks: [CGRect] = trackFrames.filter { candidate in
                candidate.width > 0 && candidate.width <= 44
                    && candidate.height > 40
                    && candidate.minY >= frame.minY - 1
                    && candidate.maxY <= frame.maxY + 1
            }
            let track: CGRect? = validTracks.max { $0.height < $1.height }
            guard let track else {
                throw LiveSmokeFailure.unexpectedReviewState(
                    message: "The long inline review must expose a valid native vertical scroll track to measure its unobscured viewport.",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            let top = max(track.minY, self.app.navigationBars.firstMatch.frame.maxY)
            let bottom = track.maxY
            let viewport = CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, bottom - top))
            let labels = element.staticTexts.allElementsBoundByIndex
            let visibleFrame = element.frame.intersection(viewport)
            let isReadable = element.elementType == .button
                ? (visibleFrame.width >= 44 && visibleFrame.height >= 44
                    && labels.isEmpty == false && labels.allSatisfy { viewport.contains($0.frame) })
                : viewport.contains(element.frame)
            if element.exists && element.isHittable && isReadable {
                return
            }
            if attempt < 6 && viewport.height > 40 {
                let origin = XCUIApplication(bundleIdentifier: "com.apple.springboard").coordinate(withNormalizedOffset: .zero)
                let lower = origin.withOffset(CGVector(dx: frame.midX, dy: top + viewport.height * 0.85))
                let upper = origin.withOffset(CGVector(dx: frame.midX, dy: top + viewport.height * 0.15))
                if element.exists && element.frame.minY < top {
                    upper.press(forDuration: 0.1, thenDragTo: lower)
                } else {
                    lower.press(forDuration: 0.1, thenDragTo: upper)
                }
            }
        }
        throw LiveSmokeFailure.unexpectedReviewState(
            message: "The inline review element must fit fully in the unobscured scroll viewport: \(identifier), frame=\(element.frame).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private var visibleIPadCompanionPane: XCUIElement? {
        let scene = self.app.windows.firstMatch.frame
        let screens = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiScreen).allElementsBoundByIndex
        let content = self.app.buttons.matching(identifier: LiveSmokeIdentifier.aiConsentAcceptButton).allElementsBoundByIndex
            + self.app.textFields.matching(identifier: LiveSmokeIdentifier.aiComposerTextField).allElementsBoundByIndex
        return screens.first { pane in
            pane.exists && pane.frame.width >= 200 && pane.frame.height >= 200
                && scene.insetBy(dx: -1, dy: -1).contains(pane.frame)
                && content.contains { child in
                    child.exists && child.isHittable
                        && scene.insetBy(dx: -1, dy: -1).contains(child.frame)
                        && child.frame.minX >= pane.frame.minX - 1
                        && child.frame.maxX <= pane.frame.maxX + 1
                }
        }
    }

    @MainActor
    private func assertVisibleIPadCompanion() throws {
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            if self.visibleIPadCompanionPane != nil {
                let pane = try XCTUnwrap(self.visibleIPadCompanionPane)
                let toggle = self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle]
                XCTAssertEqual(self.app.buttons.matching(identifier: LiveSmokeIdentifier.aiCompanionToggle).count, 1)
                XCTAssertTrue(toggle.isHittable)
                XCTAssertGreaterThanOrEqual(toggle.frame.width, 44, "The chat action keeps a full touch target.")
                XCTAssertGreaterThanOrEqual(toggle.frame.height, 44)
                let newChat = self.app.buttons[LiveSmokeIdentifier.aiNewChatButton]
                if newChat.exists {
                    XCTAssertGreaterThanOrEqual(newChat.frame.width, 44)
                    XCTAssertGreaterThanOrEqual(newChat.frame.height, 44)
                }
                XCTAssertGreaterThanOrEqual(toggle.frame.minX, pane.frame.minX - 1, "The hide action belongs to the chat column.")
                XCTAssertLessThanOrEqual(toggle.frame.maxX, pane.frame.maxX + 1, "The main toolbar must not duplicate the hide action.")
                return
            }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
        }
        throw LiveSmokeFailure.unexpectedReviewState(
            message: "The open AI pane must show a hittable consent control or composer inside the scene.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func assertReviewFilterPlacementBesideChat() throws {
        let filter = self.app.buttons[LiveSmokeIdentifier.reviewFilterMenu]
        let pane = try XCTUnwrap(self.visibleIPadCompanionPane)
        let chatToggle = self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle]
        let title = self.app.staticTexts[LiveSmokeIdentifier.reviewCompanionTitle]
        let leaderboard = self.app.buttons[LiveSmokeIdentifier.reviewLeaderboardShortcut]
        let streak = self.app.buttons[LiveSmokeIdentifier.reviewProgressBadge]
        let topTab = self.app.buttons[LiveSmokeSelectedTab.review.itemIdentifier].firstMatch
        let navigationToggle = self.app.buttons.matching(NSPredicate(format: "identifier IN %@", ["ToggleSideBar", "ToggleSidebar"])).firstMatch
        let sidebar = self.app.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch
        let isSidebarVisible = sidebar.exists && sidebar.isHittable
        let windowFrame = self.app.windows.firstMatch.frame
        let sidebarContainer = isSidebarVisible ? self.app.collectionViews.allElementsBoundByIndex.first { collection in
            let reviewItem = collection.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch
            return collection.exists && reviewItem.exists && reviewItem.isHittable
        } : nil
        if isSidebarVisible {
            XCTAssertNotNil(sidebarContainer, "Visible navigation must have a native sidebar container.")
        }
        // Copy rectangles once: bound-index AX matches can be re-resolved during later queries.
        let paneFrame = pane.frame
        let filterFrame = filter.frame
        let chatToggleFrame = chatToggle.frame
        let titleFrame = title.exists ? title.frame : CGRect.null
        let leaderboardFrame = leaderboard.frame
        let streakFrame = streak.frame
        let sidebarFrame = sidebarContainer?.frame
        let navigationToggleFrame = navigationToggle.exists ? navigationToggle.frame : nil
        let topTabFrame = topTab.exists && topTab.isHittable ? topTab.frame : nil
        let aiFrames = self.app.descendants(matching: .any)
            .matching(identifier: LiveSmokeIdentifier.aiScreen).allElementsBoundByIndex.map { element in
                "type=\(element.elementType), exists=\(element.exists), frame=\(element.frame)"
            }
        let details = "window=\(windowFrame), selected AI=\(paneFrame), all AI=\(aiFrames), sidebar=\(String(describing: sidebarFrame)), filter=\(filterFrame), chat toggle=\(chatToggleFrame), title=\(titleFrame), score=\(leaderboardFrame), streak=\(streakFrame), native tabs=\(String(describing: topTabFrame)), navigation toggle=\(String(describing: navigationToggleFrame))"
        let attachment = XCTAttachment(string: details)
        attachment.name = "Native companion header layout bounds"
        attachment.lifetime = .keepAlways
        self.add(attachment)

        XCTAssertEqual(self.app.buttons.matching(identifier: LiveSmokeIdentifier.reviewFilterMenu).count, 1)
        XCTAssertTrue(filter.exists && filter.isHittable)
        XCTAssertEqual(self.app.buttons.matching(identifier: LiveSmokeIdentifier.aiCompanionToggle).count, 1, "The active chat has exactly one show/hide action.")
        if title.exists == false {
            let nativeTabs = try XCTUnwrap(topTabFrame, "A compact companion uses the actual native top tab bar.")
            XCTAssertTrue(chatToggle.isHittable)
            XCTAssertEqual(filterFrame.midY, nativeTabs.midY, accuracy: 2, "The filter shares the native top toolbar row.")
            XCTAssertEqual(chatToggleFrame.midY, nativeTabs.midY, accuracy: 2, "The sole chat toggle shares the native top toolbar row.")
            XCTAssertEqual(leaderboardFrame.midY, nativeTabs.midY, accuracy: 2)
            XCTAssertEqual(streakFrame.midY, nativeTabs.midY, accuracy: 2)
            XCTAssertGreaterThanOrEqual(filterFrame.minX, paneFrame.maxX, "The filter remains on the Review side of the shared native row.")
            return
        }
        XCTAssertGreaterThanOrEqual(filterFrame.height, 44)
        XCTAssertGreaterThanOrEqual(chatToggleFrame.height, 44)
        XCTAssertEqual(filterFrame.minX, paneFrame.maxX + 20, accuracy: 2)
        // AX may include the sidebar in an AI safe-area container's origin. Measure its
        // visible leading boundary from the native sidebar/window, independently of AI.
        XCTAssertGreaterThanOrEqual(chatToggleFrame.minX, sidebarFrame?.maxX ?? windowFrame.minX, "Native chat controls clear the sidebar.")
        XCTAssertLessThanOrEqual(chatToggleFrame.maxX, paneFrame.maxX, "Native chat controls fit in the visible chat column.")
        if let topTabFrame {
            XCTAssertGreaterThanOrEqual(filterFrame.minY, topTabFrame.maxY, "Study controls must clear the visible native top tabs.")
            XCTAssertGreaterThanOrEqual(chatToggleFrame.minY, topTabFrame.maxY, "Chat controls must clear the visible native top tabs.")
        }
        XCTAssertGreaterThanOrEqual(filterFrame.minX, paneFrame.maxX, "The selector belongs to the Review column beyond AI, with either native navigation placement.")
        XCTAssertGreaterThanOrEqual(filterFrame.minY, paneFrame.minY)
        XCTAssertTrue(title.exists && title.isHittable)
        XCTAssertLessThanOrEqual(filterFrame.maxX, titleFrame.minX)
        XCTAssertLessThanOrEqual(titleFrame.maxX, leaderboardFrame.minX)
        XCTAssertEqual(titleFrame.midX, (paneFrame.maxX + windowFrame.maxX) / 2, accuracy: 2, "Review is centered in its own content column.")
        XCTAssertEqual(titleFrame.midY, filterFrame.midY, accuracy: 2, "Title and filter share a single Review header row.")
        XCTAssertEqual(leaderboardFrame.midY, filterFrame.midY, accuracy: 2)
        XCTAssertEqual(streakFrame.midY, filterFrame.midY, accuracy: 2)
        XCTAssertGreaterThanOrEqual(leaderboardFrame.height, 44)
        XCTAssertGreaterThanOrEqual(streakFrame.height, 44)
        if isSidebarVisible, let navigationToggleFrame {
            XCTAssertEqual(filterFrame.midY, navigationToggleFrame.midY, accuracy: 2, "The sidebar and Review controls share the same center line: sidebar=\(navigationToggleFrame), filter=\(filterFrame).")
            XCTAssertEqual(chatToggleFrame.midY, navigationToggleFrame.midY, accuracy: 2, "The pane-owned chat control aligns with native navigation.")
        }
    }

    @MainActor
    private func assertPrimaryElementClearOfCompanion(_ element: XCUIElement) throws {
        guard let pane = self.visibleIPadCompanionPane else {
            throw LiveSmokeFailure.unexpectedReviewState(message: "AI pane is not visible.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
        }
        let overlap = pane.frame.intersection(element.frame)
        XCTAssertTrue(element.exists && element.isHittable, "The primary control must stay visible and usable beside AI.")
        XCTAssertTrue(overlap.isNull || overlap.width <= 1 || overlap.height <= 1, "AI must not cover the primary control: \(element.identifier).")
    }

    @MainActor
    private func assertAllReviewRatingsReachable() throws {
        for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
            try self.assertElementExists(identifier: identifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertTrue(self.app.buttons[identifier].isHittable, "Review rating \(identifier) must remain reachable.")
        }
    }

    @MainActor
    private func waitForIPadWindowSize(description: String, matches: (CGRect) -> Bool) throws {
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            if matches(self.app.windows.firstMatch.frame) {
                return
            }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }
        throw LiveSmokeFailure.unexpectedAccountState(
            message: "Native resize gesture did not produce the \(description) app window; frame=\(self.app.windows.firstMatch.frame). Rotation is not a substitute for resizing.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func selectIPadDestination(selectedTab: LiveSmokeSelectedTab, timeout: TimeInterval) throws {
        // Native iPad tabs overflow at accessibility text sizes. The accessibility tree
        // can expose a clipped tab beneath the paging chevron as hittable. Open the
        // system sidebar rather than synthesizing a tap on that hidden tab.
        let nextPage = self.app.buttons["Next Page"].firstMatch
        let sidebarToggle = self.app.buttons["ToggleSideBar"].firstMatch
        if nextPage.exists && nextPage.isHittable && sidebarToggle.exists && sidebarToggle.isHittable {
            try self.tapButton(button: sidebarToggle, identifier: "ToggleSideBar", timeout: timeout)
        }

        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.optionalProbeTimeoutSeconds)
        while Date() < deadline {
            let matchingDestination = NSPredicate(
                format: "identifier == %@ OR label == %@",
                selectedTab.itemIdentifier,
                selectedTab.localizedTitle(localization: self.currentLaunchLocalization)
            )
            // Exact tab identifiers take precedence over the companion's "AI" header.
            let candidates = self.app.descendants(matching: .any).matching(identifier: selectedTab.itemIdentifier).allElementsBoundByIndex
                + self.app.cells.matching(matchingDestination).allElementsBoundByIndex
                + self.app.buttons.matching(matchingDestination).allElementsBoundByIndex
                + self.app.staticTexts.matching(matchingDestination).allElementsBoundByIndex
            if let destination = candidates.first(where: { $0.exists && $0.isHittable }) {
                try self.tapButton(button: destination, identifier: selectedTab.itemIdentifier, timeout: timeout)
                try self.assertScreenVisible(screen: selectedTab.screen, timeout: timeout)
                return
            }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }
        try self.tapTabBarItem(selectedTab: selectedTab, timeout: timeout)
        try self.assertScreenVisible(screen: selectedTab.screen, timeout: timeout)
    }

    @MainActor
    private func rotate(to orientation: UIDeviceOrientation) throws {
        XCUIDevice.shared.orientation = orientation
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        var lastGeometry: [CGRect] = []
        var geometryStableSince = Date()
        while Date() < deadline {
            let frame = self.app.windows.firstMatch.frame
            let hasRequestedOrientation = orientation.isLandscape
                ? frame.width > frame.height
                : frame.height > frame.width
            let geometry = [frame] + self.app.buttons.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "rootTab.")
            ).allElementsBoundByIndex.map(\.frame)
            if geometry != lastGeometry {
                lastGeometry = geometry
                geometryStableSince = Date()
            }
            if hasRequestedOrientation && Date().timeIntervalSince(geometryStableSince) >= 0.4 {
                return
            }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
        }
        XCTFail("The iPad window must reach the requested orientation.")
    }

    @MainActor
    private func attachIPadScreenshot(name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        self.add(attachment)
    }
}
