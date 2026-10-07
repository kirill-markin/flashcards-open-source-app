import UIKit
import XCTest

final class LiveSmokeIPhoneDuoTests: LiveSmokeTestCase {
    @MainActor
    func testDuoCompanionKeepsNativeTabsReachable() throws {
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]
        try XCTSkipUnless(model == "iPhone19,4", "This smoke requires the real iPhone Duo simulator type.")
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        let scene = try self.nativeHostWindowFrame()
        try XCTSkipUnless(
            min(scene.width, scene.height) >= 600,
            "The companion smoke requires the actual regular inner Duo display."
        )
        do {
            try self.step("keep native destinations reachable while the AI companion is open") {
                try self.assertElementExists(identifier: "ai.companion.toggle", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                if self.visibleCompanionPane != nil {
                    try self.assertVisibleCompanionConsentContent()
                    try self.tapButton(identifier: "ai.companion.toggle", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                    try self.assertCompanionConsentContentHidden()
                }
                try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
                try self.waitForReviewAnswerReveal()
                try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.tapButton(identifier: "ai.companion.toggle", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertVisibleCompanionConsentContent()
                try self.assertCompanionNavigationReachable()
                self.attachPhoneScreenshot(name: "Duo companion and reachable native tabs")
                try self.selectDuoDestination(.cards)
                try self.assertScreenVisible(screen: .cards, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertVisibleCompanionConsentContent()
                try self.assertCompanionNavigationReachable()
                try self.selectDuoDestination(.review)
                try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                guard !self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists else {
                    throw LiveSmokeFailure.unexpectedReviewState(message: "Returning to Review must keep the companion open and the same card revealed.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
                }
                self.add(self.makeTextAttachment(name: "Duo companion after Cards and Review hierarchy", text: self.app.debugDescription))
                try self.assertVisibleCompanionConsentContent()
                try self.assertCompanionNavigationReachable()
                self.attachPhoneScreenshot(name: "Duo companion preserved across Cards and Review")
                try self.tapButton(identifier: "ai.companion.toggle", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertCompanionConsentContentHidden()
                try self.tapButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
                try self.assertTextExists("Nothing Due", timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            }
        } catch {
            self.attachPhoneScreenshot(name: "Duo companion failure")
            self.attachCompanionGeometryDiagnostics()
            self.add(self.makeTextAttachment(name: "Duo companion failure hierarchy", text: self.app.debugDescription))
            throw error
        }
    }

    @MainActor
    private func assertVisibleCompanionConsentContent() throws {
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            if self.visibleCompanionConsentContent != nil { return }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
        }
        throw LiveSmokeFailure.unexpectedReviewState(message: "The open companion must expose a hittable consent title inside a real, visible >=200x200 ai.screen pane.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
    }

    @MainActor
    private var visibleCompanionConsentContent: XCUIElement? {
        let titles: [XCUIElement] = self.app.staticTexts.matching(NSPredicate(format: "label == %@", "Before you use AI")).allElementsBoundByIndex
        guard let pane = self.visibleCompanionPane else { return nil }
        return titles.contains { title in title.exists && title.isHittable && pane.frame.contains(title.frame) }
            ? pane : nil
    }

    @MainActor
    private var visibleCompanionPane: XCUIElement? {
        let screens: [XCUIElement] = self.app.descendants(matching: .any).matching(identifier: "ai.screen").allElementsBoundByIndex
        guard let window = self.nativeHostWindow else { return nil }
        let scene = window.frame
        return screens.first { element in
            element.exists && element.isHittable
                && element.frame.width >= 200 && element.frame.height >= 200
                // Native scene boundaries can differ by fractional points
                // after a display handoff; content and hit tests stay strict.
                && scene.insetBy(dx: -1, dy: -1).contains(element.frame)
        }
    }

    @MainActor
    private func attachCompanionGeometryDiagnostics() {
        let scene = self.nativeHostWindow?.frame ?? .null
        var lines = ["appFrame=\(self.preciseFrame(self.app.frame))", "nativeHostWindow=\(self.preciseFrame(scene))"]
        let panes = self.app.descendants(matching: .any).matching(identifier: "ai.screen").allElementsBoundByIndex
        for (index, pane) in panes.enumerated() {
            let frame = pane.frame
            lines.append("ai.screen[\(index)] exists=\(pane.exists) hittable=\(pane.isHittable) frame=\(self.preciseFrame(frame)) sceneContains=\(scene.contains(frame)) tolerantSceneContains=\(scene.insetBy(dx: -1, dy: -1).contains(frame))")
        }
        let titles = self.app.staticTexts.matching(NSPredicate(format: "label == %@", "Before you use AI")).allElementsBoundByIndex
        for (index, title) in titles.enumerated() {
            let containers = panes.map { $0.frame.contains(title.frame) }
            lines.append("consentTitle[\(index)] exists=\(title.exists) hittable=\(title.isHittable) frame=\(self.preciseFrame(title.frame)) paneContains=\(containers)")
        }
        let destinations: [LiveSmokeSelectedTab] = [.review, .progress, .ai, .cards, .settings]
        let identifiers = ["ai.companion.toggle"] + destinations.map { $0.tabBarItemLookup(localization: self.currentLaunchLocalization).identifier }
        for identifier in identifiers {
            let button = self.app.buttons[identifier].firstMatch
            if button.exists {
                lines.append("\(identifier) exists=true hittable=\(button.isHittable) frame=\(self.preciseFrame(button.frame))")
            } else {
                lines.append("\(identifier) exists=false")
            }
        }
        let diagnostic = lines.joined(separator: "\n")
        print("[duo-companion-geometry]\n\(diagnostic)")
        self.add(self.makeTextAttachment(name: "Duo companion geometry and hit tests", text: diagnostic))
    }

    // XCUIApplication.frame can remain in the display's natural orientation.
    // Measure the actual visible native window, excluding auxiliary windows.
    @MainActor
    private var nativeHostWindow: XCUIElement? {
        let identifiers = [LiveSmokeIdentifier.cardEditorScreen, LiveSmokeIdentifier.reviewScreen, LiveSmokeIdentifier.cardsScreen]
        for identifier in identifiers {
            let windows = self.app.windows.containing(.any, identifier: identifier).allElementsBoundByIndex
            if let window = windows.first(where: { $0.exists && $0.isHittable && $0.frame.width > 0 && $0.frame.height > 0 }) {
                return window
            }
        }
        return nil
    }

    @MainActor
    private func nativeHostWindowFrame() throws -> CGRect {
        guard let window = self.nativeHostWindow else {
            throw LiveSmokeFailure.unexpectedReviewState(
                message: "No visible native window containing the editor, Review, or Cards host is available.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
        return window.frame
    }

    private func preciseFrame(_ frame: CGRect) -> String {
        String(format: "[%.6f, %.6f, %.6f, %.6f]", frame.minX, frame.minY, frame.width, frame.height)
    }

    @MainActor
    private func assertCompanionConsentContentHidden() throws {
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            let toggle = self.app.buttons["ai.companion.toggle"].firstMatch
            if self.visibleCompanionPane == nil && toggle.exists && toggle.isHittable { return }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
        }
        throw LiveSmokeFailure.unexpectedReviewState(message: "The single main toggle must hide the companion consent content.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
    }

    @MainActor
    private func assertCompanionNavigationReachable() throws {
        let destinations: [LiveSmokeSelectedTab] = [.review, .progress, .ai, .cards, .settings]
        let identifiers: [String] = ["ai.companion.toggle"] + destinations.map { $0.tabBarItemLookup(localization: self.currentLaunchLocalization).identifier }
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        var missingIdentifiers: [String] = identifiers
        var toggleCount = 0
        while Date() < deadline {
            missingIdentifiers = []
            for identifier in identifiers {
                let buttons = self.app.buttons.matching(identifier: identifier).allElementsBoundByIndex
                if identifier == "ai.companion.toggle" { toggleCount = buttons.count }
                if !buttons.contains(where: { $0.exists && $0.isHittable }) {
                    missingIdentifiers.append(identifier)
                }
            }
            if missingIdentifiers.isEmpty && toggleCount == 1 { return }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
        }
        throw LiveSmokeFailure.unexpectedReviewState(
            message: "The open companion must leave its single main toggle and all native destinations reachable; missing=\(missingIdentifiers), toggleCount=\(toggleCount).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    func testDuoPartialFoldAndLandscapeKeepRevealedReviewReachable() throws {
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]
        try XCTSkipUnless(model == "iPhone19,4", "This smoke requires the real iPhone Duo simulator type.")
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["FLASHCARDS_RUN_MANUAL_DUO_TRANSITIONS"] == "1",
            "Native Duo transitions require explicit operator opt-in and Device Hub fold controls."
        )
        XCUIDevice.shared.orientation = .portrait
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)

        try self.step("preserve a revealed card through native partial folding and landscape rotation") {
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.waitForNativeDuoDisplayTransition(checkpoint: "review-partially-open-display")
            for landscape in [false, true] {
                if landscape {
                    XCUIDevice.shared.orientation = .landscapeLeft
                    let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
                    while Date() < deadline {
                        if let frame = self.nativeHostWindow?.frame, frame.width > frame.height { break }
                        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
                    }
                    let frame = try self.nativeHostWindowFrame()
                    XCTAssertGreaterThan(frame.width, frame.height, "The partially folded Duo review must rotate to landscape.")
                }
                try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "The same card must remain revealed after the native pose change.")
                for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
                    XCTAssertTrue(self.app.buttons[identifier].isHittable, "Every rating must remain reachable in the partial pose: \(identifier).")
                }
                try self.scrollAnswerAboveReviewAccessory()
                self.attachPhoneScreenshot(name: landscape ? "Duo partially folded landscape revealed review" : "Duo partially folded portrait revealed review")
            }
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.assertTextExists("Nothing Due", timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }
    }

    // Device Hub drives the real Duo fold/display transitions at the printed
    // checkpoints. No orientation or synthetic screen resize substitutes for them.
    @MainActor
    func testDuoDraftAndRevealedAnswerSurviveNativeDisplayTransitions() throws {
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]
        try XCTSkipUnless(model == "iPhone19,4", "This smoke requires the real iPhone Duo simulator type.")
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["FLASHCARDS_RUN_MANUAL_DUO_TRANSITIONS"] == "1",
            "Native Duo transitions require explicit operator opt-in and Device Hub fold controls."
        )
        XCUIDevice.shared.orientation = .portrait
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)
        let draft = "A Duo draft keeps its question, cursor, and answer while opening or closing the device.\nContinue studying."

        try self.step("retain an unsaved keyboard draft during a native Duo display transition") {
            try self.openFirstCardForEditing()
            try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.replaceTextSafely(draft, inElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            let editor = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor).firstMatch
            XCTAssertTrue(self.app.keyboards.firstMatch.exists)
            XCTAssertLessThanOrEqual(editor.frame.maxY, self.app.keyboards.firstMatch.frame.minY + 1, "The draft editor must stay above the docked keyboard before opening Duo.")
            self.attachPhoneScreenshot(name: "Duo unsaved draft before native display transition")
            try self.waitForNativeDuoDisplayTransition(checkpoint: "draft-open-display")
            XCTAssertTrue(try self.waitForElementValue(editor, identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, expectedValue: draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            XCTAssertTrue(self.app.keyboards.firstMatch.exists, "The active draft must retain its keyboard after opening Duo.")
            XCTAssertLessThanOrEqual(editor.frame.maxY, self.app.keyboards.firstMatch.frame.minY + 1, "The draft editor must stay above the docked keyboard after opening Duo.")
            XCTAssertTrue(self.editorBackButton.isHittable)
            self.attachPhoneScreenshot(name: "Duo unsaved draft after native display transition")
            try self.tapEditorBack()
            try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertTrue(try self.waitForElementValue(editor, identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, expectedValue: draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            try self.tapEditorBack()
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("retain the same revealed answer when continuing on the other Duo display") {
            try self.selectDuoDestination(.review)
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            self.attachPhoneScreenshot(name: "Duo revealed answer before native display transition")
            try self.waitForNativeDuoDisplayTransition(checkpoint: "review-close-display")
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "The same revealed card must stay revealed across displays.")
            for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
                XCTAssertTrue(self.app.buttons[identifier].isHittable, "Every rating must remain reachable after the Duo display transition: \(identifier).")
            }
            try self.scrollAnswerAboveReviewAccessory()
            self.attachPhoneScreenshot(name: "Duo readable answer after native display transition")
            try self.roundtripUnchangedReviewFilter()
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.assertTextExists("Nothing Due", timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }
    }

    @MainActor
    private func waitForNativeDuoDisplayTransition(checkpoint: String) throws {
        let original = try self.nativeHostWindowFrame()
        let orientation = XCUIDevice.shared.orientation
        print("[duo-pose-checkpoint] \(checkpoint) ready; frame=\(original); use native Device Hub fold controls now")
        let deadline = Date().addingTimeInterval(120)
        var previous = original
        var stableSince = Date()
        while Date() < deadline {
            guard let frame = self.nativeHostWindow?.frame else {
                // Native windows can briefly disappear during the real handoff.
                stableSince = Date()
                RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
                continue
            }
            let changed = abs(frame.width - original.width) > 80 || abs(frame.height - original.height) > 80
            if frame != previous {
                previous = frame
                stableSince = Date()
            }
            if changed && Date().timeIntervalSince(stableSince) >= 1 {
                XCTAssertEqual(XCUIDevice.shared.orientation, orientation, "A display transition must not be replaced by device rotation.")
                print("[duo-pose-checkpoint] \(checkpoint) observed; frame=\(frame)")
                return
            }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
        }
        throw LiveSmokeFailure.unexpectedReviewState(
            message: "No native Duo display transition was observed at checkpoint \(checkpoint); originalFrame=\(original), currentFrame=\(try self.nativeHostWindowFrame()).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    // This is the ordinary-phone regression, not evidence of Duo fold support.
    @MainActor
    func testPhoneLargestTextKeepsLongDraftKeyboardAndReviewReachable() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "This smoke exercises phone layouts.")
        XCUIDevice.shared.orientation = .portrait
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

        let draft = "How can I keep a longer flashcard editable?\nCheck the keyboard, draft, save action, and review controls."
        try self.step("edit and reopen an exact multiline draft with the software keyboard") {
            try self.openFirstCardForEditing()
            try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.replaceTextSafely(draft, inElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            let editor = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor).firstMatch
            let keyboard = self.app.keyboards.firstMatch
            let back = self.editorBackButton
            self.attachPhoneScreenshot(name: "Phone largest text multiline editor and keyboard")
            self.add(self.makeTextAttachment(name: "Phone largest text editor hierarchy", text: self.app.debugDescription))
            XCTAssertTrue(keyboard.exists, "The software keyboard must be present for the compact editing check.")
            XCTAssertLessThanOrEqual(editor.frame.maxY, keyboard.frame.minY + 1, "The largest-text editor must remain unobscured above the docked keyboard.")
            XCTAssertTrue(back.isHittable, "The editor must remain escapable while the keyboard is present.")
            XCTAssertLessThanOrEqual(back.frame.maxY, keyboard.frame.minY)
            XCTAssertTrue(editor.isHittable)
            try self.tapEditorBack()
            try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertTrue(try self.waitForElementValue(editor, identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, expectedValue: draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
            try self.tapEditorBack()
            XCTAssertTrue(self.app.buttons[LiveSmokeIdentifier.cardEditorSaveButton].isHittable)
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("read the revealed answer and reach all four ratings with largest text") {
            try self.selectDuoDestination(.review)
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            try self.scrollAnswerAboveReviewAccessory(hasFixedAccessory: false)
            self.attachPhoneScreenshot(name: "Phone largest text fully readable revealed answer")
            for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
                let rating = self.app.buttons[identifier]
                try self.scrollElementFullyIntoReviewViewport(rating, identifier: identifier)
            }
            self.attachPhoneScreenshot(name: "Phone largest text readable inline rating controls")
            try self.scrollElementFullyIntoReviewViewport(self.app.buttons[LiveSmokeIdentifier.reviewRateGoodButton], identifier: LiveSmokeIdentifier.reviewRateGoodButton)
            try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.assertTextExists("Nothing Due", timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }

        try self.step("reach navigation and nested settings with largest text") {
            try self.selectDuoDestination(.progress)
            try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.selectDuoDestination(.ai)
            try self.assertAiEntrySurfaceVisible()
            try self.selectDuoDestination(.settings)
            try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.settingsReviewAnimationsRow, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .reviewAnimationsSettings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            self.attachPhoneScreenshot(name: "Phone largest text nested settings")
        }
    }

    @MainActor
    private var editorBackButton: XCUIElement {
        let verticalBarBack = self.app.buttons["BackButton"].firstMatch
        if verticalBarBack.exists && verticalBarBack.isHittable {
            return verticalBarBack
        }
        let names = ["Back", "Edit card"]
        return self.app.navigationBars.buttons.matching(NSPredicate(
            format: "identifier IN %@ OR label IN %@", names, names
        )).firstMatch
    }

    @MainActor
    private func tapEditorBack() throws {
        try self.tapButton(button: self.editorBackButton, identifier: "native.editor.back", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    private func selectDuoDestination(_ destination: LiveSmokeSelectedTab) throws {
        let lookup = destination.tabBarItemLookup(localization: self.currentLaunchLocalization)
        let candidates = [
            self.app.cells[lookup.identifier].firstMatch,
            self.app.buttons[lookup.identifier].firstMatch,
            self.app.descendants(matching: .any).matching(identifier: lookup.identifier).firstMatch,
            self.app.buttons[lookup.localizedTitle].firstMatch
        ]
        if let candidate = candidates.first(where: { $0.exists && $0.isHittable }) {
            candidate.tap()
            return
        }
        try self.tapTabBarItem(selectedTab: destination, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    private func roundtripUnchangedReviewFilter() throws {
        let question = self.app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "A Duo draft keeps")).firstMatch
        XCTAssertTrue(question.exists)
        let questionText = question.label
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        // The filter exposes a native Button with a 1/0 accessibility value.
        let allCards = self.app.buttons[LiveSmokeIdentifier.reviewFilterAllCardsToggle].firstMatch
        try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertTrue(try self.waitForElementValue(allCards, identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, expectedValue: "1", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        allCards.tap()
        XCTAssertTrue(try self.waitForElementValue(allCards, identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, expectedValue: "0", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        allCards.tap()
        XCTAssertTrue(try self.waitForElementValue(allCards, identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, expectedValue: "1", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        self.attachPhoneScreenshot(name: "Duo native review filter unchanged draft")
        try self.dismissNativeReviewFilter()
        XCTAssertEqual(question.label, questionText, "An unchanged filter must preserve the selected card.")
        XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "An unchanged filter must preserve the revealed answer.")
        try self.tapButton(identifier: LiveSmokeIdentifier.reviewFilterMenu, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        XCTAssertTrue(try self.waitForElementValue(allCards, identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, expectedValue: "1", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds))
        try self.dismissNativeReviewFilter()
    }

    @MainActor
    private func dismissNativeReviewFilter() throws {
        let done = self.app.buttons["Done"].firstMatch
        let dismissRegion = self.app.otherElements[LiveSmokeIdentifier.popoverDismissRegion].firstMatch
        if done.exists && done.isHittable {
            done.tap()
        } else if dismissRegion.exists && dismissRegion.isHittable {
            dismissRegion.tap()
        } else {
            let surface = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.reviewFilterScrollSurface).firstMatch
            surface.swipeDown()
        }
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
    }

    @MainActor
    private func scrollAnswerAboveReviewAccessory(hasFixedAccessory: Bool = true) throws {
        let answer = self.app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Smoke guest manual review answer"))
            .firstMatch
        if !hasFixedAccessory {
            try self.scrollElementFullyIntoReviewViewport(answer, identifier: "revealed review answer")
            return
        }
        let scrollView = self.app.scrollViews.firstMatch
        let initialFrame = scrollView.frame
        let navigationBottom = self.app.navigationBars.firstMatch.frame.maxY
        let insetTop = scrollView.otherElements.allElementsBoundByIndex.map(\.frame)
            .filter { frame in
                abs(frame.width - initialFrame.width) <= 1
                    && abs(frame.maxY - initialFrame.maxY) <= 1
                    && frame.height < initialFrame.height
                    && frame.minY > navigationBottom
            }
            .map(\.minY).min()
        for attempt in 0...4 {
            let frame = scrollView.frame
            let top = max(frame.minY, navigationBottom) + 8
            let ratingTop = self.app.buttons["review.rating.0"].frame.minY
            let bottom = min(frame.maxY, insetTop ?? ratingTop, ratingTop) - 8
            if answer.exists && answer.isHittable && answer.frame.minY >= top && answer.frame.maxY <= bottom {
                return
            }
            if attempt < 4 && bottom - top > 40 {
                let origin = scrollView.coordinate(withNormalizedOffset: .zero)
                let start = origin.withOffset(CGVector(dx: frame.width / 2, dy: bottom - frame.minY))
                let end = origin.withOffset(CGVector(dx: frame.width / 2, dy: top - frame.minY))
                start.press(forDuration: 0.1, thenDragTo: end)
            }
        }
        throw LiveSmokeFailure.unexpectedReviewState(
            message: "The answer must be readable above the review accessory with largest phone text; answerFrame=\(answer.frame), insetTop=\(String(describing: insetTop)).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func scrollElementFullyIntoReviewViewport(_ element: XCUIElement, identifier: String) throws {
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
                self.attachPhoneScreenshot(name: "Inline review missing viewport track")
                self.add(self.makeTextAttachment(name: "Inline review missing track hierarchy", text: self.app.debugDescription))
                throw LiveSmokeFailure.unexpectedReviewState(
                    message: "The long inline review must expose a valid native vertical scroll track to measure its unobscured viewport.",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            // The native indicator track excludes some decorative button padding.
            // Use its measured bounds directly; text and a full touch target must fit.
            let top = max(track.minY, self.app.navigationBars.firstMatch.frame.maxY)
            let bottom = track.maxY
            let viewport = CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, bottom - top))
            let fullyReadable: Bool
            if element.elementType == .button {
                let labels: [XCUIElement] = element.staticTexts.allElementsBoundByIndex
                let visibleTarget = element.frame.intersection(viewport)
                fullyReadable = !labels.isEmpty
                    && labels.allSatisfy { viewport.contains($0.frame) }
                    && visibleTarget.width >= 44 && visibleTarget.height >= 44
            } else {
                fullyReadable = viewport.contains(element.frame)
            }
            if element.exists && element.isHittable && fullyReadable {
                return
            }
            if attempt < 6 && viewport.height > 40 {
                // Keep the gesture tied to the Review scene on Duo's active
                // display rather than SpringBoard's potentially inactive screen.
                let origin = scrollView.coordinate(withNormalizedOffset: .zero)
                let lower = origin.withOffset(CGVector(dx: frame.width / 2, dy: top + viewport.height * 0.85 - frame.minY))
                let upper = origin.withOffset(CGVector(dx: frame.width / 2, dy: top + viewport.height * 0.15 - frame.minY))
                if element.exists && element.frame.minY < top {
                    upper.press(forDuration: 0.1, thenDragTo: lower)
                } else {
                    lower.press(forDuration: 0.1, thenDragTo: upper)
                }
            }
        }
        self.attachPhoneScreenshot(name: "Inline review unreachable element \(identifier)")
        self.add(self.makeTextAttachment(name: "Inline review unreachable element hierarchy", text: self.app.debugDescription))
        throw LiveSmokeFailure.unexpectedReviewState(
            message: "The inline review element must be fully readable with a usable touch target in the native scroll viewport: \(identifier), frame=\(element.frame).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func attachPhoneScreenshot(name: String) {
        let captures = [("current app scene", self.app.screenshot())]
            + XCUIScreen.screens.enumerated().map { index, screen in
                ("active screen index \(index)", screen.screenshot())
            }
        for (label, screenshot) in captures {
            let image = screenshot.image
            let width = image.cgImage?.width ?? Int(image.size.width * image.scale)
            let height = image.cgImage?.height ?? Int(image.size.height * image.scale)
            let attachment = XCTAttachment(screenshot: screenshot)
            attachment.name = "\(name) — \(label), \(width)x\(height) pixels"
            attachment.lifetime = .keepAlways
            self.add(attachment)
        }
    }
}
