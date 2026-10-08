import UIKit
import XCTest

final class LiveSmokeOrdinaryIPhoneTests: LiveSmokeTestCase {
    @MainActor
    func testOrdinaryPhoneReviewAIHandoffPreservesPortraitOrientation() throws {
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]
        try XCTSkipUnless(
            UIDevice.current.userInterfaceIdiom == .phone && model?.hasPrefix("iPhone") == true && model != "iPhone19,4",
            "Run this smoke on an actual ordinary iPhone simulator type."
        )
        try self.runPortraitReviewHandoffAndRotationRequest(requiresSmallWindow: false)
    }

    @MainActor
    func testDuoSmallWindowUsesFullScreenAIHandoffAcrossRotation() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] == "iPhone19,4",
            "Run this small-window smoke on the actual iPhone Duo simulator type."
        )
        try self.runPortraitReviewHandoffAndRotationRequest(requiresSmallWindow: true)
    }

    @MainActor
    private func runPortraitReviewHandoffAndRotationRequest(requiresSmallWindow: Bool) throws {
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)
        // NSArgumentDomain supplies consent only to this disposable fixture
        // process; the test does not accept or persist a person's consent.
        self.app.terminate()
        self.app.launchArguments += ["-ai-chat-external-provider-consent", "YES"]
        self.app.launch()
        try self.waitForApplicationToReachForeground(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.waitForUITestLaunchPreparation(launchScenario: .guestManualReviewCard, timeout: LiveSmokeConfiguration.launchPreparationTimeoutSeconds)
        if requiresSmallWindow {
            guard let window = self.hostWindow(screenIdentifier: LiveSmokeIdentifier.reviewScreen) else {
                throw self.phoneStateFailure("The small-window smoke requires an actual visible native Review window.")
            }
            try XCTSkipUnless(
                min(window.frame.width, window.frame.height) < 600,
                "The Duo small-window smoke requires a native window with a short side below 600 points; this does not identify a physical fold state."
            )
            self.attachPhoneState(name: "Duo actual small window before handoff")
        }

        do {
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
            try self.waitForReviewAnswerReveal()
            try self.step("phone window keeps the same revealed card and full-screen AI in portrait") {
                try self.assertRevealedReviewUsesPhoneViewport()
                self.attachPhoneState(name: "Phone window portrait revealed Review")
                try self.tapReviewAIInMeasuredScrollViewport()
                try self.assertScreenVisible(screen: .ai, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerTextField, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
                try self.assertFullScreenCardAttachment()
                try self.assertPortraitPhoneWindow(screenIdentifier: LiveSmokeIdentifier.aiScreen)
                try self.assertFocusedAIComposer()
                self.attachPhoneState(name: "Phone window portrait full-screen AI card handoff with keyboard")
                try self.dismissAIKeyboardIfVisible()
                try self.assertFullScreenCardAttachment()
                try self.assertReadableEmptyAITranscript()
                try self.assertPortraitPhoneWindow(screenIdentifier: LiveSmokeIdentifier.aiScreen)
                self.attachPhoneState(name: "Phone window portrait readable full-screen AI after Done")
                try self.selectReviewDestination()
                try self.assertRevealedReviewUsesPhoneViewport()
                self.attachPhoneState(name: "Phone window portrait preserved Review after AI")
            }
            try self.step("declared portrait phone window survives a native landscape rotation request") {
                try self.assertPortraitPhoneWindow(screenIdentifier: LiveSmokeIdentifier.reviewScreen)
                guard let before = self.hostWindow(screenIdentifier: LiveSmokeIdentifier.reviewScreen)?.frame else {
                    throw self.phoneStateFailure("The native Review window must exist before requesting landscape device orientation.")
                }
                XCUIDevice.shared.orientation = .landscapeLeft
                self.attachPhoneState(name: "Phone native landscape request with portrait-only declaration")
                var lastFrame: CGRect?
                var stableSince = Date()
                let portraitRetained = NSPredicate { _, _ in
                    guard XCUIDevice.shared.orientation == .landscapeLeft,
                          let frame = self.hostWindow(screenIdentifier: LiveSmokeIdentifier.reviewScreen)?.frame,
                          frame.height > frame.width else {
                        lastFrame = nil
                        return false
                    }
                    if lastFrame != frame {
                        lastFrame = frame
                        stableSince = Date()
                        return false
                    }
                    return Date().timeIntervalSince(stableSince) >= 0.5
                }
                guard XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: portraitRetained, object: nil)], timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) == .completed,
                      let after = self.hostWindow(screenIdentifier: LiveSmokeIdentifier.reviewScreen)?.frame else {
                    throw self.phoneStateFailure("The actual native device must receive the landscape request while its declared portrait-only Review window remains portrait.")
                }
                XCTAssertEqual(after.width, before.width, accuracy: 1)
                XCTAssertEqual(after.height, before.height, accuracy: 1)
                try self.assertRevealedReviewUsesPhoneViewport()
                self.attachPhoneState(name: "Phone native landscape device orientation retains portrait Review window and ratings")
            }
        } catch {
            self.attachPhoneState(name: "Phone window handoff failure")
            self.add(self.makeTextAttachment(name: "Phone window handoff failure hierarchy", text: self.app.debugDescription))
            throw error
        }
    }

    @MainActor
    private func assertPortraitPhoneWindow(screenIdentifier: String) throws {
        guard let frame = self.hostWindow(screenIdentifier: screenIdentifier)?.frame,
              frame.height > frame.width else {
            throw self.phoneStateFailure("The declared portrait-only phone must expose an actual portrait native window on \(screenIdentifier).")
        }
    }

    @MainActor
    private func assertRevealedReviewUsesPhoneViewport() throws {
        try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists(LiveSmokeLaunchFixtureData.manualReviewFrontText, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertTextExists("Smoke guest manual review answer", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        try self.assertElementDoesNotExist(identifier: "ai.companion.toggle", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        guard !self.app.buttons[LiveSmokeIdentifier.reviewShowAnswerButton].exists,
              self.visibleAISurfaces.isEmpty else {
            throw self.phoneStateFailure("Review must keep the exact card revealed without any visible AI pane.")
        }
        let review = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.reviewScreen).firstMatch
        let viewport = review.elementType == .scrollView ? review : review.scrollViews.firstMatch
        try self.assertBroadNativeViewport(viewport, screenIdentifier: LiveSmokeIdentifier.reviewScreen)
        guard let window = self.hostWindow(screenIdentifier: LiveSmokeIdentifier.reviewScreen),
              window.frame.height > window.frame.width else {
            throw self.phoneStateFailure("The actual native Review window must remain portrait.")
        }
        for identifier in ["review.rating.0", "review.rating.1", LiveSmokeIdentifier.reviewRateGoodButton, "review.rating.3"] {
            let button = self.app.buttons[identifier].firstMatch
            guard button.exists && button.isHittable else {
                throw self.phoneStateFailure("Every rating must remain reachable after phone handoff: \(identifier).")
            }
        }
    }

    @MainActor
    private func assertFullScreenCardAttachment() throws {
        try self.assertElementDoesNotExist(identifier: "ai.companion.toggle", timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        // ContentUnavailableView adds an overlaid native ScrollView to the
        // empty List. The actual transcript is the single CollectionView.
        let transcripts = self.visibleAITranscripts
        guard transcripts.count == 1,
              !self.app.buttons[LiveSmokeIdentifier.aiConsentAcceptButton].exists else {
            throw self.phoneStateFailure("The local consent fixture must expose exactly one full-screen AI surface.")
        }
        let aiTabIdentifier = LiveSmokeSelectedTab.ai.tabBarItemLookup(localization: self.currentLaunchLocalization).identifier
        guard self.app.buttons.matching(identifier: aiTabIdentifier).allElementsBoundByIndex.contains(where: { $0.exists && $0.isSelected }) else {
            throw self.phoneStateFailure("The full-screen card handoff must select the actual native AI tab.")
        }
        try self.assertBroadNativeViewport(transcripts[0], screenIdentifier: LiveSmokeIdentifier.aiScreen)
        let chips = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip)
        try self.assertElementExists(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip, timeout: LiveSmokeConfiguration.longUiTimeoutSeconds)
        guard chips.count == 1, chips.firstMatch.isHittable,
              chips.firstMatch.label == "Card · \(LiveSmokeLaunchFixtureData.manualReviewFrontText)",
              self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.aiMessageRow).count == 0 else {
            throw self.phoneStateFailure("AI must attach exactly the reviewed card, with no duplicate attachment or sent message.")
        }
    }

    @MainActor
    private func assertBroadNativeViewport(_ viewport: XCUIElement, screenIdentifier: String) throws {
        guard let window = self.hostWindow(screenIdentifier: screenIdentifier), viewport.exists && viewport.isHittable else {
            throw self.phoneStateFailure("A visible native host window and viewport are required.")
        }
        let frame = viewport.frame
        // Allow native camera and navigation safe areas while detecting any
        // reserved companion column in the actual phone window.
        guard window.frame.insetBy(dx: -1, dy: -1).contains(frame), frame.width >= window.frame.width * 0.75 else {
            throw self.phoneStateFailure("Phone content must use its native viewport without a reserved chat column; window=\(window.frame), viewport=\(frame).")
        }
    }

    @MainActor
    private func hostWindow(screenIdentifier: String) -> XCUIElement? {
        self.app.windows.containing(.any, identifier: screenIdentifier).allElementsBoundByIndex.first {
            $0.exists && $0.isHittable && $0.frame.width > 0 && $0.frame.height > 0
        }
    }

    @MainActor
    private var visibleAISurfaces: [XCUIElement] {
        // The screen ID can be inherited by native title/status text. Count
        // actual transcript/consent viewports rather than those semantic leaves.
        let viewports = self.app.collectionViews.matching(identifier: LiveSmokeIdentifier.aiScreen).allElementsBoundByIndex
            + self.app.scrollViews.matching(identifier: LiveSmokeIdentifier.aiScreen).allElementsBoundByIndex
        return viewports.filter {
            $0.exists && $0.isHittable && $0.frame.width > 0 && $0.frame.height > 0
        }
    }

    @MainActor
    private var visibleAITranscripts: [XCUIElement] {
        self.app.collectionViews.matching(identifier: LiveSmokeIdentifier.aiScreen).allElementsBoundByIndex.filter {
            $0.exists && $0.isHittable && $0.frame.width > 0 && $0.frame.height > 0
        }
    }

    @MainActor
    private func assertFocusedAIComposer() throws {
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            let composer = self.app.textFields[LiveSmokeIdentifier.aiComposerTextField].firstMatch
            let done = self.app.buttons[LiveSmokeIdentifier.aiComposerDismissKeyboardButton].firstMatch
            var nativeKeyboardVisible = false
            if let window = self.hostWindow(screenIdentifier: LiveSmokeIdentifier.aiScreen) {
                let keyboard = self.app.keyboards.firstMatch
                let q = keyboard.keys.matching(NSPredicate(format: "label IN %@", ["q", "Q"])).firstMatch
                nativeKeyboardVisible = keyboard.exists && keyboard.frame.height > 100 && keyboard.frame.width > 100
                    && q.exists && q.isHittable && q.frame.width > 0 && q.frame.height > 0 && window.frame.contains(q.frame)
                    && done.exists && done.frame.width > 0 && done.frame.height > 0 && window.frame.contains(done.frame)
            }
            if self.softwareKeyboardIsVisible(), nativeKeyboardVisible, composer.exists && composer.isHittable,
               self.elementHasKeyboardFocus(element: composer), done.exists && done.isHittable { return }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
        }
        throw self.phoneStateFailure("The card handoff must focus the composer with a visible software keyboard and hittable native Done action.")
    }

    @MainActor
    private func assertReadableEmptyAITranscript() throws {
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            if let transcript = self.visibleAITranscripts.first,
               self.app.navigationBars.firstMatch.exists {
                let title = self.app.staticTexts["Start a new AI chat"].firstMatch
                let explanation = self.app.staticTexts["Ask about cards, review history, or attach notes for extraction."].firstMatch
                let chip = self.app.descendants(matching: .any).matching(identifier: LiveSmokeIdentifier.aiComposerCardAttachmentChip).firstMatch
                if title.exists && explanation.exists && chip.exists {
                    let frame = transcript.frame
                    let trackFrames: [CGRect] = transcript.otherElements.matching(NSPredicate(
                        format: "label BEGINSWITH %@", "Vertical scroll bar"
                    )).allElementsBoundByIndex.map { $0.frame }
                    let tracks: [CGRect] = trackFrames.filter {
                        $0.width > 0 && $0.width <= 44 && $0.height > 40
                            && $0.minY >= frame.minY - 1 && $0.maxY <= frame.maxY + 1
                    }
                    let track: CGRect? = tracks.max { $0.height < $1.height }
                    let top = max(frame.minY, self.app.navigationBars.firstMatch.frame.maxY, track?.minY ?? frame.minY)
                    let bottom = min(frame.maxY, chip.frame.minY, track?.maxY ?? frame.maxY)
                    let readingArea = CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, bottom - top))
                    if !self.softwareKeyboardIsVisible(), title.isHittable && explanation.isHittable,
                       readingArea.contains(title.frame) && readingArea.contains(explanation.frame) { return }
                }
            }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
        }
        throw self.phoneStateFailure("After native Done, the full empty-chat title and explanation must be readable inside the native transcript above the attached card.")
    }

    @MainActor
    private func tapReviewAIInMeasuredScrollViewport() throws {
        let scrollView = self.app.scrollViews[LiveSmokeIdentifier.reviewScreen].firstMatch
        let button = self.app.buttons[LiveSmokeIdentifier.reviewAiButton].firstMatch
        for attempt in 0...6 {
            guard scrollView.exists, button.exists,
                  self.app.navigationBars.firstMatch.exists,
                  self.app.buttons["review.rating.0"].exists else {
                throw self.phoneStateFailure("Review must expose its native scroll viewport, navigation bar, ratings, and AI action.")
            }
            let frame = scrollView.frame
            let trackElements: [XCUIElement] = scrollView.otherElements.matching(NSPredicate(
                format: "label BEGINSWITH %@", "Vertical scroll bar"
            )).allElementsBoundByIndex
            let trackFrames: [CGRect] = trackElements.map { $0.frame }
            let validTracks: [CGRect] = trackFrames.filter { track in
                track.width > 0 && track.width <= 44 && track.height > 40
                    && track.minY >= frame.minY - 1 && track.maxY <= frame.maxY + 1
            }
            let track: CGRect? = validTracks.max { $0.height < $1.height }
            let top = max(frame.minY, self.app.navigationBars.firstMatch.frame.maxY, track?.minY ?? frame.minY)
            let bottom = min(frame.maxY, self.app.buttons["review.rating.0"].frame.minY, track?.maxY ?? frame.maxY)
            let viewport = CGRect(x: frame.minX, y: top, width: frame.width, height: max(0, bottom - top))
            if button.isHittable && viewport.contains(button.frame) {
                button.tap()
                return
            }
            guard attempt < 6 && viewport.height > 44 else { break }
            // The scroll view's AX frame includes native bars and fixed ratings.
            // Keep both ends inside the measured reading area so the gesture
            // scrolls the card instead of beginning on the rating accessory.
            let origin = scrollView.coordinate(withNormalizedOffset: .zero)
            let lower = origin.withOffset(CGVector(dx: frame.width / 2, dy: top + viewport.height * 0.85 - frame.minY))
            let upper = origin.withOffset(CGVector(dx: frame.width / 2, dy: top + viewport.height * 0.15 - frame.minY))
            if button.frame.minY < top {
                upper.press(forDuration: 0.1, thenDragTo: lower)
            } else {
                lower.press(forDuration: 0.1, thenDragTo: upper)
            }
        }
        throw self.phoneStateFailure("The Review AI action must be fully inside the native reading viewport and hittable before handoff; action=\(button.frame).")
    }

    @MainActor
    private func dismissAIKeyboardIfVisible() throws {
        if self.softwareKeyboardIsVisible() {
            try self.tapButton(identifier: LiveSmokeIdentifier.aiComposerDismissKeyboardButton, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            guard self.app.keyboards.firstMatch.waitForNonExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) else {
                throw self.phoneStateFailure("Native Done must hide the software keyboard before selecting Review.")
            }
        }
    }

    @MainActor
    private func selectReviewDestination() throws {
        try self.dismissAIKeyboardIfVisible()
        let lookup = LiveSmokeSelectedTab.review.tabBarItemLookup(localization: self.currentLaunchLocalization)
        if let button = self.app.buttons.matching(identifier: lookup.identifier).allElementsBoundByIndex.first(where: { $0.exists && $0.isHittable }) {
            button.tap()
        } else {
            try self.tapTabBarItem(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }
    }

    @MainActor
    private func phoneStateFailure(_ message: String) -> LiveSmokeFailure {
        .unexpectedReviewState(message: message, screen: self.currentScreenSummary(), step: self.currentStepTitle)
    }

    @MainActor
    private func attachPhoneState(name: String) {
        for (index, screen) in XCUIScreen.screens.enumerated() {
            let attachment = XCTAttachment(screenshot: screen.screenshot())
            attachment.name = "\(name), native screen \(index)"
            attachment.lifetime = .keepAlways
            self.add(attachment)
        }
        let identifiers = [LiveSmokeIdentifier.reviewScreen, LiveSmokeIdentifier.aiScreen, "ai.companion.toggle", LiveSmokeIdentifier.aiComposerCardAttachmentChip]
        var lines = ["deviceOrientation=\(String(describing: XCUIDevice.shared.orientation)), rawValue=\(XCUIDevice.shared.orientation.rawValue)", "appFrame=\(self.app.frame)"]
        for identifier in identifiers {
            let elements = self.app.descendants(matching: .any).matching(identifier: identifier).allElementsBoundByIndex
            lines.append("\(identifier) count=\(elements.count)")
            for element in elements where element.exists {
                lines.append("type=\(element.elementType.rawValue) hittable=\(element.isHittable) frame=\(element.frame) label=\(element.label)")
            }
            if let window = self.hostWindow(screenIdentifier: identifier) { lines.append("nativeWindow=\(window.frame)") }
        }
        self.add(self.makeTextAttachment(name: "\(name) native geometry", text: lines.joined(separator: "\n")))
    }
}
