import UIKit
import XCTest

private let duoTransitionFront = "A Duo draft keeps its question, cursor, and answer while opening or closing the device.\nContinue studying."
private let duoTransitionBack = "Keep this longer answer unchanged across the outer, open, and partly folded displays. Read every line above the study controls.\nReturn to the same question, open its filter, and continue without losing the saved answer."

final class LiveSmokeIPhoneDuoTests: LiveSmokeTestCase {
    @MainActor
    func testDuoCompanionKeepsNativeTabsReachable() throws {
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]
        try XCTSkipUnless(model == "iPhone19,4", "This smoke requires the real iPhone Duo simulator type.")
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        // Keep the consent fixture stable across full AI tab preference refreshes.
        // The NO launch override is process-local.
        self.app.terminate()
        self.app.launchArguments += ["-ai-chat-external-provider-consent", "NO"]
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForUITestLaunchPreparation(
            launchScenario: .guestManualReviewCard,
            timeout: LiveSmokeConfiguration.launchPreparationTimeoutSeconds
        )
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
                try self.assertRevealedReviewWithCompanion()
                try self.selectDuoDestination(.progress)
                try self.assertScreenVisible(screen: .progress, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertVisibleCompanionConsentContent()
                try self.assertCompanionNavigationReachable()
                try self.tapButton(identifier: "ai.companion.toggle", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertCompanionConsentContentHidden()
                try self.tapButton(identifier: "ai.companion.toggle", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertVisibleCompanionConsentContent()
                try self.assertCompanionNavigationReachable()
                self.attachPhoneScreenshot(name: "Duo Progress companion with native navigation at the outer edge")
                try self.selectDuoDestination(.review)
                try self.assertRevealedReviewWithCompanion()
                try self.selectDuoDestination(.ai)
                try self.assertAiEntrySurfaceVisible()
                XCTAssertFalse(self.app.buttons["ai.companion.toggle"].exists)
                try self.selectDuoDestination(.settings)
                try self.assertScreenVisible(screen: .settings, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertCompanionConsentContentHidden(expectsOpener: false)
                XCTAssertFalse(self.app.buttons["ai.companion.toggle"].exists)
                try self.selectDuoDestination(.review)
                try self.assertRevealedReviewWithCompanion()
                self.attachPhoneScreenshot(name: "Duo companion preserved across Cards, Progress, AI and Settings")
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
    func testDuoReadyCompanionKeepsUnsentDraftAcrossHosts() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] == "iPhone19,4",
            "This smoke requires the real iPhone Duo simulator type."
        )
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        self.app.terminate()
        // Process-local consent on the disposable fixture; no consent tap or AI request.
        self.app.launchArguments += ["-ai-chat-external-provider-consent", "YES"]
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForUITestLaunchPreparation(
            launchScenario: .guestManualReviewCard,
            timeout: LiveSmokeConfiguration.launchPreparationTimeoutSeconds
        )
        let initialScene = try self.nativeHostWindowFrame()
        try XCTSkipUnless(
            initialScene.width > initialScene.height && min(initialScene.width, initialScene.height) >= 600,
            "Start this smoke on the actual Open landscape inner display."
        )
        let draft = "Keep this Duo chat draft unsent.\nReturn to the same revealed card."
        do {
            try self.step("retain an unsent companion draft with actual docked software key input") {
                if self.visibleCompanionPane != nil {
                    try self.tapButton(identifier: "ai.companion.toggle", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                }
                try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
                try self.waitForReviewAnswerReveal()
                try self.tapButton(identifier: "ai.companion.toggle", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.clearAndTypeAiComposerTextWithoutExactValueAssertion(draft, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    composer.value as? String == draft
                }, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) == .completed else {
                    throw LiveSmokeFailure.unexpectedAiConversationState(message: "The companion must hold the exact multiline unsent draft.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
                }
                let keyboard = self.app.keyboards.firstMatch
                let letter = keyboard.keys.matching(NSPredicate(format: "label IN %@", ["q", "Q"])).firstMatch
                let delete = keyboard.keys.matching(NSPredicate(format: "label IN %@", ["delete", "Delete", "backspace", "Backspace"])).firstMatch
                let visibleKeys = NSPredicate { _, _ in
                    guard let scene = self.nativeHostWindow?.frame else { return false }
                    return keyboard.exists && keyboard.frame.width >= scene.width * 0.65
                        && keyboard.frame.height > 100 && abs(keyboard.frame.maxY - scene.maxY) <= 1
                        && [letter, delete].allSatisfy { key in
                            key.exists && key.isHittable && key.frame.width > 0 && key.frame.height > 0
                                && scene.insetBy(dx: -1, dy: -1).contains(key.frame)
                        }
                }
                guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: visibleKeys, object: nil)], timeout: 10) == .completed else {
                    throw LiveSmokeFailure.unexpectedAiConversationState(message: "Require a docked software keyboard and actual reachable Q/Delete keys inside the active native window.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
                }
                let scene = try self.nativeHostWindowFrame()
                XCTAssertTrue(self.elementHasKeyboardFocus(element: composer))
                XCTAssertTrue(scene.contains(composer.frame))
                XCTAssertLessThanOrEqual(composer.frame.maxY, keyboard.frame.minY + 1)
                try self.assertCompanionNavigationReachable()
                for identifier in [LiveSmokeIdentifier.aiNewChatButton, "ai.companion.toggle"] {
                    let button = self.app.buttons[identifier].firstMatch
                    XCTAssertTrue(button.exists && button.isHittable && scene.contains(button.frame), "The companion control must remain reachable: \(identifier).")
                }
                letter.tap()
                let inserted = NSPredicate { _, _ in
                    let value = composer.value as? String
                    return value == draft + "q" || value == draft + "Q"
                }
                guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: inserted, object: nil)], timeout: 5) == .completed else {
                    throw LiveSmokeFailure.unexpectedAiConversationState(message: "Tapping the actual software Q key must append one character to the unsent draft.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
                }
                self.attachPhoneScreenshot(name: "Duo ready companion actual software Q input")
                delete.tap()
                guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    composer.value as? String == draft
                }, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) == .completed else {
                    throw LiveSmokeFailure.unexpectedAiConversationState(message: "Actual software Delete must restore the exact unsent draft.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
                }
                self.add(self.makeTextAttachment(name: "Duo ready companion software key restoration", text: "window=\(scene), keyboard=\(keyboard.frame), Q=\(letter.frame), Delete=\(delete.frame), draft=\(String(reflecting: composer.value as? String))"))
                self.attachPhoneScreenshot(name: "Duo ready companion exact draft restored with docked keyboard")
                try self.tapButton(identifier: LiveSmokeIdentifier.aiComposerDismissKeyboardButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                let hidden = NSPredicate { _, _ in !keyboard.exists }
                XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: hidden, object: nil)], timeout: 10), .completed, "Native Done must dismiss the software keyboard before switching hosts.")
            }
            try self.step("keep the same chat draft through Cards Progress and Review") {
                let destinations: [LiveSmokeSelectedTab] = [.cards, .progress, .review]
                for destination in destinations {
                    try self.selectDuoDestination(destination)
                    let selectedDestination = NSPredicate { _, _ in
                        self.app.descendants(matching: .any).matching(identifier: destination.itemIdentifier)
                            .allElementsBoundByIndex.contains { $0.exists && $0.isHittable && $0.isSelected }
                    }
                    guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: selectedDestination, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) == .completed else {
                        throw LiveSmokeFailure.unexpectedAiConversationState(message: "The actual native destination must become selected: \(destination).", screen: self.currentScreenSummary(), step: self.currentStepTitle)
                    }
                    try self.assertScreenVisible(screen: destination.screen, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                    let composer = try self.waitForAiComposerUsable(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                    XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                        composer.value as? String == draft
                    }, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds), .completed, "The exact raw multiline draft must survive the destination change.")
                    let visibleComposers = self.app.textFields.matching(identifier: LiveSmokeIdentifier.aiComposerTextField).allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
                    XCTAssertEqual(visibleComposers.count, 1, "Only the current host may expose the companion composer.")
                    XCTAssertEqual(self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.aiMessageRow).count, 0, "This local smoke must leave the draft unsent.")
                    try self.assertCompanionNavigationReachable()
                    self.attachPhoneScreenshot(name: "Duo ready companion draft on \(destination)")
                }
                try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists)
                for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
                    XCTAssertTrue(self.app.buttons[identifier].isHittable, "Returning to Review must retain reachable ratings: \(identifier).")
                }
            }
        } catch {
            self.attachPhoneScreenshot(name: "Duo ready companion failure")
            self.attachCompanionGeometryDiagnostics()
            self.add(self.makeTextAttachment(name: "Duo ready companion failure hierarchy", text: self.app.debugDescription))
            throw error
        }
    }

    @MainActor
    private func assertRevealedReviewWithCompanion() throws {
        try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        guard !self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists else {
            throw LiveSmokeFailure.unexpectedReviewState(message: "Returning to Review must keep the same card revealed.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
        }
        try self.assertVisibleCompanionConsentContent()
        try self.assertCompanionNavigationReachable()
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
        let identifiers = [LiveSmokeIdentifier.cardEditorScreen, LiveSmokeIdentifier.reviewScreen, LiveSmokeIdentifier.cardsScreen, LiveSmokeIdentifier.progressScreen, LiveSmokeIdentifier.aiScreen, LiveSmokeIdentifier.settingsScreen]
        for identifier in identifiers {
            let windows = self.app.windows.containing(.any, identifier: identifier).allElementsBoundByIndex
            if let window = windows.first(where: { window in
                guard window.exists else { return false }
                let frame = window.frame
                guard frame.minX.isFinite && frame.minY.isFinite,
                      frame.width.isFinite && frame.height.isFinite,
                      frame.width > 0 && frame.height > 0 else { return false }
                return window.isHittable
            }) {
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
    private func assertCompanionConsentContentHidden(expectsOpener: Bool = true) throws {
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            let toggle = self.app.buttons["ai.companion.toggle"].firstMatch
            if self.visibleCompanionPane == nil && (expectsOpener ? toggle.exists && toggle.isHittable : toggle.exists == false) { return }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
        }
        throw LiveSmokeFailure.unexpectedReviewState(message: "The single main toggle must hide the companion consent content.", screen: self.currentScreenSummary(), step: self.currentStepTitle)
    }

    @MainActor
    private func assertCompanionNavigationReachable() throws {
        let destinations: [LiveSmokeSelectedTab] = [.review, .progress, .ai, .cards, .settings]
        let destinationIdentifiers = destinations.map { $0.tabBarItemLookup(localization: self.currentLaunchLocalization).identifier }
        let identifiers = ["ai.companion.toggle"] + destinationIdentifiers
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        var missingIdentifiers = identifiers
        var geometryViolations: [String] = []
        var toggleCount = 0
        while Date() < deadline {
            missingIdentifiers = []
            geometryViolations = []
            let scene = self.nativeHostWindow?.frame
            let pane = self.visibleCompanionPane
            let contentFrame = pane.flatMap { self.visibleCompanionContentFrame(in: $0) }
            if scene == nil || contentFrame == nil {
                geometryViolations.append("Missing visible native window or companion content.")
            }
            if let scene, let pane {
                if scene.width <= scene.height
                    || abs(pane.frame.minX - scene.minX) > 1
                    || abs(pane.frame.maxX - scene.midX) > 1 {
                    geometryViolations.append("Left companion=\(self.preciseFrame(pane.frame)) must end at the unfolded landscape window midpoint=\(scene.midX).")
                }
                let answer = self.app.staticTexts["Smoke guest manual review answer"].firstMatch
                if answer.exists && (answer.frame.minX < scene.midX - 1 || !answer.isHittable) {
                    geometryViolations.append("Revealed answer=\(self.preciseFrame(answer.frame)) must remain readable on the right of the split.")
                }
            }
            for identifier in identifiers {
                let buttons = self.app.buttons.matching(identifier: identifier).allElementsBoundByIndex
                if identifier == "ai.companion.toggle" { toggleCount = buttons.count }
                guard let button = buttons.first(where: { $0.exists && $0.isHittable }) else {
                    missingIdentifiers.append(identifier)
                    continue
                }
                if identifier != "ai.companion.toggle", let scene, let contentFrame {
                    let frame = button.frame
                    // Duo's hardware-aligned navigation stays on the physical right,
                    // outside chat, including when the content language is right-to-left.
                    if !scene.insetBy(dx: -1, dy: -1).contains(frame)
                        || frame.minX < contentFrame.maxX - 1
                        || frame.midX <= scene.midX {
                        geometryViolations.append("\(identifier) frame=\(self.preciseFrame(frame)) must be within window=\(self.preciseFrame(scene)) and to the right of visible chat content=\(self.preciseFrame(contentFrame)).")
                    }
                }
            }
            if missingIdentifiers.isEmpty && geometryViolations.isEmpty && toggleCount == 1 { return }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
        }
        throw LiveSmokeFailure.unexpectedReviewState(
            message: "The open companion must leave its single main toggle reachable and all native destinations in the outer right region; missing=\(missingIdentifiers), toggleCount=\(toggleCount), geometry=\(geometryViolations).",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func visibleCompanionContentFrame(in pane: XCUIElement) -> CGRect? {
        // The companion scroll view extends beneath system bars; its
        // readable text and controls respect the safe area inside those bounds.
        let contentTypes: [XCUIElement.ElementType] = [.staticText, .button, .link, .textField, .secureTextField, .textView]
        let viewport = pane.frame
        var contentFrame = CGRect.null
        for type in contentTypes {
            for element in pane.descendants(matching: type).allElementsBoundByIndex where element.exists {
                let frame = element.frame
                // Include obscured semantics too, so content behind the rail fails.
                if frame.width > 0 && frame.height > 0 && frame.intersects(viewport) {
                    contentFrame = contentFrame.union(frame)
                }
            }
        }
        return contentFrame.isNull ? nil : contentFrame
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
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .cards)
        try self.openFirstCardForEditing()
        try self.setDuoTransitionAnswer()
        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.replaceTextSafely(duoTransitionFront, inElementWithIdentifier: LiveSmokeIdentifier.cardEditorFrontTextEditor, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        try self.tapEditorBack()
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.selectDuoDestination(.review)

        try self.step("preserve a revealed card through native partial folding and landscape rotation") {
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            try self.assertTextExists(duoTransitionBack, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
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
                try self.assertTextExists(duoTransitionBack, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
                XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "The same card must remain revealed after the native pose change.")
                for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
                    XCTAssertTrue(self.app.buttons[identifier].isHittable, "Every rating must remain reachable in the partial pose: \(identifier).")
                }
                try self.scrollAnswerAboveReviewAccessory(answerText: duoTransitionBack)
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
        let draft = duoTransitionFront

        try self.step("retain an unsaved keyboard draft during a native Duo display transition") {
            try self.openFirstCardForEditing()
            try self.setDuoTransitionAnswer()
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
            try self.assertTextExists(duoTransitionBack, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists, "The same revealed card must stay revealed across displays.")
            for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
                XCTAssertTrue(self.app.buttons[identifier].isHittable, "Every rating must remain reachable after the Duo display transition: \(identifier).")
            }
            try self.scrollAnswerAboveReviewAccessory(answerText: duoTransitionBack)
            self.attachPhoneScreenshot(name: "Duo readable answer after native display transition")
            try self.roundtripUnchangedReviewFilter()
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.assertTextExists("Nothing Due", timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        }
    }

    @MainActor
    private func setDuoTransitionAnswer() throws {
        try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.cardEditorBackRow, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.replaceTextSafely(duoTransitionBack, inElementWithIdentifier: LiveSmokeIdentifier.cardEditorBackTextEditor, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        let editor = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.cardEditorBackTextEditor).firstMatch
        XCTAssertEqual(editor.value as? String, duoTransitionBack, "Both native transition tests must use the identical exact long answer.")
        try self.tapEditorBack()
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
    private func scrollAnswerAboveReviewAccessory(hasFixedAccessory: Bool = true, answerText: String = "Smoke guest manual review answer") throws {
        let answer = self.app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", answerText))
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
