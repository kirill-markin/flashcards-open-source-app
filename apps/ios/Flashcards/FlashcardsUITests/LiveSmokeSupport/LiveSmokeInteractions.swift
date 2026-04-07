import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func tapTabBarItem(named name: String, timeout: TimeInterval) throws {
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_tab.\(name)") {
            let tabBarButton = self.app.tabBars.buttons[name].firstMatch
            let fallbackButton = self.app.buttons[name].firstMatch
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

                if fallbackButton.exists && fallbackButton.isHittable {
                    try self.tapExistingButton(
                        fallbackButton,
                        identifier: "tab.\(name)",
                        action: "tap_tab",
                        note: "fallback button tapped"
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
    func tapButton(identifier: String, timeout: TimeInterval) throws {
        let button = self.app.buttons[identifier].firstMatch
        try self.tapButton(button: button, identifier: identifier, timeout: timeout)
    }

    @MainActor
    func tapCell(identifier: String, timeout: TimeInterval) throws {
        let cell = self.app.cells[identifier].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_cell.\(identifier)") {
            if self.waitForOptionalElement(
                cell,
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

            try self.tapExistingCell(cell, identifier: identifier)
        }
    }

    @MainActor
    func tapAlertButton(label: String, timeout: TimeInterval) throws {
        let identifier = "alert.\(label)"
        let button = self.app.alerts.buttons[label].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_alert_button.\(label)") {
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
                action: "tap_alert_button",
                note: "alert button tapped"
            )
        }
    }

    @MainActor
    func tapFirstNavigationBackButton() throws {
        let backButton = self.app.navigationBars.buttons.firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_back_button.navigation.backButton") {
            if self.waitForOptionalElement(
                backButton,
                identifier: "navigation.backButton",
                timeout: LiveSmokeConfiguration.shortUiTimeoutSeconds
            ) == false {
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
    func dismissKnownBlockingAlertIfVisible() -> Bool {
        guard self.app != nil else {
            return false
        }
        guard self.isApplicationRunning else {
            return false
        }

        let alert = self.app.alerts.firstMatch
        guard alert.exists else {
            return false
        }

        for label in LiveSmokeConfiguration.knownBlockingAlertButtonLabels {
            let button = alert.buttons[label]
            guard button.exists else {
                continue
            }

            button.tap()
            self.logSmokeBreadcrumb(
                event: "alert_dismissed",
                action: "dismiss_alert",
                identifier: label,
                timeoutSeconds: "-",
                durationSeconds: "-",
                result: "success",
                note: "known alert button tapped"
            )
            return true
        }

        return false
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
    private func tapExistingButton(
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
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: action, identifier: identifier, result: "success", note: note)
    }

    @MainActor
    private func tapExistingCell(_ cell: XCUIElement, identifier: String) throws {
        if cell.isEnabled == false {
            throw LiveSmokeFailure.disabledElement(
                identifier: identifier,
                screen: self.currentScreenSummary(),
                step: self.currentStepTitle
            )
        }

        self.logActionStart(action: "tap_cell", identifier: identifier)
        cell.tap()
        _ = self.dismissKnownBlockingAlertIfVisible()
        self.logActionEnd(action: "tap_cell", identifier: identifier, result: "success", note: "cell tapped")
    }
}
