import Foundation
import XCTest

extension LiveSmokeTestCase {
    @MainActor
    func tapWorkspaceWarningContinuePreservingAlerts(timeout: TimeInterval) throws {
        #if targetEnvironment(macCatalyst)
        let identifier = "workspaceWarning.alert.action-button--999"
        let button = self.app.sheets
            .matching(NSPredicate(format: "label == %@", "alert"))
            .buttons.matching(identifier: "action-button--999")
            .firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_workspace_warning_continue_preserving_alerts") {
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline && button.exists == false {
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }

            if button.exists == false {
                throw LiveSmokeFailure.missingElement(
                    identifier: identifier,
                    timeoutSeconds: timeout,
                    screen: self.currentScreenSummary(),
                    step: self.currentStepTitle
                )
            }

            try self.tapExistingButtonPreservingAlerts(
                button,
                identifier: identifier,
                action: "tap_workspace_warning_continue_preserving_alerts",
                note: "workspace warning Continue tapped without dismissal"
            )
        }
        #else
        try self.tapAlertButtonPreservingAlerts(label: "Continue", timeout: timeout)
        #endif
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
    func tapAlertButtonPreservingAlerts(label: String, timeout: TimeInterval) throws {
        let identifier = "alert.\(label)"
        let button = self.app.alerts.buttons[label].firstMatch
        try self.runWithInlineRawScreenStateOnFailure(action: "tap_alert_button_preserving_alerts.\(label)") {
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline && button.exists == false {
                RunLoop.current.run(until: Date(timeIntervalSinceNow: liveSmokeFocusPollIntervalSeconds))
            }

            if button.exists == false {
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

            try self.tapExistingButtonPreservingAlerts(
                button,
                identifier: identifier,
                action: "tap_alert_button_preserving_alerts",
                note: "alert button tapped without dismissal"
            )
        }
    }
}
