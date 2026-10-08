import UIKit
import XCTest

final class LiveSmokeIPadTests: LiveSmokeTestCase {
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
        XCTAssertFalse(self.app.buttons["ai.companion.move"].exists)
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
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.aiCompanionClose].exists, "The pane must not add a duplicate Close button.")
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
        for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
            try self.assertPrimaryElementClearOfCompanion(self.app.buttons[identifier])
        }
        XCTAssertGreaterThan(filter.frame.width, 85, "Opening AI must keep the deck title readable.")
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.attachIPadScreenshot(name: "iPad revealed Review with AI alongside")
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
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
        let overlap = sidebarContainer.frame.intersection(chatPane.frame)
        XCTAssertTrue(overlap.isNull || overlap.width <= 1 || overlap.height <= 1, "The native sidebar and chat must not overlap.")
        XCTAssertLessThan(sidebarContainer.frame.minX, self.app.windows.firstMatch.frame.minX + 80)
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.attachIPadScreenshot(name: "iPad native sidebar and chat in separate columns")
        sidebarToggle.tap()
        try self.assertLeadingChatDraftAndAnswer()

        try self.selectIPadDestination(selectedTab: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
        try self.selectIPadDestination(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: "review.leaderboardShortcut", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertVisibleIPadCompanion()
        XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "draft")
        self.attachIPadScreenshot(name: "iPad Progress leaderboard route with retained chat")
        // Guest fixtures expose the leaderboard route, without live account/profile requests.
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].isHittable, "Progress must expose its leading opener when closed.")
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
    func testIPadSidebarChatAndReviewSurvivePortraitRotation() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke verifies three-column iPad study.")
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
        try self.replaceTextSafely("mini draft", inElementWithIdentifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let done = self.app.buttons["ai.composerDismissKeyboardButton"]
        if done.exists && done.isHittable { done.tap() }
        let sidebar = self.app.cells.matching(NSPredicate(format: "label == %@", "Review")).firstMatch
        if !sidebar.exists || !sidebar.isHittable {
            self.app.buttons["ToggleSideBar"].firstMatch.tap()
        }
        for (orientation, name) in [(UIDeviceOrientation.landscapeLeft, "landscape"), (.portrait, "portrait")] {
            try self.rotate(to: orientation)
            self.attachIPadScreenshot(name: "iPad sidebar chat Review \(name)")
            // Native navigation collapses the sidebar on the mini in portrait.
            if sidebar.exists && sidebar.isHittable {
                XCTAssertLessThan(sidebar.frame.maxX, self.app.textFields[LiveSmokeIdentifier.aiComposerTextField].frame.minX)
            } else {
                let navigationToggle = self.app.buttons.matching(NSPredicate(format: "identifier IN %@", ["ToggleSideBar", "ToggleSidebar"])).firstMatch
                XCTAssertTrue(navigationToggle.exists && navigationToggle.isHittable, "Collapsed native navigation remains reachable.")
            }
            XCTAssertEqual(self.elementValue(element: self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]), "mini draft")
            XCTAssertTrue(self.app.staticTexts["Smoke guest manual review answer"].firstMatch.exists)
            XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists)
            for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
                let rating = self.app.buttons[identifier]
                XCTAssertTrue(rating.exists && rating.isHittable, "\(name): every rating remains usable beside chat and navigation.")
            }
        }
    }

    @MainActor
    func testIPadFloatingKeyboardKeepsReviewAndComposerAtBottom() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "This smoke exercises iPad keyboards.")
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.rotate(to: .landscapeLeft)
        // Native inspector restoration can reopen the pane after a failed run.
        let restoredCompanion = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.aiScreen).firstMatch
        if restoredCompanion.exists {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertAiEntrySurfaceVisible()
        let consent = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
        if consent.exists {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
        let composer = self.app.textFields[LiveSmokeIdentifier.aiComposerTextField]
        let reveal = self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton]
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        let restingReviewBottom = reveal.frame.maxY
        let restingComposerBottom = composer.frame.maxY
        composer.tap()
        let keyboard = self.app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
        // Keyboard mode survives app relaunch. Verify whichever native mode
        // starts first, switching a docked keyboard through its held menu.
        if keyboard.frame.width >= self.app.frame.width * 0.65 {
            XCTAssertLessThan(composer.frame.maxY, restingComposerBottom - 100, "Docked input must retain normal keyboard avoidance.")
            self.attachIPadScreenshot(name: "iPad companion docked keyboard")
            let hideKeyboard = keyboard.buttons["Hide keyboard"].firstMatch
            XCTAssertTrue(hideKeyboard.waitForExistence(timeout: 5))
            hideKeyboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
                forDuration: 1.2,
                thenDragTo: hideKeyboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -0.5))
            )
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
        self.attachIPadScreenshot(name: "iPad companion floating keyboard bottom controls")
        try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertTrue(reveal.isHittable)
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
                XCTAssertGreaterThanOrEqual(toggle.frame.minX, pane.frame.minX - 1, "The hide action belongs to the chat column.")
                XCTAssertLessThanOrEqual(toggle.frame.maxX, pane.frame.maxX + 1, "The main toolbar must not duplicate the hide action.")
                XCTAssertFalse(self.app.buttons["ai.companion.move"].exists)
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
