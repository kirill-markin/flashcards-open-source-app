import Foundation
import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func tapButton(identifier: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[identifier].firstMatch
        try self.tapButton(button: button, identifier: identifier, timeout: timeout)
    }

    @MainActor
    func tapButtonPreservingAlerts(identifier: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[identifier].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button_preserving_alerts.\(identifier)") {
            if self.waitForOptionalElement(
                button,
                identifier: identifier,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: identifier,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            if button.isEnabled == false {
                throw LiveSmokeFailure.disabledElement(
                    identifier: identifier,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            self.logActionStart(action: "tap_button_preserving_alerts", identifier: identifier)
            button.tap()
            self.logActionEnd(
                action: "tap_button_preserving_alerts",
                identifier: identifier,
                result: "success",
                note: "button tapped without alert dismissal"
            )
        }
    }

    @MainActor
    func tapButtonScrollingIntoView(identifier: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[identifier].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button_scrolling_into_view.\(identifier)") {
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if button.exists && button.isHittable {
                    try self.tapExistingButton(
                        button,
                        identifier: identifier,
                        action: "tap_button_scrolling_into_view",
                        note: "button tapped after scrolling into view"
                    )
                    return
                }

                self.scrollBestEffort()
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
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
    func tapSettingsButtonScrollingIntoView(identifier: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[identifier].firstMatch
        let settingsList = self.app.collectionViews[LiveSmokeIdentifier.settingsScreen].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button_scrolling_into_view.\(identifier)") {
            let deadline = Date().addingTimeInterval(timeout)

            guard settingsList.exists else {
                throw LiveSmokeFailure.missingElement(
                    identifier: LiveSmokeIdentifier.settingsScreen,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            while Date() < deadline {
                if button.exists && button.isHittable {
                    try self.tapExistingButton(
                        button,
                        identifier: identifier,
                        action: "tap_button_scrolling_into_view",
                        note: "button tapped after scrolling into view"
                    )
                    return
                }

                let navigationBar = self.app.navigationBars.firstMatch
                let viewportTop = max(settingsList.frame.minY, navigationBar.exists ? navigationBar.frame.maxY : settingsList.frame.minY)
                if button.exists && button.frame.isEmpty == false && button.frame.minY < viewportTop {
                    try self.scrollSettingsRootContentTowardEarlierRows(timeout: timeout)
                } else {
                    try self.scrollSettingsRootContent(timeout: timeout)
                }
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
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
    func tapButtonScrollingIntoViewPreservingAlerts(identifier: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[identifier].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button_scrolling_into_view_preserving_alerts.\(identifier)") {
            let deadline = Date().addingTimeInterval(timeout)

            while Date() < deadline {
                if button.exists && button.isHittable {
                    try self.tapExistingButtonPreservingAlerts(
                        button,
                        identifier: identifier,
                        action: "tap_button_scrolling_into_view_preserving_alerts",
                        note: "button tapped after scrolling into view without alert dismissal"
                    )
                    return
                }

                self.scrollBestEffort()
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
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
    func tapFirstNavigationBackButton() throws {
        let navigationBarButton = self.app.navigationBars.buttons["BackButton"].firstMatch
        let toolbarBackButton = self.app.toolbars.buttons["BackButton"].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_back_button.navigation.backButton") {
            let timeout = LiveSmokeConfiguration.shortUiTimeoutSeconds
            self.logSmokeBreadcrumb(
                event: "wait_start",
                action: "wait_for_element",
                identifier: "navigation.backButton",
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: "-",
                result: "start",
                note: "wait begins"
            )
            let startedAt = Date()
            let deadline = startedAt.addingTimeInterval(timeout)
            var backButton: XCUIElement?
            while Date() < deadline {
                if navigationBarButton.exists && navigationBarButton.isEnabled && navigationBarButton.isHittable {
                    backButton = navigationBarButton
                    break
                }
                if toolbarBackButton.exists && toolbarBackButton.isEnabled && toolbarBackButton.isHittable {
                    backButton = toolbarBackButton
                    break
                }
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }
            self.logSmokeBreadcrumb(
                event: "wait_end",
                action: "wait_for_element",
                identifier: "navigation.backButton",
                timeoutSeconds: formatDuration(seconds: timeout),
                durationSeconds: formatDuration(seconds: Date().timeIntervalSince(startedAt)),
                result: backButton == nil ? "failure" : "success",
                note: "wait finished"
            )

            guard let backButton else {
                throw LiveSmokeFailure.missingBackButton(
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            try self.tapExistingButton(
                backButton,
                identifier: "navigation.backButton",
                action: "tap_back_button",
                note: "back tapped"
            )
        }
    }

    @MainActor
    func tapButton(
        button: XCUIElement,
        identifier: String,
        timeout: TimeInterval
    ) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_button.\(identifier)") {
            if self.waitForOptionalElement(
                button,
                identifier: identifier,
                timeout: timeout
            ) == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: identifier,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            try self.tapExistingButton(
                button,
                identifier: identifier,
                action: "tap_button",
                note: "button tapped"
            )
        }
    }

    @MainActor
    func tapExistingButton(
        _ button: XCUIElement,
        identifier: String,
        action: String,
        note: String
    ) throws {
        if button.isEnabled == false {
            throw LiveSmokeFailure.disabledElement(
                identifier: identifier,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        self.logActionStart(action: action, identifier: identifier)
        button.tap()
        self.logActionEnd(action: action, identifier: identifier, result: "success", note: note)
    }

    @MainActor
    func tapExistingButtonPreservingAlerts(
        _ button: XCUIElement,
        identifier: String,
        action: String,
        note: String
    ) throws {
        if button.isEnabled == false {
            throw LiveSmokeFailure.disabledElement(
                identifier: identifier,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        self.logActionStart(action: action, identifier: identifier)
        button.tap()
        self.logActionEnd(action: action, identifier: identifier, result: "success", note: note)
    }
}
