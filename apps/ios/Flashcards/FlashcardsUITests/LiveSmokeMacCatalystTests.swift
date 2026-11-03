#if targetEnvironment(macCatalyst)
import XCTest

final class LiveSmokeMacCatalystTests: LiveSmokeTestCase {
    @MainActor private var pendingLeaderboardParticipationRestoration: (reviewEmail: String, wasEnabled: Bool)? = nil

    /// Nondestructive capture: omit fixture resets and restore temporary unsent input.
    @MainActor
    func testMacToolbarScrollEdgePreservesCurrentWorkspace() throws {
        try self.launchApplication(launchScenario: nil, selectedTab: .progress)
        let sidebar = self.app.collectionViews["Sidebar"].firstMatch
        if !sidebar.exists || !sidebar.isHittable {
            self.app.buttons["mac.sidebar.toggle"].click()
            let shown = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in sidebar.exists && sidebar.isHittable }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: 5), .completed)
        }
        defer {
            // Undo the launcher's one Fill using the native tiling history.
            self.app.menuBars.menuBarItems["com.apple.menu.window"].click()
            let previous = self.app.menuItems["Return to Previous Size"].firstMatch
            if previous.exists && previous.isEnabled {
                previous.click()
            } else {
                self.app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
            }
        }
        let sidebarHierarchy = XCTAttachment(string: self.app.debugDescription)
        sidebarHierarchy.name = "mac-native-sidebar-hierarchy"
        sidebarHierarchy.lifetime = .keepAlways
        self.add(sidebarHierarchy)
        let toggle = self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle]
        XCTAssertTrue(toggle.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        let companionWasVisible = toggle.isSelected
        defer {
            if !companionWasVisible, toggle.exists, toggle.isSelected { toggle.click() }
        }
        if !companionWasVisible {
            toggle.click()
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        try self.checkMacToolbar(name: "readonly-progress-top", identifiers: [LiveSmokeIdentifier.aiCompanionToggle])
        let streakHeading = self.app.staticTexts["Streak"].firstMatch
        XCTAssertTrue(streakHeading.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        let originalStreakFrame = streakHeading.frame
        let content = self.app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55))
        content.scroll(byDeltaX: 0, deltaY: -250)
        RunLoop.current.run(until: Date().addingTimeInterval(0.7))
        let moved = !streakHeading.exists || abs(streakHeading.frame.minY - originalStreakFrame.minY) > 10
        XCTAssertTrue(moved, "The actual Progress content must scroll before edge-effect screenshots are evidence.")
        try self.checkMacToolbar(name: "readonly-progress-scrolled-250", identifiers: [LiveSmokeIdentifier.aiCompanionToggle])
        let geometry = self.app.staticTexts["mac.toolbar.backdrop.geometry"]
        XCTAssertTrue(geometry.waitForExistence(timeout: 5))
        let fields = Dictionary(uniqueKeysWithValues: self.elementValue(element: geometry).split(separator: ";").compactMap { field -> (String, Double)? in
            let pair = field.split(separator: "=", maxSplits: 1)
            guard pair.count == 2, let number = Double(pair[1]) else { return nil }
            return (String(pair[0]), number)
        })
        let windowFrame = self.app.windows.firstMatch.frame
        let scale = windowFrame.width / CGFloat(try XCTUnwrap(fields["windowWidth"]))
        let leading = windowFrame.minX + CGFloat(try XCTUnwrap(fields["x"])) * scale
        let width = CGFloat(try XCTUnwrap(fields["width"])) * scale
        XCTAssertEqual(fields["visible"], 1, "Scrolled content must show the shared native-material backdrop.")
        XCTAssertEqual(leading, sidebar.frame.maxX, accuracy: 1)
        XCTAssertEqual(leading + width, windowFrame.maxX, accuracy: 1)
        XCTAssertGreaterThan(try XCTUnwrap(fields["height"]), 0)
        content.scroll(byDeltaX: 0, deltaY: -250)
        RunLoop.current.run(until: Date().addingTimeInterval(0.7))
        try self.checkMacToolbar(name: "readonly-progress-scrolled-500", identifiers: [LiveSmokeIdentifier.aiCompanionToggle])
        // Screenshots establish blur appearance; AX geometry alone cannot prove an edge effect.
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.cards.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.checkMacToolbar(name: "readonly-cards-top", identifiers: ["cards.filterButton", "cards.addButton"])
        self.app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55))
            .scroll(byDeltaX: 0, deltaY: -300)
        RunLoop.current.run(until: Date().addingTimeInterval(0.7))
        try self.checkMacToolbar(name: "readonly-cards-scrolled", identifiers: ["cards.filterButton", "cards.addButton"])
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.settings.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.55))
            .scroll(byDeltaX: 0, deltaY: -300)
        RunLoop.current.run(until: Date().addingTimeInterval(0.7))
        try self.checkMacToolbar(name: "readonly-settings-scrolled", identifiers: [])
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.progress.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.verifyCurrentWorkspaceSidebarAndRestoration()
    }

    /// Nondestructive: scroll surfaces SwiftUI creates after launch or a companion transition,
    /// without navigation, still drive the toolbar backdrop. Reveals once; never rates.
    @MainActor
    func testMacToolbarBackdropFollowsRecreatedStudySurfaces() throws {
        guard #available(iOS 26.0, *) else {
            throw XCTSkip("The shared toolbar backdrop and its geometry marker require macOS 26.")
        }
        // Teardown blocks run even after a failed assertion stops the test.
        self.addMacWindowRestorationTeardown()
        // A cold launch on Review swaps its loader for the card without any navigation.
        try self.launchApplication(launchScenario: nil, selectedTab: .review)
        let showAnswer = self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton]
        try XCTSkipUnless(showAnswer.waitForExistence(timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds),
            "The current workspace has no unrevealed card to verify without rating.")
        self.waitForBackdropRegistration("review")
        self.attachMacWindowScreenshot(name: "mac-backdrop-review-launch")

        // A sidebar row keeps keyboard focus; a click on blank card space returns it to study.
        let sidebar = self.app.collectionViews["Sidebar"].firstMatch
        if !sidebar.exists || !sidebar.isHittable {
            self.app.buttons["mac.sidebar.toggle"].click()
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                sidebar.exists && sidebar.isHittable
            }, object: nil)], timeout: 5), .completed)
        }
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let review = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.reviewScreen).firstMatch
        XCTAssertTrue(review.exists && showAnswer.exists)
        review.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5)).click()
        self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
        try self.waitForReviewAnswerReveal()

        let edit = self.app.buttons["review.editCardButton"]
        let editTop = edit.frame.minY
        review.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).scroll(byDeltaX: 0, deltaY: -250)
        RunLoop.current.run(until: Date().addingTimeInterval(0.7))
        let scrolled = !edit.exists || abs(edit.frame.minY - editTop) > 10
        let reviewFields = self.backdropFields()
        self.attachMacWindowScreenshot(name: "mac-backdrop-review-scrolled-\(scrolled)")
        self.attachBackdropValue(name: "mac-backdrop-review-scrolled-\(scrolled)")
        if scrolled { XCTAssertEqual(reviewFields["visible"], "1", "Scrolled Review content must show the backdrop.") }
        review.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).scroll(byDeltaX: 0, deltaY: 500)
        RunLoop.current.run(until: Date().addingTimeInterval(0.7))

        // The companion's transcript registers while it slides in.
        let toggle = self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle]
        XCTAssertTrue(toggle.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        if !toggle.isSelected {
            self.addTeardownBlock { [weak self] in
                MainActor.assumeIsolated {
                    guard let app = self?.app, app.state == .runningForeground else { return }
                    let toggle = app.buttons[LiveSmokeIdentifier.aiCompanionToggle]
                    if toggle.exists && toggle.isSelected { toggle.click() }
                }
            }
            toggle.click()
        }
        try self.assertAiEntrySurfaceVisible()
        if self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].exists {
            self.attachBackdropValue(name: "mac-backdrop-companion-consent-pending")
        } else {
            self.waitForBackdropRegistration("chat")
            self.waitForBackdropRegistration("review")
            self.attachMacWindowScreenshot(name: "mac-backdrop-companion")
            try self.verifyComposerOwnsTextAndEscape()
        }
        try self.waitForReviewAnswerReveal()
    }

    /// With an empty draft only: Space types into the focused composer, Escape returns focus,
    /// and the temporary letters-only text is removed. Nothing is sent or rated.
    @MainActor
    private func verifyComposerOwnsTextAndEscape() throws {
        let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        func draft() -> String {
            let value = self.elementValue(element: composer)
            return value == composer.placeholderValue || value == composer.label ? "" : value
        }
        guard draft().isEmpty else {
            self.attachBackdropValue(name: "mac-composer-check-skipped-existing-draft")
            return
        }
        let text = "escape check"
        // Registered after the companion's, so it runs first: remove only this check's text.
        self.addTeardownBlock { [weak self] in
            MainActor.assumeIsolated {
                guard let self, let app = self.app, app.state == .runningForeground else { return }
                let composer = self.aiComposerTextFieldElement()
                guard composer.exists else { return }
                let value = self.elementValue(element: composer)
                guard !value.isEmpty, value != composer.placeholderValue, value != composer.label,
                      text.hasPrefix(value) else { return }
                self.clearFocusedText(in: composer)
            }
        }
        composer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
        composer.typeText(text)
        try self.waitForAiComposerValue(text, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
        let released = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !self.elementHasKeyboardFocus(element: composer)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [released], timeout: 5), .completed, "Escape must leave the composer.")
        XCTAssertEqual(draft(), text, "Escape keeps the unsent draft.")
        self.clearFocusedText(in: composer)
        let cleared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in draft().isEmpty }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: 5), .completed, "Draft: \(draft())")
    }

    /// Nondestructive: typing in the native toolbar search keeps the text and cursor, then clears.
    @MainActor
    func testMacCardsToolbarSearchKeepsTypedText() throws {
        self.addMacWindowRestorationTeardown()
        try self.launchApplication(launchScenario: nil, selectedTab: .cards)
        try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let field = self.app.descendants(matching: .any).matching(identifier: "cards.searchField").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        func text() -> String {
            let value = self.elementValue(element: field)
            return value == field.placeholderValue ? "" : value
        }
        try XCTSkipUnless(text().isEmpty, "Leave an existing search query untouched.")
        let first = "nibomo toolbar ", second = "search check"
        self.addTeardownBlock { [weak self] in
            MainActor.assumeIsolated {
                guard let self, let app = self.app, app.state == .runningForeground else { return }
                let field = app.descendants(matching: .any).matching(identifier: "cards.searchField").firstMatch
                guard field.exists else { return }
                let value = self.elementValue(element: field)
                guard !value.isEmpty, value != field.placeholderValue, (first + second).hasPrefix(value) else { return }
                self.clearFocusedText(in: field)
                app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
            }
        }
        field.click()
        field.typeText(first)
        // Let the model round-trip before continuing at the same cursor position.
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        field.typeText(second)
        let typed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in text() == first + second }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [typed], timeout: 5), .completed, "Search text: \(text())")
        self.attachMacWindowScreenshot(name: "mac-cards-search-typed")
        self.clearFocusedText(in: field)
        let cleared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in text().isEmpty }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [cleared], timeout: 5), .completed, "Search text: \(text())")
        self.app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
    }

    /// Nondestructive: the split detail swaps section stacks, so writing Settings' path after
    /// the AI stack was used must not trap SwiftUI. Opens only read-only screens.
    @MainActor
    func testMacCrossSectionNavigationKeepsSplitDetailAlive() throws {
        self.addMacWindowRestorationTeardown()
        try self.launchApplication(launchScenario: nil, selectedTab: .ai)
        try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: "ai.historyButton", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: "mac.navigation.back", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.waitForMacToolbarTitleAbsent(identifier: "mac.toolbar.title.ai")

        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterScrollSurface, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        self.attachMacWindowScreenshot(name: "mac-review-filter-popover")
        let editDecks = self.app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Edit decks")).firstMatch
        XCTAssertTrue(editDecks.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        editDecks.click()
        // Edit decks pushes Decks onto Settings: the toolbar offers Back.
        XCTAssertTrue(self.app.staticTexts["mac.toolbar.title.settings"].waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        XCTAssertTrue(self.app.buttons["mac.navigation.back"].exists, "Edit decks must open a pushed Settings page.")
        self.attachMacWindowScreenshot(name: "mac-edit-decks-opened")
        try self.tapButton(identifier: "mac.navigation.back", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)

        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.app.typeKey(",", modifierFlags: .command)
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertEqual(self.app.state, .runningForeground)
    }

    /// Review's Edit decks lands on Decks whether Settings was never shown or was left scrolled,
    /// and Settings keeps that page while another section is shown.
    @MainActor
    func testMacEditDecksLandsOnDecksFromReview() throws {
        self.addMacWindowRestorationTeardown()
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        try self.step("open Decks before Settings was ever shown") {
            try self.openDecksFromReviewFilter()
            try self.tapTabBarItem(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapTabBarItem(selectedTab: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.waitForMacSettingsPage(title: "Decks")
            try self.tapButton(identifier: "mac.navigation.back", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
        try self.step("open Decks after Settings was scrolled") {
            for _ in 0..<3 {
                try self.scrollSettingsRootContent(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
            try self.tapTabBarItem(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.openDecksFromReviewFilter()
            try self.tapButton(identifier: "mac.navigation.back", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    func testMacLeaderboardParticipationLandsOnSettingsPage() throws {
        self.addMacWindowRestorationTeardown()
        guard let reviewEmail = ProcessInfo.processInfo.environment[LiveSmokeConfiguration.reviewEmailEnvironmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              reviewEmail.hasSuffix("@example.com") else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "The leaderboard fixture requires the configured synthetic review email in @example.com.",
                screen: self.currentScreenSummary(), step: self.currentStepTitle)
        }
        try self.runGuestToLinkedWorkspaceScenario(
            context: self.makeRunContext(), reviewEmail: reviewEmail,
            beforeSignIn: {}, afterWorkspaceCreated: {},
            beforeDelete: {
                try self.restoreMacLeaderboardParticipationIfNeeded()
            },
            scenario: {
                try self.openAccountStatus()
                let linkedEmailLabel = self.visibleLinkedEmailLabel()
                try self.tapFirstNavigationBackButton()
                guard linkedEmailLabel?.contains(reviewEmail) == true else {
                    throw LiveSmokeFailure.unexpectedAccountState(
                        message: "The leaderboard fixture did not link the exact configured synthetic reviewer; participation was not changed.",
                        screen: self.currentScreenSummary(), step: self.currentStepTitle)
                }
                try self.tapSettingsButtonScrollingIntoView(identifier: LiveSmokeIdentifier.settingsLeaderboardParticipationRow,
                    timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.assertScreenVisible(screen: .leaderboardParticipationSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                let toggle = self.app.switches["leaderboardParticipationSettings.toggle"].firstMatch
                XCTAssertTrue(toggle.waitForExistence(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds))
                let originalValue = self.elementValue(element: toggle)
                guard originalValue == "0" || originalValue == "1" else {
                    throw LiveSmokeFailure.unexpectedAccountState(
                        message: "Leaderboard participation did not expose a valid switch value; participation was not changed.",
                        screen: self.currentScreenSummary(), step: self.currentStepTitle)
                }
                let wasEnabled = originalValue == "1"
                self.pendingLeaderboardParticipationRestoration = (reviewEmail: reviewEmail, wasEnabled: wasEnabled)
                self.addTeardownBlock { [self] in
                    try MainActor.assumeIsolated {
                        try self.restoreMacLeaderboardParticipationIfNeeded()
                    }
                }
                self.add(self.makeTextAttachment(name: "mac-leaderboard-participation-restoration-pending",
                    text: "originalParticipationEnabled=\(wasEnabled);restoreBeforeWorkspaceCleanup=true"))
                if wasEnabled {
                    XCTAssertTrue(toggle.isEnabled)
                    toggle.click()
                    let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                        toggle.exists && toggle.isEnabled && self.elementValue(element: toggle) == "0"
                    }, object: nil)
                    XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: LiveSmokeConfiguration.longUiTimeoutSeconds), .completed)
                }
                // Relaunch discards the optimistic profile, so the switch requires a new server read.
                self.app.terminate()
                try self.launchApplication(launchScenario: nil, selectedTab: .settings)
                try self.tapSettingsButtonScrollingIntoView(identifier: LiveSmokeIdentifier.settingsLeaderboardParticipationRow,
                    timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                let refreshedToggle = self.app.switches["leaderboardParticipationSettings.toggle"].firstMatch
                XCTAssertTrue(refreshedToggle.waitForExistence(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds))
                XCTAssertEqual(self.elementValue(element: refreshedToggle), "0")
                try self.tapTabBarItem(selectedTab: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                let openSettings = self.app.buttons["progress.leaderboard.openSettingsButton"]
                XCTAssertTrue(openSettings.waitForExistence(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds))
                openSettings.click()
                try self.assertScreenVisible(screen: .leaderboardParticipationSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                XCTAssertTrue(self.app.buttons["mac.navigation.back"].waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds),
                    "Leaderboard participation must open as a pushed Settings page.")
                try self.tapButton(identifier: "mac.navigation.back", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
        )
    }

    @MainActor
    private func restoreMacLeaderboardParticipationIfNeeded() throws {
        guard let pending = self.pendingLeaderboardParticipationRestoration else { return }
        self.app.terminate()
        try self.launchApplication(launchScenario: nil, selectedTab: .settings)
        try self.openAccountStatus()
        let linkedEmailLabel = self.visibleLinkedEmailLabel()
        try self.tapFirstNavigationBackButton()
        guard linkedEmailLabel?.contains(pending.reviewEmail) == true else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Leaderboard restoration requires the exact configured synthetic reviewer; participation was not changed.",
                screen: self.currentScreenSummary(), step: self.currentStepTitle)
        }
        try self.tapSettingsButtonScrollingIntoView(identifier: LiveSmokeIdentifier.settingsLeaderboardParticipationRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        let toggle = self.app.switches["leaderboardParticipationSettings.toggle"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds))
        let originalValue = pending.wasEnabled ? "1" : "0"
        let currentValue = self.elementValue(element: toggle)
        guard currentValue == "0" || currentValue == "1" else {
            throw LiveSmokeFailure.unexpectedAccountState(
                message: "Leaderboard restoration did not expose a valid switch value; participation was not changed.",
                screen: self.currentScreenSummary(), step: self.currentStepTitle)
        }
        if currentValue != originalValue {
            XCTAssertTrue(toggle.isEnabled)
            toggle.click()
            let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                toggle.exists && toggle.isEnabled && self.elementValue(element: toggle) == originalValue
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: LiveSmokeConfiguration.longUiTimeoutSeconds), .completed)
        }
        self.app.terminate()
        try self.launchApplication(launchScenario: nil, selectedTab: .settings)
        try self.tapSettingsButtonScrollingIntoView(identifier: LiveSmokeIdentifier.settingsLeaderboardParticipationRow,
            timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        let refreshedToggle = self.app.switches["leaderboardParticipationSettings.toggle"].firstMatch
        XCTAssertTrue(refreshedToggle.waitForExistence(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds))
        guard self.elementValue(element: refreshedToggle) == originalValue else {
            throw LiveSmokeFailure.unexpectedElementValue(
                identifier: "leaderboardParticipationSettings.toggle", expectedValue: originalValue,
                actualValue: self.elementValue(element: refreshedToggle), timeoutSeconds: LiveSmokeConfiguration.longUiTimeoutSeconds,
                screen: self.currentScreenSummary(), step: self.currentStepTitle)
        }
        self.pendingLeaderboardParticipationRestoration = nil
        self.add(self.makeTextAttachment(name: "mac-leaderboard-participation-restoration-verified",
            text: "participationEnabled=\(pending.wasEnabled);verifiedAfterRelaunch=true"))
        try self.tapFirstNavigationBackButton()
        try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    private func openDecksFromReviewFilter() throws {
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterScrollSurface, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let editDecks = self.app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Edit decks")).firstMatch
        XCTAssertTrue(editDecks.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        editDecks.click()
        self.waitForMacSettingsPage(title: "Decks")
        self.attachMacWindowScreenshot(name: "mac-edit-decks-opened")
    }

    @MainActor
    private func waitForMacSettingsPage(title: String) {
        let header = self.app.staticTexts["mac.toolbar.title.settings"]
        let shown = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND label == %@", title), object: header)
        XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds), .completed,
            "Expected the pushed Settings page \(title); found \(header.exists ? header.label : "no title").")
        XCTAssertTrue(self.app.buttons["mac.navigation.back"].exists, "A pushed Settings page offers Back.")
    }

    /// Undo the launcher's one Fill before the app terminates, whatever the test's outcome.
    @MainActor
    private func addMacWindowRestorationTeardown() {
        self.addTeardownBlock { [weak self] in
            MainActor.assumeIsolated {
                guard let self, let app = self.app, app.state == .runningForeground else { return }
                self.returnMacWindowToPreviousSize()
            }
        }
    }

    /// Select all and delete with single native edit keys in a clicked text control.
    @MainActor
    private func clearFocusedText(in element: XCUIElement) {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
        self.app.typeKey("a", modifierFlags: .command)
        self.app.typeKey(XCUIKeyboardKey.delete.rawValue, modifierFlags: [])
    }

    /// Undo the launcher's one Fill using the native tiling history.
    @MainActor
    private func returnMacWindowToPreviousSize() {
        self.app.menuBars.menuBarItems["com.apple.menu.window"].click()
        let previous = self.app.menuItems["Return to Previous Size"].firstMatch
        if previous.exists && previous.isEnabled {
            previous.click()
        } else {
            self.app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
        }
    }

    @MainActor
    private func backdropFields() -> [String: String] {
        let geometry = self.app.staticTexts["mac.toolbar.backdrop.geometry"]
        guard geometry.waitForExistence(timeout: 5) else { return [:] }
        return Dictionary(self.elementValue(element: geometry).split(separator: ";").compactMap { field in
            let pair = field.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            return pair.count == 2 ? (String(pair[0]), String(pair[1])) : nil
        }, uniquingKeysWith: { _, last in last })
    }

    @MainActor
    private func waitForBackdropRegistration(_ surface: String) {
        let registered = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            (self.backdropFields()["registered"] ?? "").split(separator: ",").contains(Substring(surface))
        }, object: nil)
        let result = XCTWaiter.wait(for: [registered], timeout: 10)
        self.attachBackdropValue(name: "mac-backdrop-registration-\(surface)")
        XCTAssertEqual(result, .completed, "The \(surface) scroll view must drive the toolbar backdrop without navigation.")
    }

    @MainActor
    private func attachBackdropValue(name: String) {
        let attachment = XCTAttachment(string: self.backdropFields().sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value)" }.joined(separator: ";"))
        attachment.name = name
        attachment.lifetime = .keepAlways
        self.add(attachment)
    }

    @MainActor
    private func attachMacWindowScreenshot(name: String) {
        let attachment = XCTAttachment(screenshot: self.app.windows.firstMatch.screenshot())
        attachment.name = name + "-window"
        attachment.lifetime = .keepAlways
        self.add(attachment)
    }

    /// Navigation, reveal and unsent input only; never rate, save, send or reset study data.
    @MainActor
    private func verifyCurrentWorkspaceSidebarAndRestoration() throws {
        let window = self.app.windows.firstMatch
        let sidebar = self.app.collectionViews["Sidebar"].firstMatch
        XCTAssertTrue(sidebar.exists)
        let sidebarOuterInset = min(sidebar.frame.minX - window.frame.minX, window.frame.maxX - sidebar.frame.maxX)
        XCTAssertGreaterThanOrEqual(sidebarOuterInset, 0)
        XCTAssertEqual(sidebar.frame.minY, window.frame.minY + sidebarOuterInset, accuracy: 1)
        XCTAssertEqual(sidebar.frame.maxY, window.frame.maxY - sidebarOuterInset, accuracy: 1)
        XCTAssertEqual(sidebar.frame.height, window.frame.height - 2 * sidebarOuterInset, accuracy: 1)
        let originalSidebarFrame = sidebar.frame
        let sidebarButton = self.app.buttons["mac.sidebar.toggle"].firstMatch
        XCTAssertTrue(sidebarButton.exists)
        sidebarButton.click()
        let hidden = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !sidebar.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [hidden], timeout: 5), .completed)
        self.attachMacScreenshot(name: "mac-native-sidebar-hidden")
        sidebarButton.click()
        let shown = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in sidebar.isHittable }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [shown], timeout: 5), .completed)
        XCTAssertEqual(sidebar.frame.width, originalSidebarFrame.width, accuracy: 1)

        for tab in [LiveSmokeSelectedTab.settings, .ai, .review] {
            try self.tapTabBarItem(identifier: tab.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            let visible = self.app.descendants(matching: .any).matching(identifier: tab.screen.identifier).firstMatch
                .waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.attachMacScreenshot(name: "mac-native-sidebar-" + String(describing: tab))
            XCTAssertTrue(visible, "Native sidebar selection must present \(tab.screen.title).")
        }
        let badgesHierarchy = XCTAttachment(string: self.app.debugDescription)
        badgesHierarchy.name = "mac-native-badges-hierarchy"
        badgesHierarchy.lifetime = .keepAlways
        self.add(badgesHierarchy)
        try self.checkMacToolbar(name: "review-native-badges", identifiers: ["review.leaderboardShortcut", LiveSmokeIdentifier.reviewProgressBadge])
        // The clicked sidebar row keeps keyboard focus; Space must still reveal the answer.
        XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton]
            .waitForExistence(timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds))
        self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
        try self.waitForReviewAnswerReveal()
        let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let value = self.elementValue(element: composer)
        let draft = value == composer.placeholderValue || value == composer.label ? "" : value
        let cleanupRequested = ProcessInfo.processInfo.environment["FLASHCARDS_MAC_RESTORE_OWNED_TEST_DRAFT"] == "1"
        let ownedDraft = !draft.isEmpty && "unsent native sidebar restoration check".hasPrefix(draft.lowercased())
        if cleanupRequested { XCTAssertTrue(ownedDraft, "Cleanup may only remove the known temporary draft from this probe.") }
        var draftRestored = false
        func restoreDraft() {
            guard cleanupRequested && ownedDraft && !draftRestored else { return }
            guard composer.exists && composer.isHittable else { return }
            composer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
            // Single native edit keys work around Catalyst's disabled Delete menu item.
            self.app.typeKey("a", modifierFlags: .command)
            self.app.typeKey(XCUIKeyboardKey.delete.rawValue, modifierFlags: [])
            RunLoop.current.run(until: Date().addingTimeInterval(1))
            let restored = self.elementValue(element: composer)
            XCTAssertTrue(restored.isEmpty || restored == composer.placeholderValue || restored == composer.label)
            draftRestored = true
            self.attachMacScreenshot(name: "mac-native-owned-draft-restored")
        }
        defer { restoreDraft() }
        let ratingIdentifiers = ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"]
        func frames() -> [CGRect] {
            ratingIdentifiers.map { self.app.buttons[$0].frame }
                + [composer.frame, self.app.descendants(matching: .any).matching(identifier: "ai.screen").firstMatch.frame, sidebar.frame]
        }
        let before = frames()
        let originalWidth = window.frame.width
        self.attachMacScreenshot(name: "mac-native-sidebar-review-wide")
        // Cover the intermediate width where the sidebar used to squeeze the
        // study column while the companion still considered the whole window.
        let resizeStart = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.8))
            .withOffset(CGVector(dx: -1, dy: 0))
        let resizeEnd = window.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.8))
            .withOffset(CGVector(dx: 900, dy: 0))
        resizeStart.click(forDuration: 0.2, thenDragTo: resizeEnd)
        let intermediate = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            abs(window.frame.width - 901) <= 5
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [intermediate], timeout: 5), .completed,
            "The native resize must actually reach the approximately 900-point window.")
        self.checkMacRatingBounds()
        XCTAssertFalse(composer.isHittable, "A shown sidebar leaves insufficient detail width for two study columns.")
        self.attachMacScreenshot(name: "mac-native-sidebar-review-intermediate")
        sidebarButton.click()
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            composer.exists && composer.isHittable
        }, object: nil)], timeout: 5), .completed)
        self.checkMacRatingBounds()
        if !draft.isEmpty { try self.waitForAiComposerValue(draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) }
        self.attachMacScreenshot(name: "mac-native-sidebar-review-intermediate-sidebar-hidden")
        sidebarButton.click()
        try self.applyMacWindowLayout("Left")
        XCTAssertLessThan(window.frame.width, originalWidth - 100)
        self.checkMacRatingBounds()
        self.attachMacScreenshot(name: "mac-native-sidebar-review-narrow")
        try self.applyMacWindowLayout("Fill")
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            abs(window.frame.width - originalWidth) <= 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 10), .completed)
        if !draft.isEmpty { try self.waitForAiComposerValue(draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) }
        try self.waitForReviewAnswerReveal()
        self.checkMacRatingBounds()
        let after = frames()
        for (first, last) in zip(before, after) {
            XCTAssertEqual(first.minX, last.minX, accuracy: 1)
            XCTAssertEqual(first.minY, last.minY, accuracy: 1)
            XCTAssertEqual(first.width, last.width, accuracy: 1)
            XCTAssertEqual(first.height, last.height, accuracy: 1)
        }
        let layout = XCTAttachment(string: "before=\(before)\nafter=\(after)\nwindow=\(window.frame)")
        layout.name = "mac-native-sidebar-restored-layout"
        layout.lifetime = .keepAlways
        self.add(layout)
        self.attachMacScreenshot(name: "mac-native-sidebar-review-restored")
        for tab in [LiveSmokeSelectedTab.cards, .progress, .review] {
            try self.tapTabBarItem(identifier: tab.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: tab.screen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            if !draft.isEmpty { try self.waitForAiComposerValue(draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) }
        }
        try self.waitForReviewAnswerReveal()
        restoreDraft()
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterScrollSurface, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.attachMacScreenshot(name: "mac-native-sidebar-review-filter")
        window.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.4)).click()
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewFilterScrollSurface, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        let edit = self.app.buttons["review.editCardButton"]
        XCTAssertGreaterThanOrEqual(edit.frame.width, 36, "Edit is a custom inline target, not a toolbar item.")
        XCTAssertGreaterThanOrEqual(edit.frame.height, 36)
        edit.click()
        try self.assertElementExists(identifier: LiveSmokeIdentifier.cardEditorScreen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.app.buttons["Cancel"].firstMatch.click()
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.cardEditorScreen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        for identifier in ["review.leaderboardShortcut", LiveSmokeIdentifier.reviewProgressBadge] {
            let button = try self.macToolbarButton(identifier: identifier)
            XCTAssertTrue(button.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            XCTAssertTrue(button.isEnabled && button.isHittable)
            button.click()
            try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
        }
    }

    @MainActor
    func testMacPrimaryToolbarConsistency() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)
        // Native tiling commands work even when the previous run left a tiled window.
        try self.applyMacWindowLayout("Fill")
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.checkMacToolbar(name: "review", identifiers: ["ai.companion.toggle", "review.filter.menu", "review.leaderboardShortcut", "review.progressBadge"])
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterScrollSurface, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewFilterScrollSurface, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertGreaterThan(self.app.buttons["review.editCardButton"].frame.minY,
            self.app.windows.firstMatch.frame.minY + 56, "Edit belongs on the card, below the native toolbar.")
        try self.tapButton(identifier: "review.editCardButton", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.cardEditorScreen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.cardEditorScreen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.app.buttons[LiveSmokeIdentifier.aiCompanionToggle].click()
        try self.assertAiEntrySurfaceVisible()
        // The companion animates for 0.35 seconds; inspect its settled presentation.
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        try self.checkMacToolbar(name: "review-companion", identifiers: ["ai.companion.toggle", "ai.historyButton", "review.filter.menu", "review.leaderboardShortcut", "review.progressBadge"])
        if self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].exists {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForAiComposerAfterConsent()
        }
        let draft = "Toolbar sizing review draft"
        try self.typeTextSafely(draft, intoElementWithIdentifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.checkMacToolbar(name: "review-companion-ready", identifiers: ["ai.companion.toggle", "ai.historyButton", "ai.newChatButton", "review.filter.menu", "review.leaderboardShortcut", "review.progressBadge"])
        for (tab, identifiers) in [
            (LiveSmokeSelectedTab.progress, ["ai.companion.toggle", "ai.historyButton", "ai.newChatButton"]),
            (.cards, ["ai.companion.toggle", "ai.historyButton", "ai.newChatButton", "cards.filterButton", "cards.addButton"]),
            (.settings, []),
            (.ai, ["ai.historyButton", "ai.newChatButton"])
        ] {
            try self.tapTabBarItem(identifier: tab.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: tab.screen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.checkMacToolbar(name: String(describing: tab), identifiers: identifiers)
            if tab == .progress {
                for identifier in ["progress.leaderboard.infoButton", "progress.streakLeaderboard.infoButton", "progress.freezeInfoButton"] {
                    let frame = self.app.buttons[identifier].frame
                    XCTAssertGreaterThanOrEqual(frame.width, 36)
                    XCTAssertGreaterThanOrEqual(frame.height, 36)
                }
                try self.tapButton(identifier: "progress.leaderboard.infoButton", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                // Catalyst presents SwiftUI alerts as native macOS sheets.
                XCTAssertTrue(self.nativeAlerts.firstMatch.waitForExistence(timeout: 5))
                try self.tapAlertButton(label: "OK", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
            if tab == .settings {
                XCTAssertFalse(self.app.buttons["mac.navigation.back"].exists)
                try self.tapButton(identifier: "settings.accentColorRow", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertElementExists(identifier: "accentColorSettings.screen", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.checkMacToolbar(name: "settings-color", identifiers: ["mac.navigation.back"])
                XCTAssertEqual(self.app.staticTexts["mac.toolbar.title.settings"].label, "Accent color")
                // Toolbar navigation must also accept a click after another app
                // owns activation, without an extra activation-only click.
                XCUIApplication(bundleIdentifier: "com.apple.finder").activate()
                self.app.buttons["mac.navigation.back"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).click()
                try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                XCTAssertFalse(self.app.buttons["mac.navigation.back"].exists)
                self.waitForMacToolbarTitleAbsent(identifier: "mac.toolbar.title.settings")
            }
            if tab == .ai {
                try self.tapButton(identifier: "ai.historyButton", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.checkMacToolbar(name: "ai-history", identifiers: ["mac.navigation.back"])
                XCTAssertEqual(self.app.staticTexts["mac.toolbar.title.ai"].label, "Chat history")
                try self.tapButton(identifier: "mac.navigation.back", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.waitForAiComposerValue(draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                self.waitForMacToolbarTitleAbsent(identifier: "mac.toolbar.title.ai")
            }
        }
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForReviewAnswerReveal()
        let window = self.app.windows.firstMatch
        let originalWidth = window.frame.width
        try self.applyMacWindowLayout("Left")
        let narrowed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in window.frame.width < originalWidth - 100 }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [narrowed], timeout: 10), .completed, "The native window edge must actually resize the window.")
        try self.checkMacToolbar(name: "review-narrow", identifiers: ["review.filter.menu", "review.leaderboardShortcut", "review.progressBadge"])
        self.checkMacRatingBounds()
        let narrowWidth = window.frame.width
        // Return to Previous Size exits the entire tiling sequence, including
        // setup's Fill. Restore Fill itself to compare the same native layout.
        try self.applyMacWindowLayout("Fill")
        let restored = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            window.frame.width > narrowWidth + 100 && abs(window.frame.width - originalWidth) <= 1
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 10), .completed)
        try self.waitForAiComposerValue(draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        self.checkMacRatingBounds()
        try self.checkMacToolbar(name: "review-restored", identifiers: ["ai.companion.toggle", "ai.historyButton", "ai.newChatButton", "review.filter.menu", "review.leaderboardShortcut", "review.progressBadge"])
    }

    @MainActor
    private func waitForMacToolbarTitleAbsent(identifier: String) {
        // The retained composer can appear before the native pop animation finishes.
        let titleChanged = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: self.app.staticTexts[identifier]
        )
        XCTAssertEqual(XCTWaiter.wait(for: [titleChanged], timeout: 5), .completed)
    }

    @MainActor
    private func checkMacRatingBounds() {
        let windowFrame = self.app.windows.firstMatch.frame
        for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
            let button = self.app.buttons[identifier]
            XCTAssertTrue(button.exists)
            XCTAssertTrue(windowFrame.contains(button.frame), "Every rating must remain inside the resized window: \(identifier), \(button.frame), window \(windowFrame)")
        }
    }

    @MainActor
    private func applyMacWindowLayout(_ title: String) throws {
        let windowMenu = self.app.menuBars.menuBarItems["Window"]
        XCTAssertTrue(windowMenu.waitForExistence(timeout: 5))
        windowMenu.click()
        let item = self.app.menuItems[title].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5), "Native window layout command: \(title)")
        item.click()
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        let diagnostic = XCTAttachment(string: "command=\(title);actualFrame=\(self.app.windows.firstMatch.frame)")
        diagnostic.name = "mac-native-window-resize"
        diagnostic.lifetime = .keepAlways
        self.add(diagnostic)
    }

    @MainActor
    private func macToolbarButton(identifier: String) throws -> XCUIElement {
        switch identifier {
        case "review.leaderboardShortcut":
            return try self.macReviewStatusButtons(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds).leaderboard
        case LiveSmokeIdentifier.reviewProgressBadge:
            return try self.macReviewStatusButtons(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds).streak
        default:
            let buttons = self.app.buttons.matching(identifier: identifier)
            XCTAssertTrue(buttons.firstMatch.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            return try XCTUnwrap(buttons.count == 1 ? buttons.firstMatch : nil,
                "Expected exactly one native toolbar button for \(identifier); found \(buttons.count).")
        }
    }

    @MainActor
    private func checkMacToolbar(name: String, identifiers: [String]) throws {
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        self.attachMacScreenshot(name: "mac-toolbar-" + name)
        if !["settings-color", "ai-history"].contains(name) {
            for identifier in ["review.companionTitle", "mac.toolbar.title.progress", "mac.toolbar.title.cards", "mac.toolbar.title.settings", "mac.toolbar.title.ai"] {
                XCTAssertFalse(self.app.staticTexts[identifier].exists, "The selected sidebar row identifies root pages; no duplicate toolbar title.")
            }
        }
        var frames: [CGRect] = []
        for identifier in identifiers {
            let button = try self.macToolbarButton(identifier: identifier)
            XCTAssertEqual(button.elementType, .button)
            XCTAssertTrue(button.isEnabled && button.isHittable)
            frames.append(button.frame)
        }
        let geometry = zip(identifiers, frames).map { "\($0.0): \($0.1)" }.joined(separator: "\n")
        let attachment = XCTAttachment(string: geometry)
        attachment.name = "mac-toolbar-\(name)-frames"
        attachment.lifetime = .keepAlways
        self.add(attachment)
        if let first = frames.first {
            let nativeToolbarFrame = self.app.toolbars.allElementsBoundByIndex.map(\.frame)
                .filter { $0.height > 0 && frames.allSatisfy($0.contains) }
                .min { $0.height < $1.height }
            XCTAssertNotNil(nativeToolbarFrame)
            // Native controls expose system hit cells, not custom fixed-size labels.
            // Their shared row/containment is the contract; visible glass is reviewed visually.
            for frame in frames {
                XCTAssertGreaterThan(frame.width, 0)
                XCTAssertGreaterThan(frame.height, 0)
                XCTAssertTrue(nativeToolbarFrame?.contains(frame) == true,
                    "Actions must occupy the actual native toolbar: \(geometry)")
                XCTAssertEqual(frame.midY, first.midY, accuracy: 1, "Toolbar buttons share one band: \(geometry)")
                // Group subcontrols expose their bezel, while standalone items expose
                // the full toolbar hit cell. Review visible native heights in captures.
                XCTAssertTrue(self.app.windows.firstMatch.frame.contains(frame), "Toolbar controls stay inside the window: \(geometry)")
            }
            let ordered = frames.sorted { $0.minX < $1.minX }
            for (left, right) in zip(ordered, ordered.dropFirst()) {
                XCTAssertLessThanOrEqual(left.maxX, right.minX + 0.5, "Toolbar hit regions must not overlap: \(geometry)")
            }
        }
    }

    // XCTest synthesizes .enter as HID 52 in this Catalyst runner; cover physical keypad Enter manually.
    @MainActor
    func testMacPointerRatingRestoresSpaceAndAllRatingKeys() throws {
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)
        try self.step("create seven cards through the shared editor") {
            for index in 1...7 {
                try self.createManualCard(
                    frontText: "Mac smoke question \(index)",
                    backText: "Answer \(index): inline $x^2$ and display math:\n\n$$\\frac{1}{2} + \\frac{1}{2} = 1$$"
                )
            }
        }
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds)
        self.app.activate()
        let expectedQuestions = (1...7).map { "Mac smoke question \($0)" }
        let reviewFront = self.app.descendants(matching: .any)
            .matching(identifier: "review.frontSelectableText").firstMatch
        let expectedCard = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND (value IN %@ OR label IN %@)", expectedQuestions, expectedQuestions),
            object: reviewFront
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectedCard], timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds),
            .completed,
            "Review must show a card created by this smoke before synthesizing pointer events."
        )

        try self.step("reveal using Space and rate with the pointer") {
            self.hoverMacShortcutButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, expectedHelp: "Press Space / Enter")
            self.attachMacScreenshot(name: "mac-show-answer-shortcut-help")
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            self.attachMacScreenshot(name: "mac-review-formulas")
            let touchTargets = ["review.frontCopyButton", "review.frontTextSelectionButton", "review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"]
            let measuredTargets = touchTargets.map { "\($0): \(self.app.buttons[$0].frame)" }.joined(separator: "\n")
            let geometryAttachment = XCTAttachment(string: measuredTargets)
            geometryAttachment.name = "mac-touch-target-frames"
            geometryAttachment.lifetime = .keepAlways
            self.add(geometryAttachment)
            for identifier in touchTargets {
                let frame = self.app.buttons[identifier].frame
                XCTAssertGreaterThanOrEqual(frame.width, 36, "Mac touch target width: \(identifier), \(frame)")
                XCTAssertGreaterThanOrEqual(frame.height, 36, "Mac touch target height: \(identifier), \(frame)")
            }
            for (identifier, key) in [
                ("review.rating.0", "1"),
                ("review.rating.1", "2"),
                (LiveSmokeIdentifier.reviewRateGoodButton, "3"),
                ("review.rating.3", "4")
            ] {
                self.hoverMacShortcutButton(identifier: identifier, expectedHelp: "Press " + key)
                self.attachMacScreenshot(name: "mac-rating-" + key + "-shortcut-help")
            }
            // Exercise the top edge of the expanded target, outside its centered label.
            self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton]
                .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).click()
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("use Space on the next card without clicking to regain focus") {
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            self.app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: [])
            self.app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            self.app.typeKey("1", modifierFlags: [])
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("restore study focus after activation and reveal with Return and Space") {
            self.app.typeKey("h", modifierFlags: .command)
            self.app.activate()
            try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            for (key, revealKey) in [
                ("2", XCUIKeyboardKey.return),
                ("3", XCUIKeyboardKey.return),
                ("4", XCUIKeyboardKey.space)
            ] {
                try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
                self.app.typeKey(key, modifierFlags: [])
                XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "Rating must not submit a hidden answer.")
                self.app.typeKey(revealKey.rawValue, modifierFlags: [])
                try self.waitForReviewAnswerReveal()
                self.app.typeKey(key, modifierFlags: [])
                try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            }
        }

        try self.step("reveal with Space and Return and rate with 1 while the sidebar holds focus") {
            for revealKey in [XCUIKeyboardKey.space, XCUIKeyboardKey.return] {
                try self.tapTabBarItem(identifier: LiveSmokeIdentifier.rootTabReviewItem, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
                self.app.typeKey(revealKey.rawValue, modifierFlags: [])
                try self.waitForReviewAnswerReveal()
                self.app.typeKey("1", modifierFlags: [])
                try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
                if revealKey == .space {
                    try self.dismissSixthReviewNotificationPrePrompt()
                }
            }
        }
    }

    @MainActor
    private func dismissSixthReviewNotificationPrePrompt() throws {
        let alert = self.nativeAlerts.firstMatch
        guard alert.waitForExistence(timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds) else { return }
        let title = alert.staticTexts.firstMatch.value as? String
        _ = try XCTUnwrap(
            title == "Stay on top of your cards" ? title : nil,
            "Expected the notification preprompt before cancelling; found \(String(describing: title))."
        )
        try self.tapExistingButtonPreservingAlerts(
            alert.buttons.matching(identifier: "action-button--998").firstMatch,
            identifier: "action-button--998",
            action: "cancel_review_notification_preprompt",
            note: "expected sixth-review notification preprompt cancelled"
        )
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: alert)
        XCTAssertEqual(
            XCTWaiter.wait(for: [dismissed], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds),
            .completed,
            "Cancelling the notification preprompt must restore access to the sidebar."
        )
    }

    @MainActor
    func testMacReviewHoverPreservesAICompanionTypingFocus() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)
        try self.createManualCard(frontText: "Mac companion focus smoke", backText: "Second card for focus restoration")
        try self.tapTabBarItem(identifier: LiveSmokeSelectedTab.review.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.step("reveal on first opening Review without clicking for focus") {
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds)
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
        }
        try self.step("open the shared wide AI companion") {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewAiButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertAiEntrySurfaceVisible()
            let consent = self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton]
            if consent.exists {
                try self.tapButton(identifier: LiveSmokeIdentifier.aiConsentAcceptButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.waitForAiComposerAfterConsent()
            }
            try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        }

        try self.step("type rating keys and Space after hovering review controls") {
            let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            try self.focusElementForTextInput(composer, identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            composer.typeText("Mac draft")
            self.app.typeKey("h", modifierFlags: .command)
            self.app.activate()
            try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.hoverMacShortcutButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, expectedHelp: "Press 3")
            self.app.typeKey(XCUIKeyboardKey.space.rawValue, modifierFlags: [])
            for key in ["1", "2", "3", "4"] {
                self.app.typeKey(key, modifierFlags: [])
            }
            self.app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: .shift)
            self.app.typeText("Still drafting")
            self.app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: .shift)
            self.app.typeText("Unsent")
            try self.waitForAiComposerValue("Mac draft 1234\nStill drafting\nUnsent", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            self.attachMacScreenshot(name: "mac-ai-companion-focus")
            self.app.typeKey(XCUIKeyboardKey.escape.rawValue, modifierFlags: [])
            self.app.typeKey("3", modifierFlags: [])
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("restore study keys immediately after closing the focused companion") {
            let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.focusElementForTextInput(composer, identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.app.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: [])
            try self.waitForReviewAnswerReveal()
            try self.tapButton(identifier: LiveSmokeIdentifier.aiCompanionToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("preserve the unsent companion draft across primary sections") {
            for destination in [LiveSmokeSelectedTab.cards, .progress, .review] {
                try self.tapTabBarItem(identifier: destination.itemIdentifier, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertScreenVisible(screen: destination.screen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.waitForAiComposerValue("Mac draft 1234\nStill drafting\nUnsent", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            }
            try self.waitForReviewAnswerReveal()
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.aiMessageRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    private func hoverMacShortcutButton(identifier: String, expectedHelp: String) {
        let hint = self.app.staticTexts["review.shortcutHint"]
        self.app.buttons["review.filter.menu"].hover()
        let dismissed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: hint
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [dismissed], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds),
            .completed,
            "Previous shortcut tooltip must disappear before hovering " + identifier
        )
        let button = self.app.buttons[identifier]
        let hittable = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND hittable == true"),
            object: button
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [hittable], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds),
            .completed,
            "Expected a visible shortcut button before hover: " + identifier
        )
        button.hover()
        let appeared = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND label == %@", expectedHelp),
            object: hint
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [appeared], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds),
            .completed,
            "Expected fresh localized shortcut tooltip: " + expectedHelp
        )
        XCTAssertTrue(hint.frame.width > 0 && hint.frame.height > 0, "Shortcut tooltip must have visible bounds.")
        XCTAssertLessThanOrEqual(
            hint.frame.maxY,
            button.frame.minY + 0.5,
            "Shortcut tooltip must float above its button: " + identifier
        )
        XCTAssertTrue(self.app.windows.firstMatch.frame.contains(hint.frame), "Shortcut tooltip must stay inside the app window.")
    }

    @MainActor
    private func attachMacScreenshot(name: String) {
        let windowAttachment = XCTAttachment(screenshot: self.app.windows.firstMatch.screenshot())
        windowAttachment.name = name + "-window"
        windowAttachment.lifetime = .keepAlways
        self.add(windowAttachment)
        let screenAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenAttachment.name = name + "-screen"
        screenAttachment.lifetime = .keepAlways
        self.add(screenAttachment)
    }
}
#endif
