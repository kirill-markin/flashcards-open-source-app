import XCTest

private enum ReviewFilterToggleValue: String {
    case off = "0"
    case on = "1"
}

final class LiveSmokeReviewTests: LiveSmokeTestCase {
    @MainActor
    func testLiveSmokeManualCardReviewFlow() throws {
        try self.launchApplication(launchScenario: .guestManualReviewCard, selectedTab: .review)

        try self.step("review the guest manual card") {
            try self.reviewCurrentCard(
                expectedFrontText: LiveSmokeLaunchFixtureData.manualReviewFrontText
            )
        }
    }

    @MainActor
    func testLiveSmokeGuestAiCardReviewFlow() throws {
        try self.launchApplication(launchScenario: .guestAIReviewCard, selectedTab: .review)

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

        let button = self.app.buttons[identifier].firstMatch
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            if button.exists && button.isHittable {
                button.clickOrTap()
                return
            }

            #if targetEnvironment(macCatalyst)
            scrollSurface.scrollTowardLaterContent()
            #else
            try self.dragReviewFilterScrollSurface(scrollSurface, from: 0.75, to: 0.25)
            #endif
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        throw LiveSmokeFailure.missingElement(
            identifier: identifier,
            timeoutSeconds: LiveSmokeConfiguration.shortUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    @MainActor
    private func scrollReviewFilterToTop() throws {
        let scrollSurface = self.app.scrollViews[LiveSmokeIdentifier.reviewFilterScrollSurface].firstMatch
        let allCardsButton = self.app.buttons[LiveSmokeIdentifier.reviewFilterAllCardsToggle].firstMatch
        let deadline = Date().addingTimeInterval(LiveSmokeConfiguration.shortUiTimeoutSeconds)
        while Date() < deadline {
            if allCardsButton.exists && allCardsButton.isHittable {
                return
            }

            #if targetEnvironment(macCatalyst)
            scrollSurface.scrollTowardEarlierContent()
            #else
            try self.dragReviewFilterScrollSurface(scrollSurface, from: 0.25, to: 0.75)
            #endif
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        }

        throw LiveSmokeFailure.missingElement(
            identifier: LiveSmokeIdentifier.reviewFilterAllCardsToggle,
            timeoutSeconds: LiveSmokeConfiguration.shortUiTimeoutSeconds,
            screen: self.currentScreenSummary(),
            step: self.currentStepTitle
        )
    }

    #if !targetEnvironment(macCatalyst)
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
