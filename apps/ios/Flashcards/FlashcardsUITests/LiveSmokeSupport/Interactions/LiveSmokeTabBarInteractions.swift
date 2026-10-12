import Foundation
import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func assertReviewReminderTabBadgeVisible(timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_review_reminder_tab_badge_visible") {
            let badge = self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.rootTabReviewReminderBadge)
                .firstMatch
            if self.waitForOptionalElement(
                badge,
                identifier: LiveSmokeIdentifier.rootTabReviewReminderBadge,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: LiveSmokeIdentifier.rootTabReviewReminderBadge,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            if try self.waitForElementValue(
                badge,
                identifier: LiveSmokeIdentifier.rootTabReviewReminderBadge,
                expectedValue: "1",
                timeout: LiveSmokeConfiguration.optionalProbeTimeoutSeconds
            ) == false {
                throw LiveSmokeFailure.unexpectedElementValue(
                    identifier: LiveSmokeIdentifier.rootTabReviewReminderBadge,
                    expectedValue: "1",
                    actualValue: self.elementValue(element: badge),
                    timeoutSeconds: LiveSmokeConfiguration.optionalProbeTimeoutSeconds,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }
        }
    }

    @MainActor
    func assertReviewReminderTabBadgeHidden(timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "assert_review_reminder_tab_badge_hidden") {
            let badge = self.app.descendants(matching: .any)
                .matching(identifier: LiveSmokeIdentifier.rootTabReviewReminderBadge)
                .firstMatch
            let startedAt = Date()
            let deadline = startedAt.addingTimeInterval(timeout)

            self.logSmokeBreadcrumb(
                event: "wait_start",
                action: "wait_for_element_to_disappear",
                identifier: LiveSmokeIdentifier.rootTabReviewReminderBadge,
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: "-",
                result: "start",
                note: "waiting for badge marker to disappear"
            )

            while Date() < deadline {
                if badge.exists == false {
                    let durationSeconds = Date().timeIntervalSince(startedAt)
                    self.logSmokeBreadcrumb(
                        event: "wait_end",
                        action: "wait_for_element_to_disappear",
                        identifier: LiveSmokeIdentifier.rootTabReviewReminderBadge,
                        timeoutSeconds: formatDuration(seconds: timeout),
                        durationSeconds: formatDuration(seconds: durationSeconds),
                        result: "success",
                        note: "badge marker disappeared"
                    )
                    return
                }

                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }

            let durationSeconds = Date().timeIntervalSince(startedAt)
            self.logSmokeBreadcrumb(
                event: "wait_end",
                action: "wait_for_element_to_disappear",
                identifier: LiveSmokeIdentifier.rootTabReviewReminderBadge,
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: formatDuration(seconds: durationSeconds),
                result: "failure",
                note: "badge marker still exists value=\(self.elementValue(element: badge))"
            )
            throw LiveSmokeFailure.unexpectedElementValue(
                identifier: LiveSmokeIdentifier.rootTabReviewReminderBadge,
                expectedValue: "missing",
                actualValue: self.elementValue(element: badge),
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func tapTabBarItem(selectedTab: LiveSmokeSelectedTab, timeout: TimeInterval) throws {
        try self.tapTabBarItem(identifier: selectedTab.itemIdentifier, timeout: timeout)
    }

    @MainActor
    func tapTabBarItem(identifier: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_tab.\(identifier)") {
            let tabBarItem = self.app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if tabBarItem.exists && tabBarItem.isHittable {
                    try self.tapExistingElement(
                        tabBarItem,
                        identifier: identifier,
                        action: "tap_tab",
                        note: "tab bar item tapped"
                    )
                    return
                }

                RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            }

            throw LiveSmokeFailure.missingElement(
                identifier: identifier,
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    func tapTabBarItem(named name: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_tab.\(name)") {
            let tabBarButton = self.app.tabBars.buttons[name].firstMatch
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if tabBarButton.exists && tabBarButton.isHittable {
                    try self.tapExistingButton(
                        tabBarButton,
                        identifier: "tab.\(name)",
                        action: "tap_tab",
                        note: "tab bar button tapped"
                    )
                    return
                }

                RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            }

            throw LiveSmokeFailure.missingElement(
                identifier: "tab.\(name)",
                timeoutSeconds: timeout,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }
    }

    @MainActor
    private func tapExistingElement(
        _ element: XCUIElement,
        identifier: String,
        action: String,
        note: String
    ) throws {
        if element.elementType == .button {
            try self.tapExistingButton(
                element,
                identifier: identifier,
                action: action,
                note: note
            )
            return
        }

        self.logActionStart(action: action, identifier: identifier)
        element.tap()
        self.logActionEnd(action: action, identifier: identifier, result: "success", note: note)
    }
}
