import UIKit
import XCTest

private enum ReviewFilterToggleValue: String {
    case off = "0"
    case on = "1"
}

final class LiveSmokeReviewTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeInlineMathCardReviewFlow() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .phone, "This smoke requires an iPhone.")
        XCUIDevice.shared.orientation = .portrait
        let front = #"已知合力 $F=ma$，且加速度 $a=\frac{\Delta v}{\Delta t}$，如何求速度變化？"#
        let back = #"若合力固定，則 $a=\frac{F}{m}$，因此 $\Delta v=\frac{F}{m}\Delta t$。"#
        let nextFront = "What is momentum?"
        let timeout = LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
        try self.launchApplication(launchScenario: .guestEmptyWorkspace, selectedTab: .cards)

        try self.step("create a card with inline formulas and a following card in the guest workspace") {
            try self.tapButton(identifier: LiveSmokeIdentifier.cardsAddButton, timeout: timeout)
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: timeout)
            UIPasteboard.general.string = front
            try self.pasteReviewSmokeText(front, into: LiveSmokeIdentifier.cardEditorFrontTextEditor)
            try self.tapFirstNavigationBackButton()
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorBackRow, timeout: timeout)
            UIPasteboard.general.string = back
            try self.pasteReviewSmokeText(back, into: LiveSmokeIdentifier.cardEditorBackTextEditor)
            try self.tapFirstNavigationBackButton()
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorSaveButton, timeout: timeout)
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.cardEditorScreen, timeout: timeout)
            try self.createManualCard(frontText: nextFront, backText: "Mass times velocity.")
            try self.tapTabBarItem(selectedTab: .review, timeout: timeout)
        }

        try self.step("read the front formulas in order and copy the selected source") {
            let identifier = LiveSmokeIdentifier.reviewFrontSelectableText
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: timeout)
            try self.assertReviewInlineMathContent(
                ["已知合力", "F=ma", "，且加速度", #"a=\frac{\Delta v}{\Delta t}"#, "，如何求速度變化？"],
                identifier: identifier
            )
            self.app.staticTexts.matching(identifier: identifier).firstMatch.press(forDuration: 0.8)
            self.app.typeKey("a", modifierFlags: .command)
            self.app.typeKey("c", modifierFlags: .command)

            try self.tapButtonScrollingIntoView(identifier: LiveSmokeIdentifier.reviewEditCardButton, timeout: timeout)
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorBackRow, timeout: timeout)
            try self.pasteReviewSmokeText(front, into: LiveSmokeIdentifier.cardEditorBackTextEditor)
            try self.tapFirstNavigationBackButton()
            try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorCancelButton, timeout: timeout)
            try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.cardEditorScreen, timeout: timeout)
        }

        try self.step("reveal the answer and advance to the next card") {
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: timeout)
            try self.waitForReviewAnswerReveal()
            try self.assertReviewInlineMathContent(
                ["若合力固定，則", #"a=\frac{F}{m}"#, "，因此", #"\Delta v=\frac{F}{m}\Delta t"#, "。"],
                identifier: LiveSmokeIdentifier.reviewBackSelectableText
            )
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: timeout)
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: timeout)
            try self.assertTextExists(nextFront, timeout: timeout)
        }
    }

    @MainActor
    private func pasteReviewSmokeText(_ expected: String, into identifier: String) throws {
        let timeout = LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
        let editor = self.element(identifier: identifier)
        try self.focusElementForTextInput(editor, identifier: identifier, timeout: timeout)
        self.app.typeKey("a", modifierFlags: .command)
        self.app.typeKey("v", modifierFlags: .command)
        let pasted = try self.waitForElementValue(editor, identifier: identifier, expectedValue: expected, timeout: timeout)
        XCTAssertTrue(pasted, "Expected the original source in '\(identifier)', found '\(self.elementValue(element: editor))'.")
    }

    @MainActor
    private func assertReviewInlineMathContent(_ expectedLabels: [String], identifier: String) throws {
        try self.assertElementExists(identifier: identifier, timeout: LiveSmokeConfiguration.reviewInteractionTimeoutSeconds)
        let labels = self.app.staticTexts.matching(identifier: identifier).allElementsBoundByIndex.map {
            $0.label.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        // The fallback keeps the formula label and appends a rendering warning to the prose.
        XCTAssertEqual(labels, expectedLabels, "Expected '\(identifier)' in reading order without a rendering warning.")
    }

    @MainActor
    func testLiveSmokeManualCardReviewFlow() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)

        let timeout = LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
        try self.step("open the current card from Front Edit") {
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
            XCTAssertFalse(self.app.buttons[LiveSmokeIdentifier.reviewEditBackCardButton].exists)
            try self.assertManualReviewCardEditor(editButtonIdentifier: LiveSmokeIdentifier.reviewEditCardButton)
        }

        try self.step("reveal and open the same card from Back Edit") {
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewShowAnswerButton, timeout: timeout)
            try self.waitForReviewAnswerReveal()
            try self.assertElementExists(identifier: LiveSmokeIdentifier.reviewAiButton, timeout: timeout)
            try self.assertManualReviewCardEditor(editButtonIdentifier: LiveSmokeIdentifier.reviewEditBackCardButton)
        }

        try self.step("rate the guest manual card") {
            try self.tapButton(identifier: LiveSmokeIdentifier.reviewRateGoodButton, timeout: timeout)
        }
    }

    @MainActor
    private func assertManualReviewCardEditor(editButtonIdentifier: String) throws {
        let timeout = LiveSmokeConfiguration.reviewInteractionTimeoutSeconds
        try self.tapButtonScrollingIntoView(identifier: editButtonIdentifier, timeout: timeout)
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorFrontRow, timeout: timeout)
        let editor = self.element(identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor)
        let expectedFront = LiveSmokeLaunchFixtureData.manualReviewFrontText
        let hasExpectedFront = try self.waitForElementValue(
            editor,
            identifier: LiveSmokeIdentifier.cardEditorFrontTextEditor,
            expectedValue: expectedFront,
            timeout: timeout
        )
        XCTAssertTrue(hasExpectedFront, "Review Edit should open the current card with front '\(expectedFront)'.")
        try self.tapFirstNavigationBackButton()
        try self.tapButton(identifier: LiveSmokeIdentifier.cardEditorCancelButton, timeout: timeout)
        try self.assertElementDoesNotExist(identifier: LiveSmokeIdentifier.cardEditorScreen, timeout: timeout)
    }

    @MainActor
    func testLiveSmokeGuestAiCardReviewFlow() throws {
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .review)

        try self.step("open Library Tags from the review card's tag button") {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewCardTagsButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.tagsScreen,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.tapTabBarItem(selectedTab: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
            try self.assertScreenVisible(screen: .review, timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds)
        }

        try self.step("review the guest AI card") {
            try self.reviewCurrentCard(
                expectedFrontText: LiveSmokeLaunchFixtureData.aiReviewFrontText
            )
        }
    }

    @MainActor
    func testLiveSmokeReviewFilterMenuNeverEmptiesAndClosesOnAllCards() throws {
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .review)
        let tagToggleIdentifier = LiveSmokeIdentifier.reviewFilterTagTogglePrefix + "smoke-guest-ai-review"
        let lowerTagToggleIdentifier = LiveSmokeIdentifier.reviewFilterTagTogglePrefix + "smoke-overflow-12"
        let secondLowerTagToggleIdentifier = LiveSmokeIdentifier.reviewFilterTagTogglePrefix + "smoke-overflow-11"

        try self.step("keep a lower review filter row visible after changing its draft selection") {
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewFilterMenu,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: tagToggleIdentifier,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.tapReviewFilterButtonScrollingIntoView(identifier: lowerTagToggleIdentifier)
            try self.assertReviewFilterToggleValue(
                identifier: lowerTagToggleIdentifier,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            let lowerTagToggle = self.app.buttons[lowerTagToggleIdentifier].firstMatch
            guard lowerTagToggle.isHittable else {
                throw LiveSmokeFailure.unexpectedReviewState(
                    message: "The toggled lower review filter row moved out of view.",
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            try self.tapReviewFilterButtonScrollingIntoView(identifier: secondLowerTagToggleIdentifier)
            try self.assertReviewFilterToggleValue(
                identifier: secondLowerTagToggleIdentifier,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: lowerTagToggleIdentifier,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            lowerTagToggle.clickOrTap()
            try self.assertReviewFilterToggleValue(
                identifier: lowerTagToggleIdentifier,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: secondLowerTagToggleIdentifier,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }

        try self.step("select all cards when the last selected tag is removed, without dismissing the menu") {
            try self.tapReviewFilterButtonScrollingIntoView(identifier: secondLowerTagToggleIdentifier)
            try self.assertReviewFilterToggleValue(
                identifier: secondLowerTagToggleIdentifier,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.scrollReviewFilterToTop()
            try self.assertReviewFilterToggleValue(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }

        try self.step("keep all cards and close the menu when the selected all cards row is tapped") {
            self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle)
                .firstMatch
                .clickOrTap()
            try self.assertElementDoesNotExist(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
        }

        try self.step("select one review tag without dismissing the menu") {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewFilterMenu,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: tagToggleIdentifier,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )

            self.app.descendants(matching: .any).matching(identifier: tagToggleIdentifier).firstMatch.clickOrTap()

            try self.assertReviewFilterToggleValue(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: tagToggleIdentifier,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }

        try self.step("verify the tagged card returns after dismissing the menu") {
            try self.dismissReviewFilterPopoverWithOutsideTap()
            try self.assertElementDoesNotExist(
                identifier: tagToggleIdentifier,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
        }

        try self.step("apply all cards and close the menu at once") {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewFilterMenu,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: tagToggleIdentifier,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle)
                .firstMatch
                .clickOrTap()

            try self.assertElementDoesNotExist(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertElementExists(
                identifier: LiveSmokeIdentifier.reviewShowAnswerButton,
                timeout: LiveSmokeConfiguration.reviewInitialProbeTimeoutSeconds
            )
        }

        try self.step("verify all cards is selected after reopening the menu") {
            try self.tapButton(
                identifier: LiveSmokeIdentifier.reviewFilterMenu,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                expectedValue: .on,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.assertReviewFilterToggleValue(
                identifier: tagToggleIdentifier,
                expectedValue: .off,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
            try self.dismissReviewFilterPopoverWithOutsideTap()
            try self.assertElementDoesNotExist(
                identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            )
        }
    }

    @MainActor
    private func assertReviewFilterToggleValue(
        identifier: String,
        expectedValue: ReviewFilterToggleValue,
        timeout: TimeInterval
    ) throws {
        let toggle = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        try self.assertElementExists(identifier: identifier, timeout: timeout)

        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if self.elementValue(element: toggle) == expectedValue.rawValue {
                return
            }

            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        throw LiveSmokeFailure.unexpectedReviewState(
            message: "Expected review filter toggle '\(identifier)' to have value '\(expectedValue.rawValue)', found '\(self.elementValue(element: toggle))'.",
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func tapReviewFilterButtonScrollingIntoView(identifier: String) throws {
        let scrollSurface = self.app.scrollViews[LiveSmokeIdentifier.reviewFilterScrollSurface].firstMatch
        try self.assertElementExists(
            identifier: LiveSmokeIdentifier.reviewFilterScrollSurface,
            timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
        )

        #if targetEnvironment(macCatalyst)
        try self.scrollMacReviewFilter(scrollSurface, to: identifier, deltaY: -240)
        self.app.buttons[identifier].firstMatch.click()
        #else
        let button = self.app.buttons[identifier].firstMatch
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            if button.exists && button.isHittable {
                button.clickOrTap()
                return
            }

            try self.dragReviewFilterScrollSurface(scrollSurface, from: 0.75, to: 0.25)
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        throw LiveSmokeFailure.missingElement(
            identifier: identifier,
            timeoutSeconds: LiveSmokeConfiguration.shortUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
        #endif
    }

    @MainActor
    private func scrollReviewFilterToTop() throws {
        let scrollSurface = self.app.scrollViews[LiveSmokeIdentifier.reviewFilterScrollSurface].firstMatch
        #if targetEnvironment(macCatalyst)
        try self.scrollMacReviewFilter(scrollSurface, to: LiveSmokeIdentifier.reviewFilterAllCardsToggle, deltaY: 240)
        #else
        let allCardsButton = self.app.buttons[LiveSmokeIdentifier.reviewFilterAllCardsToggle].firstMatch
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            if allCardsButton.exists && allCardsButton.isHittable {
                return
            }

            try self.dragReviewFilterScrollSurface(scrollSurface, from: 0.25, to: 0.75)
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        throw LiveSmokeFailure.missingElement(
            identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
            timeoutSeconds: LiveSmokeConfiguration.shortUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
        #endif
    }

    #if targetEnvironment(macCatalyst)
    @MainActor
    private func scrollMacReviewFilter(_ scrollSurface: XCUIElement, to identifier: String, deltaY: CGFloat) throws {
        let row = self.app.buttons[identifier].firstMatch
        let timeout = LiveSmokeConfiguration.longUiTimeoutSeconds
        let deadline = Date().addingTimeInterval(timeout)
        let pointer = scrollSurface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        while scrollSurface.exists {
            if row.exists {
                let frame = row.frame
                if scrollSurface.frame.contains(CGPoint(x: frame.midX, y: frame.midY)), row.isHittable {
                    return
                }
            }
            guard Date() < deadline else { break }

            // The toolbar popover owns a separate window. Move the pointer into it before scrolling.
            pointer.hover()
            pointer.scroll(byDeltaX: 0, deltaY: deltaY)
        }

        throw LiveSmokeFailure.missingElement(
            identifier: identifier,
            timeoutSeconds: timeout,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }
    #else
    @MainActor
    private func dragReviewFilterScrollSurface(
        _ scrollSurface: XCUIElement,
        from startFraction: CGFloat,
        to endFraction: CGFloat
    ) throws {
        let appFrame = self.app.frame
        let viewport = scrollSurface.frame.intersection(appFrame)
        guard !viewport.isEmpty else {
            throw LiveSmokeFailure.unexpectedReviewState(
                message: "The review filter has no on-screen scroll viewport.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        // A zero-size accessibility ancestor prevents XCTest from swiping the visible scroll view directly.
        let origin = self.app.coordinate(withNormalizedOffset: .zero)
        let x = viewport.midX - appFrame.minX
        let top = viewport.minY - appFrame.minY
        let start = origin.withOffset(CGVector(dx: x, dy: top + viewport.height * startFraction))
        let end = origin.withOffset(CGVector(dx: x, dy: top + viewport.height * endFraction))
        start.press(forDuration: 0, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
    }
    #endif

    @MainActor
    private func dismissReviewFilterPopoverWithOutsideTap() throws {
        let dismissRegion = self.app.otherElements[LiveSmokeIdentifier.popoverDismissRegion].firstMatch
        guard dismissRegion.waitForExistence(timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds) else {
            throw LiveSmokeFailure.unexpectedReviewState(
                message: "The review filter popover dismiss region was not present, so the popover could not be dismissed.",
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        dismissRegion.clickOrTap()
    }
}
